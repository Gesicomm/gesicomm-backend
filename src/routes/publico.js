'use strict';

/**
 * Rutas públicas del sitio institucional (gesicomm.com).
 *
 * Todo lo que cuelga de /api/publico se sirve SIN autenticación a propósito:
 * Meta exige que la vía para pedir la eliminación de datos sea accesible sin
 * iniciar sesión, y una persona que ya no tiene cuenta igual conserva su
 * derecho de supresión. La contrapartida es que son los endpoints más
 * expuestos de la API, así que llevan rate limiting propio, validación
 * estricta con Zod y un honeypot contra bots.
 *
 * Las rutas /admin de este archivo sí exigen token + permiso.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');

const { validar } = require('../middleware/validacion');
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const solicitudEliminacionController = require('../controllers/solicitudEliminacion.controller');
const mensajeContactoController = require('../controllers/mensajeContacto.controller');

const router = express.Router();
const CodigoPruebaService = require('../services/codigoPrueba.service');
const SolicitudProveedorService = require('../services/solicitudProveedor.service');
const RevisionCatalogoProveedorService = require('../services/revisionCatalogoProveedor.service');
const ProveedorPortalService = require('../services/proveedorPortal.service');
const ProveedorDocumentos = require('../services/proveedorDocumentos.service');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('../services/r2/r2.service');
const { auditoria } = require('../utils/logger');
const { asyncHandler } = require('../utils/asyncHandler');
const soloAdmin = (req, res, next) => req.usuario?.rol === 'administrador' ? next() : res.status(403).json({ message: 'Solo administradores.' });

// ============================================================
// Rate limiting de formularios públicos
// ============================================================
// Más estricto que el límite global (300/15min) porque estos endpoints
// escriben en la base sin ninguna credencial detrás. El de eliminación es
// el más restrictivo: una persona real lo usa una vez, no cinco.
const limiteFormulario = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: { message: 'Demasiadas solicitudes desde esta conexión. Probá de nuevo en una hora o escribinos a contacto@gesicomm.com.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const limiteConsulta = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 60 : 600,
  message: { message: 'Demasiadas consultas. Esperá unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================
// Honeypot anti-bots
// ============================================================
// El formulario renderiza un campo `sitio_web` oculto por CSS y fuera del
// orden de tabulación. Una persona nunca lo completa; los bots que rellenan
// todo sí. Se responde 201 igual que un envío válido para no darle al bot la
// señal de que fue detectado, pero no se persiste nada.
function honeypot(mensajeExito) {
  return (req, res, next) => {
    if (req.body?.sitio_web) {
      return res.status(201).json({ message: mensajeExito });
    }
    delete req.body.sitio_web;
    next();
  };
}

// ============================================================
// Esquemas
// ============================================================
const esquemaEliminacion = z.object({
  nombre: z.string().trim().min(2, { message: 'Ingresá tu nombre completo.' }).max(150),
  email: z.string().trim().email({ message: 'Ingresá un correo electrónico válido.' }).max(255),
  empresa: z.string().trim().max(150).optional().or(z.literal('')),
  motivo: z.string().trim().max(2000).optional().or(z.literal('')),
  confirmacion: z.literal(true, {
    errorMap: () => ({ message: 'Tenés que confirmar que entendés que la eliminación es permanente.' }),
  }),
  sitio_web: z.string().max(200).optional(),
});

const esquemaContacto = z.object({
  area: z.enum(['soporte', 'privacidad', 'legal', 'comercial', 'seguridad']).default('soporte'),
  nombre: z.string().trim().min(2, { message: 'Ingresá tu nombre.' }).max(150),
  email: z.string().trim().email({ message: 'Ingresá un correo electrónico válido.' }).max(255),
  empresa: z.string().trim().max(150).optional().or(z.literal('')),
  asunto: z.string().trim().min(3, { message: 'Escribí un asunto.' }).max(200),
  mensaje: z.string().trim().min(10, { message: 'Contanos un poco más (mínimo 10 caracteres).' }).max(5000),
  sitio_web: z.string().max(200).optional(),
});

// ============================================================
// Públicas
// ============================================================
router.post(
  '/eliminacion-datos',
  limiteFormulario,
  validar(esquemaEliminacion),
  honeypot('Solicitud registrada. Nuestro equipo de privacidad se va a comunicar a esa dirección para verificar tu identidad.'),
  solicitudEliminacionController.solicitar
);

router.get(
  '/eliminacion-datos/:codigo',
  limiteConsulta,
  solicitudEliminacionController.estado
);

router.post(
  '/contacto',
  limiteFormulario,
  validar(esquemaContacto),
  honeypot('Mensaje recibido. Te respondemos dentro de un día hábil.'),
  mensajeContactoController.crear
);

const fotoProveedor = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 4, fields: 18 },
  fileFilter: (_req, file, cb) => cb(null, file.fieldname === 'foto' ? ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) : file.mimetype === 'application/pdf')
}).fields([{ name: 'foto', maxCount: 1 }, { name: 'cedula_pdf', maxCount: 1 }, { name: 'vida_residencia', maxCount: 1 }, { name: 'antecedente_policial', maxCount: 1 }, { name: 'constancia_ruc', maxCount: 1 }]);
const recibirFotoProveedor = (req, res, next) => fotoProveedor(req, res, error => {
  if (error) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Cada archivo puede pesar hasta 8 MB.' : 'No pudimos leer los archivos. Subí una foto de perfil y documentos PDF.' });
  next();
});

router.get('/servicios', limiteConsulta, asyncHandler(async (req, res) => {
  const filtros = z.object({ busqueda: z.string().trim().max(100).default(''),
    categoria: z.enum(['', ...Object.keys(SolicitudProveedorService.CATEGORIAS)]).default(''),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  }).safeParse(req.query);
  if (!filtros.success) return res.status(400).json({ message: 'Filtros de búsqueda inválidos.' });
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await SolicitudProveedorService.buscarPublicados(filtros.data));
}));

router.get('/servicios/:id', limiteConsulta, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) return res.status(400).json({ message: 'ID inválido.' });
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ servicio: await ProveedorPortalService.publico(id) });
}));

router.post('/solicitudes-proveedores', limiteFormulario, recibirFotoProveedor, validar(z.object({
  nombre: z.string().trim().min(1).max(70),
  apellido: z.string().trim().min(1).max(70),
  email: z.string().trim().email().max(160),
  documento: z.string().trim().min(1).max(30),
  ruc: z.string().trim().max(30).optional(),
  tipo_postulante: z.enum(['persona', 'empresa']),
  razon_social: z.string().trim().max(150).optional(),
  direccion_empresa: z.string().trim().max(250).optional(),
  whatsapp: z.string().trim().min(6).max(40).refine(v => v.replace(/\D/g, '').length >= 6, 'Ingresá un número de WhatsApp válido.'),
  categoria: z.enum(Object.keys(SolicitudProveedorService.CATEGORIAS)),
  descripcion: z.string().trim().min(30, 'Describí los servicios en al menos 30 caracteres.').max(1000),
  sitio_web: z.string().max(200).optional(),
})), honeypot('Solicitud recibida.'), asyncHandler(async (req, res) => {
  const fotoPerfil = req.files?.foto?.[0];
  const cedula = req.files?.cedula_pdf?.[0];
  const personal = req.body.tipo_postulante === 'persona';
  const adicionales = personal ? ['vida_residencia', 'antecedente_policial'] : ['constancia_ruc'];
  if (!fotoPerfil) return res.status(400).json({ message: 'Subí una foto para tu perfil de proveedor (JPG, PNG o WebP).' });
  if (!cedula) return res.status(400).json({ message: 'Subí un único PDF con el frente y dorso de tu cédula.' });
  if (adicionales.some(tipo => !req.files?.[tipo]?.[0])) return res.status(400).json({ message: personal ? 'Subí los PDF de vida y residencia y antecedente policial.' : 'Subí la constancia de RUC en PDF.' });
  if (!personal && (!req.body.ruc?.trim() || !req.body.razon_social?.trim() || !req.body.direccion_empresa?.trim())) return res.status(400).json({ message: 'Para empresas, completá razón social, RUC y dirección de la empresa.' });
  if (fotoPerfil.size > 5 * 1024 * 1024) return res.status(400).json({ message: 'La foto de perfil puede pesar hasta 5 MB.' });
  let foto;
  const documentos = {};
  try {
    const meta = await sharp(fotoPerfil.buffer).metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || !meta.height || meta.width < 200 || meta.height < 200 || meta.width * meta.height > 30000000) {
      return res.status(400).json({ message: 'La foto debe tener al menos 200 × 200 píxeles y ser JPG, PNG o WebP.' });
    }
    const imagen = await sharp(fotoPerfil.buffer).rotate().resize(720, 720, { fit: 'cover', position: 'attention' }).webp({ quality: 84 }).toBuffer();
    const key = `proveedores/perfiles/${Date.now()}-${crypto.randomBytes(12).toString('hex')}.webp`;
    foto = await R2Service.uploadObject({ key, body: imagen, contentType: 'image/webp', cacheControl: IMMUTABLE_CACHE_CONTROL, contentLength: imagen.length });
    for (const tipo of ['cedula_pdf', ...adicionales]) documentos[tipo] = await ProveedorDocumentos.subirPrivado(req.files[tipo][0], tipo);
    const mensaje = await SolicitudProveedorService.crear({ ...req.body, foto_url: foto.url, foto_storage_key: key, documentos }, { ip: req.ip, userAgent: req.get('user-agent') });
    auditoria('PROVEEDOR_SOLICITUD_RECIBIDA', { id: mensaje.id });
    return res.status(201).json({ message: 'Solicitud recibida para revisión.', mensaje });
  } catch (error) {
    if (foto?.key) await R2Service.deleteObject(foto.key).catch(() => {});
    await Promise.all(Object.values(documentos).map(doc => ProveedorDocumentos.eliminarPrivado(doc).catch(() => {})));
    throw error;
  }
}));

const contratoProveedor = multer({ storage: multer.memoryStorage(), limits: { fileSize: ProveedorDocumentos.MAX_SIZE, files: 1 } }).single('contrato');
const recibirContratoProveedor = (req, res, next) => contratoProveedor(req, res, err => err
  ? res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'El contrato puede pesar hasta 8 MB.' : 'No pudimos leer el contrato.' }) : next());
const idProveedorValido = (req, res, next) => /^[1-9]\d*$/.test(req.params.id) && Number.isSafeInteger(Number(req.params.id))
  ? next() : res.status(400).json({ message: 'ID inválido.' });

router.get('/admin/solicitudes-proveedores/:id/documentos/:tipo', verificarToken, soloAdmin, idProveedorValido, asyncHandler(async (req, res) => {
  const doc = await ProveedorDocumentos.leerDocumento(Number(req.params.id), req.params.tipo);
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `${req.params.tipo.startsWith('cedula_') ? 'inline' : 'attachment'}; filename="${doc.nombre}"`);
  res.type(doc.mime).send(doc.body);
}));

router.post('/admin/solicitudes-proveedores/:id/contrato', verificarToken, soloAdmin, idProveedorValido, recibirContratoProveedor, asyncHandler(async (req, res) => {
  const documentos = await ProveedorDocumentos.guardarDocumento(Number(req.params.id), 'contrato_base', req.file);
  auditoria('PROVEEDOR_CONTRATO_ADJUNTADO', { solicitudId: Number(req.params.id), adminId: req.usuario.id });
  res.set('Cache-Control', 'no-store');
  res.json({ documentos });
}));

router.patch('/admin/solicitudes-proveedores/:id/contrato', verificarToken, soloAdmin, idProveedorValido, validar(z.object({
  estado: z.enum(['validado', 'correccion']), nota: z.string().trim().max(1000).optional(),
})), asyncHandler(async (req, res) => {
  const documentos = await ProveedorDocumentos.revisarContrato(Number(req.params.id), req.body);
  auditoria('PROVEEDOR_CONTRATO_REVISADO', { solicitudId: Number(req.params.id), estado: req.body.estado, adminId: req.usuario.id });
  res.set('Cache-Control', 'no-store');
  res.json({ documentos });
}));

// ------------------------------------------------------------
// Qué quiere ofrecer cada proveedor: los productos que subió por API y
// todavía no se publicaron. Un escalón abajo de la postulación de arriba
// (allá se decide quién entra, acá qué trae). Ver
// services/revisionCatalogoProveedor.service.js.
// ------------------------------------------------------------

router.get('/admin/solicitudes-proveedores/catalogo', verificarToken, soloAdmin, asyncHandler(async (req, res) => {
  const filtros = z.object({
    estado: z.enum(['pendiente', 'aprobado', 'rechazado']).default('pendiente'),
    proveedorId: z.coerce.number().int().min(1).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).safeParse(req.query);
  if (!filtros.success) return res.status(400).json({ message: 'Filtros de catálogo inválidos.' });
  const [listado, proveedores] = await Promise.all([
    RevisionCatalogoProveedorService.listar(filtros.data),
    RevisionCatalogoProveedorService.proveedoresConPendientes(),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ ...listado, proveedores });
}));

router.patch('/admin/solicitudes-proveedores/catalogo', verificarToken, soloAdmin, validar(z.object({
  ids: z.array(z.number().int().min(1)).min(1).max(200),
  estado: z.enum(['aprobado', 'rechazado']),
  nota: z.string().trim().max(2000).optional(),
}).refine(d => d.estado !== 'rechazado' || d.nota?.length >= 3, { path: ['nota'], message: 'Indicá el motivo del rechazo.' })), asyncHandler(async (req, res) => {
  const resultado = await RevisionCatalogoProveedorService.revisar(req.body.ids, req.body, req.usuario.id);
  auditoria('PROVEEDOR_CATALOGO_REVISADO', { ids: req.body.ids, estado: req.body.estado, usuarioId: req.usuario.id });
  res.set('Cache-Control', 'no-store');
  res.json(resultado);
}));

router.get('/admin/solicitudes-proveedores', verificarToken, soloAdmin, asyncHandler(async (req, res) => {
  const filtros = z.object({ estado: z.enum(['pendiente', 'aceptada', 'rechazada']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }).safeParse(req.query);
  if (!filtros.success) return res.status(400).json({ message: 'Filtros de solicitudes inválidos.' });
  res.set('Cache-Control', 'no-store');
  res.json(await SolicitudProveedorService.listar(filtros.data));
}));

router.patch('/admin/solicitudes-proveedores/:id', verificarToken, soloAdmin, validar(z.object({
  estado: z.enum(['aceptada', 'rechazada']), nota: z.string().trim().max(2000).optional(),
}).refine(d => d.estado !== 'rechazada' || d.nota?.length >= 3, { path: ['nota'], message: 'Indicá el motivo del rechazo.' })), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) return res.status(400).json({ message: 'ID inválido.' });
  const solicitud = await SolicitudProveedorService.revisar(id, req.body, req.usuario.id);
  auditoria('PROVEEDOR_SOLICITUD_REVISADA', { id, estado: solicitud.estado, usuarioId: req.usuario.id });
  res.set('Cache-Control', 'no-store');
  res.json({ solicitud });
}));

// ============================================================
// Con sesión iniciada — Configuración → Privacidad y datos
// ============================================================
// Es el "Método 1" que documenta /data-deletion. Lleva verificarToken pero
// NO verificarPermiso: eliminar los propios datos es un derecho de cualquier
// titular, no una facultad que dependa del rol. El límite de tasa es el de
// formularios porque, aun con sesión, escribe sin más control que ese.
router.post(
  '/mi-cuenta/eliminacion',
  limiteFormulario,
  verificarToken,
  validar(z.object({
    alcance: z.enum(['datos', 'cuenta'], {
      errorMap: () => ({ message: 'Elegí si querés eliminar solo los datos o la cuenta completa.' }),
    }),
    password: z.string().min(1, { message: 'Ingresá tu contraseña para confirmar.' }),
    motivo: z.string().trim().max(2000).optional().or(z.literal('')),
  })),
  solicitudEliminacionController.solicitarDesdePanel
);

// ============================================================
// Internas (token + permiso)
// ============================================================
router.get(
  '/admin/eliminacion-datos',
  verificarToken,
  verificarPermiso('gestionar_solicitudes_datos'),
  solicitudEliminacionController.listar
);

router.patch(
  '/admin/eliminacion-datos/:id',
  verificarToken,
  verificarPermiso('gestionar_solicitudes_datos'),
  validar(z.object({
    estado: z.enum(['recibida', 'verificando_identidad', 'en_proceso', 'completada', 'rechazada']).optional(),
    notas_internas: z.string().max(5000).optional(),
    usuario_id: z.number().int().positive().nullable().optional(),
  })),
  solicitudEliminacionController.actualizarEstado
);

router.get(
  '/admin/contacto',
  verificarToken,
  verificarPermiso('gestionar_solicitudes_datos'),
  mensajeContactoController.listar
);

// Los códigos de acceso son exclusivos del administrador de Gesicom.
router.get('/admin/codigos-prueba', verificarToken, soloAdmin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await CodigoPruebaService.listar());
}));
router.post('/admin/codigos-prueba', verificarToken, soloAdmin, validar(z.object({
  dias: z.number().int().min(1).max(365),
  ruta_acceso: z.enum(['fisico', 'personal', 'ambas']).optional(),
  plan_id: z.number().int().positive(),
  email: z.string().trim().email().max(255).optional(),
  vence_en: z.string().datetime({ offset: true }).optional(),
})), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(201).json(await CodigoPruebaService.crear(req.body, req.usuario.id));
}));
router.patch('/admin/codigos-prueba/:id/desactivar', verificarToken, soloAdmin, asyncHandler(async (req, res) => {
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ message: 'ID inválido.' });
  res.json(await CodigoPruebaService.desactivar(Number(req.params.id)));
}));
router.post('/admin/codigos-prueba/:id/enviar-correo', verificarToken, soloAdmin, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({message:'ID inválido.'});
  res.json(await CodigoPruebaService.enviarCorreo(Number(req.params.id)));
}));

module.exports = router;
