'use strict';
// Instagram y Facebook de Marca Personal. El navegador llega siempre por el
// proxy de automation.gesicomm.com (/gesicom-auth/marca-personal/meta/...),
// así que el estado de OAuth, el aviso posterior y la Página pendiente viven
// en cookies HttpOnly cifradas de ese origen: nada va en la URL.
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { verificarToken } = require('../middleware/autenticacion');
const EncryptionService = require('../utils/EncryptionService');
const { auditoria, logger } = require('../utils/logger');
const service = require('../services/marcaPersonalMeta.service');

const ORIGEN = 'https://automation.gesicomm.com';
const PANTALLA = '/gesicomm-redes.html';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  path: '/gesicom-auth/marca-personal/meta',
};
const COOKIES = { oauth: 'mp_meta_oauth', aviso: 'mp_meta_aviso', pendiente: 'mp_meta_fb_pendiente' };

const sellar = (datos, minutos) => EncryptionService.encrypt(JSON.stringify({ ...datos, exp: Date.now() + minutos * 60000 }));
function abrir(req, nombre) {
  const crudo = req.cookies?.[nombre];
  if (!crudo) return null;
  try {
    const d = JSON.parse(EncryptionService.decrypt(crudo));
    return d.exp > Date.now() && d.usuario === req.usuario.id ? d : null;
  } catch { return null; }
}
const avisar = (res, usuario, tipo, texto) => res.cookie(COOKIES.aviso, sellar({ usuario, tipo, texto }, 5), { ...COOKIE_OPTS, maxAge: 5 * 60000 });

const router = express.Router();
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  // El proxy fija Origin; un pedido directo a api.gesicomm.com no pasa.
  if (req.get('origin') !== ORIGEN) return res.status(403).json({ message: 'Origen no permitido.' });
  next();
});
router.use(verificarToken);
router.use(rateLimit({ windowMs: 60000, max: 90, keyGenerator: (req) => String(req.usuario.id), standardHeaders: true, legacyHeaders: false }));

const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 90 * 1024 * 1024, files: 1 } });

function responder(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (error) {
      const status = [400, 401, 403, 404, 409, 503].includes(error.status) ? error.status : 503;
      if (!error.status) logger.error({ mensaje: 'Marca Personal Meta', ruta: req.path, error: error.message });
      res.status(status).json({ message: error.status ? error.message : 'No pudimos completar la operación. Reintentá en unos minutos.' });
    }
  };
}

// --- Conexión ---------------------------------------------------------------

for (const plataforma of ['instagram', 'facebook']) {
  router.get(`/${plataforma}/conectar`, async (req, res) => {
    try {
      const state = crypto.randomBytes(24).toString('hex');
      const url = service.urlAutorizacion(plataforma, state);
      res.cookie(COOKIES.oauth, sellar({ usuario: req.usuario.id, plataforma, state }, 10), { ...COOKIE_OPTS, maxAge: 10 * 60000 });
      res.redirect(url);
    } catch (error) {
      avisar(res, req.usuario.id, 'error', error.status ? error.message : 'No se pudo iniciar la conexión.');
      res.redirect(PANTALLA);
    }
  });

  router.get(`/${plataforma}/callback`, async (req, res) => {
    const oauth = abrir(req, COOKIES.oauth);
    res.clearCookie(COOKIES.oauth, COOKIE_OPTS);
    try {
      if (req.query.error) throw Object.assign(new Error('Cancelaste la autorización en Meta. No se conectó nada.'), { status: 400 });
      if (!oauth || oauth.plataforma !== plataforma || typeof req.query.state !== 'string' || req.query.state !== oauth.state || typeof req.query.code !== 'string') {
        throw Object.assign(new Error('La autorización venció o no coincide. Volvé a intentar.'), { status: 400 });
      }
      if (plataforma === 'instagram') {
        const r = await service.completarInstagram(req.usuario.id, req.query.code);
        auditoria('MARCA_PERSONAL_META_CONECTADO', { usuarioId: req.usuario.id, plataforma });
        avisar(res, req.usuario.id, r.permisos_faltantes.length ? 'aviso' : 'ok', r.permisos_faltantes.length
          ? `Instagram @${r.username} conectado, pero faltan permisos: ${r.permisos_faltantes.join(', ')}. Algunas funciones no van a estar disponibles.`
          : `Instagram @${r.username} conectado.`);
      } else {
        const r = await service.completarFacebook(req.usuario.id, req.query.code);
        if (r.pendiente) {
          res.cookie(COOKIES.pendiente, sellar({ usuario: req.usuario.id, ...r.pendiente }, 15), { ...COOKIE_OPTS, maxAge: 15 * 60000 });
        } else {
          auditoria('MARCA_PERSONAL_META_CONECTADO', { usuarioId: req.usuario.id, plataforma });
          avisar(res, req.usuario.id, 'ok', `Página «${r.conectada}» conectada.`);
        }
      }
    } catch (error) {
      if (!error.status) logger.error({ mensaje: 'Marca Personal Meta callback', plataforma, error: error.message });
      avisar(res, req.usuario.id, 'error', error.status ? error.message : 'No pudimos completar la conexión con Meta. Reintentá.');
    }
    res.redirect(PANTALLA);
  });
}

