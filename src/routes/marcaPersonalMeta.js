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
const whatsapp = require('../services/marcaPersonalWhatsapp.service');

const ORIGEN = 'https://automation.gesicomm.com';
const PANTALLA = '/gesicomm-redes.html';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Lax',
  path: '/gesicom-auth/marca-personal/meta',
};
const COOKIES = { oauth: 'mp_meta_oauth', aviso: 'mp_meta_aviso', pendiente: 'mp_meta_fb_pendiente', whatsapp: 'mp_meta_wa_pendiente' };

const sellar = (datos, minutos) => EncryptionService.encrypt(JSON.stringify({ ...datos, exp: Date.now() + minutos * 60000 }));
function abrir(req, nombre) {
  const crudo = req.cookies?.[nombre];
  if (!crudo) return null;
  try {
    const d = JSON.parse(EncryptionService.decrypt(crudo));
    return d.exp > Date.now() && (!req.usuario || d.usuario === req.usuario.id) ? d : null;
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
// La vuelta de Meta es una navegación desde facebook.com: el navegador no manda la
// cookie de sesión (SameSite estricta) y no hay Authorization. El usuario sale de la
// cookie cifrada que se fijó al iniciar la conexión, ligada al state.
router.use((req, res, next) => {
  if (req.method !== 'GET' || req.path !== '/facebook/callback') return verificarToken(req, res, next);
  const oauth = abrir(req, COOKIES.oauth);
  if (!oauth) {
    res.clearCookie(COOKIES.oauth, COOKIE_OPTS);
    return res.redirect(PANTALLA);
  }
  req.usuario = { id: oauth.usuario };
  req.oauthMeta = oauth;
  next();
});
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

// Un inicio de sesión de Facebook trae la Página y su Instagram vinculado; otro,
// con permisos de WhatsApp, el número de WhatsApp Business. Los dos vuelven a
// /facebook/callback (una sola URI registrada en Meta); el tipo va en la cookie.
for (const tipo of ['facebook', 'whatsapp']) {
  router.get(`/${tipo}/conectar`, async (req, res) => {
    try {
      const state = crypto.randomBytes(24).toString('hex');
      const url = service.urlAutorizacion(state, tipo);
      res.cookie(COOKIES.oauth, sellar({ usuario: req.usuario.id, state, tipo }, 10), { ...COOKIE_OPTS, maxAge: 10 * 60000 });
      res.redirect(url);
    } catch (error) {
      avisar(res, req.usuario.id, 'error', error.status ? error.message : 'No se pudo iniciar la conexión.');
      res.redirect(PANTALLA);
    }
  });
}

const avisoWhatsapp = (r) => ({
  tipo: r.permisos_faltantes?.length || r.recepcion?.activa===false ? 'aviso' : 'ok',
  texto: `WhatsApp ${r.conectado}${r.nombre ? ' (' + r.nombre + ')' : ''} conectado.` + (r.permisos_faltantes?.length
    ? ` Faltan permisos (${r.permisos_faltantes.join(', ')}): reconectá y aceptalos para enviar mensajes y administrar plantillas.` : '')+(r.recepcion?.activa===false?' '+r.recepcion.aviso:''),
});

const textoConectada = (r) => r.instagram
  ? `Página «${r.conectada}» e Instagram @${r.instagram} conectados.`
  : `Página «${r.conectada}» conectada. No tiene una cuenta profesional de Instagram vinculada.`;
const tipoAviso = (r) => (r.permisos_faltantes?.length || !r.instagram ? 'aviso' : 'ok');
const conFaltantes = (r) => textoConectada(r) + (r.permisos_faltantes?.length
  ? ` Faltan permisos (${r.permisos_faltantes.join(', ')}): algunas funciones no van a estar disponibles. Podés reconectar y aceptarlos.` : '');

router.get('/facebook/callback', async (req, res) => {
  const oauth = req.oauthMeta;
  res.clearCookie(COOKIES.oauth, COOKIE_OPTS);
  try {
    if (req.query.error) throw Object.assign(new Error('Cancelaste la autorización en Meta. No se conectó nada.'), { status: 400 });
    if (!oauth || typeof req.query.state !== 'string' || req.query.state !== oauth.state || typeof req.query.code !== 'string') {
      throw Object.assign(new Error('La autorización venció o no coincide. Volvé a intentar.'), { status: 400 });
    }
    if (oauth.tipo === 'whatsapp') {
      const r = await service.completarWhatsapp(req.usuario.id, req.query.code);
      if (r.pendiente) {
        res.cookie(COOKIES.whatsapp, sellar({ usuario: req.usuario.id, ...r.pendiente }, 15), { ...COOKIE_OPTS, maxAge: 15 * 60000 });
      } else {
        auditoria('MARCA_PERSONAL_META_CONECTADO', { usuarioId: req.usuario.id, whatsapp: true });
        const a = avisoWhatsapp(r);
        avisar(res, req.usuario.id, a.tipo, a.texto);
      }
      return res.redirect(PANTALLA);
    }
    const r = await service.completarFacebook(req.usuario.id, req.query.code);
    if (r.pendiente) {
      res.cookie(COOKIES.pendiente, sellar({ usuario: req.usuario.id, ...r.pendiente }, 15), { ...COOKIE_OPTS, maxAge: 15 * 60000 });
    } else {
      auditoria('MARCA_PERSONAL_META_CONECTADO', { usuarioId: req.usuario.id, instagram: Boolean(r.instagram) });
      avisar(res, req.usuario.id, tipoAviso(r), conFaltantes(r));
    }
  } catch (error) {
    if (!error.status) logger.error({ mensaje: 'Marca Personal Meta callback', error: error.message });
    avisar(res, req.usuario.id, 'error', error.status ? error.message : 'No pudimos completar la conexión con Meta. Reintentá.');
  }
  res.redirect(PANTALLA);
});

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
  let numeros_pendientes = null;
  const wa = abrir(req, COOKIES.whatsapp);
  if (wa) {
    try { numeros_pendientes = await service.numerosWhatsapp(wa); }
    catch { res.clearCookie(COOKIES.whatsapp, COOKIE_OPTS); }
  }
  return { ...estado, aviso: aviso ? { tipo: aviso.tipo, texto: aviso.texto } : null, paginas_pendientes, numeros_pendientes };
}));

