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

const { validar } = require('../middleware/validacion');
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const solicitudEliminacionController = require('../controllers/solicitudEliminacion.controller');
const mensajeContactoController = require('../controllers/mensajeContacto.controller');

const router = express.Router();

// ============================================================
// Rate limiting de formularios públicos
// ============================================================
// Más estricto que el límite global (300/15min) porque estos endpoints
// escriben en la base sin ninguna credencial detrás. El de eliminación es
// el más restrictivo: una persona real lo usa una vez, no cinco.
const limiteFormulario = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: process.env.NODE_ENV === 'production' ? 5 : 100,
  message: { message: 'Demasiadas solicitudes desde esta conexión. Probá de nuevo en una hora o escribinos a privacy@gesicomm.com.' },
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

module.exports = router;