router.get('/estado', responder(async (req, res) => {
  const estado = await service.estado(req.usuario.id);
  const aviso = abrir(req, COOKIES.aviso);
  if (req.cookies?.[COOKIES.aviso]) res.clearCookie(COOKIES.aviso, COOKIE_OPTS);
  let paginas_pendientes = null;
  const pendiente = abrir(req, COOKIES.pendiente);
  if (pendiente) {
    try { paginas_pendientes = await service.paginasDe(pendiente); }
    catch { res.clearCookie(COOKIES.pendiente, COOKIE_OPTS); }
  }
  return { ...estado, aviso: aviso ? { tipo: aviso.tipo, texto: aviso.texto } : null, paginas_pendientes };
}));

router.post('/facebook/confirmar', responder(async (req, res) => {
  const pendiente = abrir(req, COOKIES.pendiente);
  if (!pendiente) throw Object.assign(new Error('La autorización venció. Volvé a conectar Facebook.'), { status: 409 });
  const r = await service.confirmarPagina(req.usuario.id, pendiente, req.body?.page_id);
  res.clearCookie(COOKIES.pendiente, COOKIE_OPTS);
  auditoria('MARCA_PERSONAL_META_CONECTADO', { usuarioId: req.usuario.id, plataforma: 'facebook' });
  return r;
}));

router.post('/facebook/cancelar', responder(async (req, res) => {
  res.clearCookie(COOKIES.pendiente, COOKIE_OPTS);
  return { ok: true };
}));

router.post('/desconectar', responder(async (req) => {
  const r = await service.desconectar(req.usuario.id, req.body?.id);
  auditoria('MARCA_PERSONAL_META_DESCONECTADO', { usuarioId: req.usuario.id, plataforma: r.desconectada });
  return r;
}));

// --- Contenido ---------------------------------------------------------------

router.post('/medios', (req, res, next) => subida.single('archivo')(req, res, (err) => {
  if (err) return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 90 MB.' : 'No se pudo recibir el archivo.' });
  next();
}), responder((req) => service.subirMedio(req.usuario.id, req.file)));

const acciones = {
  '/instagram/publicar': (req) => service.publicarInstagram(req.usuario.id, req.body),
  '/publicaciones/estado': (req) => service.avanzar(req.usuario.id, req.body?.id),
  '/facebook/publicar': (req) => service.publicarFacebook(req.usuario.id, req.body),
  '/historial': (req) => service.historial(req.usuario.id, req.body),
  '/publicaciones': (req) => service.publicaciones(req.usuario.id, req.body),
  '/instagram/comentarios': (req) => service.comentarios(req.usuario.id, req.body),
  '/instagram/comentarios/responder': (req) => service.responderComentario(req.usuario.id, req.body),
  '/instagram/comentarios/ocultar': (req) => service.ocultarComentario(req.usuario.id, req.body),
  '/instagram/conversaciones': (req) => service.conversaciones(req.usuario.id, req.body),
  '/instagram/mensajes': (req) => service.mensajes(req.usuario.id, req.body),
  '/instagram/mensajes/enviar': (req) => service.enviarMensaje(req.usuario.id, req.body),
  '/instagram/metricas': (req) => service.metricas(req.usuario.id, req.body),
  '/instagram/metricas-publicacion': (req) => service.metricasPublicacion(req.usuario.id, req.body),
};
for (const [ruta, fn] of Object.entries(acciones)) router.post(ruta, responder(fn));

// --- Eliminación de datos (Instagram) ------------------------------------------
// Instagram Login tiene su propio secreto y sus propias URLs de desautorización
// y de eliminación de datos. La de Facebook es la de la app (/api/meta).
const publico = express.Router();
const solicitudEliminacionController = require('../controllers/solicitudEliminacion.controller');
publico.post('/instagram/eliminacion-datos', express.urlencoded({ extended: false }), solicitudEliminacionController.metaCallbackInstagram);
publico.post('/instagram/desautorizar', express.urlencoded({ extended: false }), solicitudEliminacionController.metaCallbackInstagram);

module.exports = { router, publico };