router.post('/facebook/confirmar', responder(async (req, res) => {
  const pendiente = abrir(req, COOKIES.pendiente);
  if (!pendiente) throw Object.assign(new Error('La autorización venció. Volvé a conectar Facebook.'), { status: 409 });
  const r = await service.confirmarPagina(req.usuario.id, pendiente, req.body?.page_id);
  res.clearCookie(COOKIES.pendiente, COOKIE_OPTS);
  auditoria('MARCA_PERSONAL_META_CONECTADO', { usuarioId: req.usuario.id, instagram: Boolean(r.instagram) });
  return { conectada: r.conectada, instagram: r.instagram, aviso: { tipo: tipoAviso(r), texto: conFaltantes(r) } };
}));

router.post('/facebook/cancelar', responder(async (req, res) => {
  res.clearCookie(COOKIES.pendiente, COOKIE_OPTS);
  return { ok: true };
}));

router.post('/whatsapp/confirmar', responder(async (req, res) => {
  const pendiente = abrir(req, COOKIES.whatsapp);
  if (!pendiente) throw Object.assign(new Error('La autorización venció. Volvé a conectar WhatsApp.'), { status: 409 });
  const r = await service.confirmarWhatsapp(req.usuario.id, pendiente, req.body?.phone_id);
  res.clearCookie(COOKIES.whatsapp, COOKIE_OPTS);
  auditoria('MARCA_PERSONAL_META_CONECTADO', { usuarioId: req.usuario.id, whatsapp: true });
  return { conectado: r.conectado, aviso: avisoWhatsapp(r) };
}));

router.post('/whatsapp/cancelar', responder(async (req, res) => {
  res.clearCookie(COOKIES.whatsapp, COOKIE_OPTS);
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
  '/whatsapp/enviar': (req) => whatsapp.enviar(req.usuario.id, req.body),
  '/whatsapp/conversaciones': (req) => whatsapp.conversaciones(req.usuario.id, req.body),
  '/whatsapp/mensajes': (req) => whatsapp.mensajes(req.usuario.id, req.body),
  '/whatsapp/recepcion': (req) => whatsapp.suscribir(req.usuario.id),
  '/whatsapp/plantillas': (req) => service.plantillasWhatsapp(req.usuario.id, req.body),
  '/whatsapp/plantillas/crear': (req) => service.crearPlantilla(req.usuario.id, req.body),
};
for (const [ruta, fn] of Object.entries(acciones)) router.post(ruta, responder(fn));

module.exports = router;
