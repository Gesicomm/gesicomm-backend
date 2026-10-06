/**
 * Rutas de autenticación.
 *
 * POST /api/auth/login            → Iniciar sesión
 * POST /api/auth/register         → Registrarse (envía OTP de verificación)
 * POST /api/auth/verify-email     → Verificar email con código OTP
 * POST /api/auth/resend-code      → Reenviar código OTP de verificación
 * POST /api/auth/logout           → Cerrar sesión
 * POST /api/auth/refresh          → Renovar access token
 * POST /api/auth/forgot-password  → Solicitar recuperación de contraseña
 * GET  /api/auth/me               → Verificar sesión activa
 */
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { validar, esquemaLogin, esquemaRegistro, esquemaRecuperarPassword, esquemaResetPassword } = require('../middleware/validacion');
const { verificarToken } = require('../middleware/autenticacion');
const { auditoria } = require('../utils/logger');
const { asyncHandler } = require('../utils/asyncHandler');
const { rollbackSeguro } = require('../utils/transaction');
const EmailService = require('../services/email.service');
const { Usuario, Inquilino, Rol, Permiso, Tienda, sequelize } = require('../models');
const AuthTracking = require('../services/authTracking.service');

const router = express.Router();

// Ninguna respuesta de /api/auth/* puede quedar cacheada: /me devuelve la
// identidad del usuario logueado, y un intermediario (o el propio navegador,
// que sin Cache-Control usa heurísticas) podría devolverle a alguien la
// respuesta de otra sesión. Vary: Cookie por si algún día hay CDN delante.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.vary('Cookie');
  next();
});

// ============================================================
// Rate limiting específico para autenticación.
// Protección contra fuerza bruta.
// ============================================================
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: process.env.NODE_ENV === 'production' ? 10 : 500, // flexible en desarrollo y tests
  message: { message: 'Demasiados intentos. Por favor espera 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.DISABLE_AUTH_RATE_LIMIT === 'true' || (process.env.NODE_ENV !== 'production' && (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1')),
});

// Rate-limit específico para el reenvío de código: máximo 3 reenvíos por 15 min
const limiteReenvio = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 3 : 500,
  message: { message: 'Demasiados reenvíos. Por favor esperá 15 minutos antes de solicitar otro código.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.DISABLE_AUTH_RATE_LIMIT === 'true' || (process.env.NODE_ENV !== 'production' && (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1')),
});

/** Genera un código OTP de 6 dígitos criptoseguro. */
function generarOTP() {
  return String(crypto.randomInt(100000, 999999));
}

function generarTokenRecuperacion() {
  return crypto.randomBytes(32).toString('hex');
}

function hashTokenRecuperacion(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function frontendUrl(req) {
  return process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
}

// Con subdominios de tienda (*.gesicomm.com), la cookie de sesión NO debe
// viajar a mitienda.gesicomm.com — esas páginas son públicas y no deben
// poder leer ni reenviar la sesión del dueño. COOKIE_DOMAIN (env) fija el
// scope exacto al host de la app (ej: 'app.gesicomm.com'), NUNCA
// '.gesicomm.com' (eso sí viajaría a todos los subdominios). Sin la
// variable seteada (dev local, o mientras no haya subdominios en
// producción todavía) se omite `domain` y el navegador usa el default
// (host exacto de la request) — mismo comportamiento que antes.
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

// Atributos de la cookie de sesión. TODAS las respuestas que escriben o
// borran cookies de sesión (login, verify-email, refresh, logout) tienen que
// usar exactamente estos mismos atributos.
//
// ⚠️ Por qué importa: el navegador identifica una cookie por
// (nombre, dominio, path). Si /login la escribe con Domain=gesicomm.com y
// /refresh la reescribe sin domain, NO se pisan: quedan DOS cookies
// 'accessToken' distintas (una de gesicomm.com y otra host-only de
// api.gesicomm.com) y el navegador manda las dos en la misma cabecera
// Cookie. Express se queda con la primera — la más vieja — así que la sesión
// que vale termina siendo la vieja. De ahí salían los dos bugs de
// producción: pantallas que se quedaban cargando (401 en bucle contra un
// token viejo) y, tras cerrar sesión, volver a entrar a la cuenta anterior
// (el logout borraba solo una de las dos cookies).
function opcionesCookie(req) {
  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || (req.headers.host && req.headers.host.includes('localhost'));

  return {
    httpOnly: true,             // JavaScript del navegador NO puede leerla
    secure: !isLocalhost && process.env.NODE_ENV === 'production', // sin secure en localhost HTTP el navegador la descarta
    sameSite: isLocalhost ? 'Lax' : 'Strict', // Lax en localhost para el cross-port de Vite (5173 -> 3000)
    domain: isLocalhost ? undefined : cookieDomain,
  };
}

// Borra las cookies de sesión en TODAS las variantes de dominio que pudo
// haber escrito alguna versión anterior del backend (con domain y
// host-only). Sin esto, un navegador que ya tiene la cookie huérfana la
// sigue mandando hasta 15 minutos y pisa la sesión nueva.
function limpiarCookiesSesion(req, res) {
  const base = opcionesCookie(req);
  const variantes = base.domain ? [base, { ...base, domain: undefined }] : [base];

  for (const opciones of variantes) {
    res.clearCookie('accessToken', { ...opciones, path: '/' });
    res.clearCookie(AuthTracking.SESSION_COOKIE, { ...opciones, path: '/' });
    res.clearCookie('refreshToken', { ...opciones, path: '/api/auth/refresh' });
    // Variante legacy: hubo versiones que escribieron el refresh en la raíz.
    res.clearCookie('refreshToken', { ...opciones, path: '/' });
    res.clearCookie(TIENDA_ACTIVA_COOKIE, { ...opciones, path: '/' });
  }
}

// Nombre separado de AuthTracking.SESSION_COOKIE: esta cookie no identifica
// la sesión, recuerda cuál de las (posiblemente varias) tiendas del usuario
// eligió la última vez — así /refresh puede reconstruir el claim `tiendaId`
// del access token sin volver a preguntar en cada renovación de 15 minutos.
const TIENDA_ACTIVA_COOKIE = 'tiendaActivaId';

function enviarCookieTiendaActiva(req, res, tiendaId) {
  if (!tiendaId) return;
  res.cookie(TIENDA_ACTIVA_COOKIE, String(tiendaId), {
    ...opcionesCookie(req),
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // igual que el refresh token
  });
}

/**
 * Resuelve qué tienda queda activa para el payload del JWT: con una sola
 * tienda no hay nada que elegir. Con varias, la cookie SOLO se respeta
 * dentro de la misma sesión (para que /refresh no tenga que volver a
 * preguntar cada 15 minutos) — en un login nuevo se ignora a propósito:
 * el usuario tiene que elegir con qué tienda operar cada vez que inicia
 * sesión, aunque haya elegido una la vez anterior.
 * Si no hay forma de decidir (0 o ≥2 sin elección) queda en null y el
 * frontend manda a /seleccionar-tienda.
 */
async function resolverTiendaParaUsuario(usuarioId, cookieTiendaId, { respetarCookie = true } = {}) {
  const tiendas = await Tienda.findAll({
    where: { usuario_id: usuarioId },
    attributes: ['id', 'nombre', 'subdominio', 'logo_imagen'],
    order: [['id', 'ASC']],
  });
  let tiendaId = null;
  if (tiendas.length === 1) {
    tiendaId = tiendas[0].id;
  } else if (respetarCookie && cookieTiendaId && tiendas.some(t => t.id === Number(cookieTiendaId))) {
    tiendaId = Number(cookieTiendaId);
  }
  return { tiendas: tiendas.map(t => t.toJSON()), tiendaId };
}

function enviarCookieSesion(req, res, sesion) {
  if (!sesion?.id) return;
  res.cookie(AuthTracking.SESSION_COOKIE, sesion.id, {
    ...opcionesCookie(req),
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// Helper para enviar la cookie HttpOnly con el access token
function enviarCookieToken(req, res, accessToken, refreshToken) {
  const opciones = opcionesCookie(req);

  // Primero limpiamos cualquier cookie de sesión previa (incluida la
  // huérfana host-only que dejaban las versiones viejas de /refresh) para
  // que el login nunca conviva con la sesión del usuario anterior.
  limpiarCookiesSesion(req, res);

  res.cookie('accessToken', accessToken, {
    ...opciones,
    path: '/',
    maxAge: 15 * 60 * 1000,   // 15 minutos (igual que JWT_EXPIRATION)
  });

  res.cookie('refreshToken', refreshToken, {
    ...opciones,
    path: '/api/auth/refresh',       // Solo se envía a esta ruta
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
  });
}

const EVENTOS_ONBOARDING = new Set([
  'onboarding_started',
]);

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', limiteAuth, validar(esquemaLogin), async (req, res) => {
  try {
    const { email, password } = req.body;
    const cookieTiendaId = req.cookies?.[TIENDA_ACTIVA_COOKIE] || null;

    const usuario = await Usuario.findOne({ 
      where: { correo_electronico: email },
      include: [{ 
        model: Rol,
        include: [{ model: Permiso }]
      }]
    });
    
    if (!usuario) {
      auditoria('LOGIN_FALLIDO', { email, ip: req.ip, razon: 'Usuario no encontrado' });
      await AuthTracking.registrarEvento({
        tipo: 'login_failed',
        req,
        email,
        resultado: 'fallo',
        metadata: { razon: 'usuario_no_encontrado' },
      });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.contrasena_hash);

    if (!passwordValida) {
      auditoria('LOGIN_FALLIDO', { email, ip: req.ip, razon: 'Contraseña incorrecta' });
      await AuthTracking.registrarEvento({
        tipo: 'login_failed',
        req,
        usuario,
        email,
        resultado: 'fallo',
        metadata: { razon: 'password_incorrecta' },
      });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    // Bloquear login si el email aún no fue verificado
    if (!usuario.email_verificado) {
      auditoria('LOGIN_FALLIDO', { email, ip: req.ip, razon: 'Email no verificado' });
      await AuthTracking.registrarEvento({
        tipo: 'login_failed',
        req,
        usuario,
        email,
        resultado: 'fallo',
        metadata: { razon: 'email_no_verificado' },
      });
      return res.status(403).json({
        message: 'Debés verificar tu correo antes de ingresar. Revisá tu bandeja de entrada (o Spam) y utilizá el código que te enviamos.',
        requiere_verificacion: true,
        email: usuario.correo_electronico,
      });
    }

    // Login nuevo: nunca se respeta la cookie de tienda recordada — con 2+
    // tiendas, el usuario tiene que elegir con cuál operar en cada inicio
    // de sesión (ver resolverTiendaParaUsuario).
    const { tiendas, tiendaId } = await resolverTiendaParaUsuario(usuario.id, cookieTiendaId, { respetarCookie: false });

    const payload = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.correo_electronico,
      rol: usuario.Rol ? usuario.Rol.nombre : 'sin_rol',
      permisos: usuario.Rol && usuario.Rol.Permisos ? usuario.Rol.Permisos.map(p => p.nombre) : [],
      tenantId: usuario.inquilino_id,
      tiendaId,
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || '15m',
    });

    const refreshToken = jwt.sign(
      { id: usuario.id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' }
    );

    enviarCookieToken(req, res, accessToken, refreshToken);
    const sesion = await AuthTracking.iniciarSesion({ req, usuario });
    enviarCookieSesion(req, res, sesion);
    enviarCookieTiendaActiva(req, res, tiendaId);

    auditoria('LOGIN', { usuarioId: usuario.id, email, ip: req.ip });

    return res.json({
      message: 'Sesión iniciada correctamente.',
      token: accessToken,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.correo_electronico,
        rol: payload.rol,
        permisos: payload.permisos,
      },
      tiendas,
      tienda_activa_id: tiendaId,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// ============================================================
// POST /api/auth/register
// ============================================================
const SuscripcionService = require('../services/suscripcion.service');

router.post('/register', limiteAuth, validar(esquemaRegistro), async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { nombre, email, password, token_suscripcion } = req.body;

    // Alta con suscripcion paga: el flujo es elegir plan -> pagar -> recien
    // ahi registrarse, asi que el token acredita que ese correo ya pago.
    // Sin token (o con uno invalido/vencido) el alta sigue funcionando igual
    // que siempre: no se bloquea el registro por eso. Si el pago es real, el
    // Recovery Path lo encuentra por correo al verificar el OTP (ver POST
    // /verify-email) — no hace falta el token para recuperarlo, es solo el
    // atajo del happy path.
    //
    // Token válido pero de OTRO correo es un caso distinto: no es "el atajo
    // no sirvió", es alguien completando el alta con un correo que no es el
    // que pagó (mistype propio, o un link ajeno). No se bloquea el registro
    // por eso tampoco — pero no debe sentirse como un alta free exitosa
    // cualquiera, y queda anotado como anómalo para trazabilidad.
    let suscripcion = null;
    let tokenCorreoNoCoincide = false;
    if (token_suscripcion) {
      const candidata = await SuscripcionService.suscripcionPorToken(token_suscripcion);
      if (candidata) {
        if (candidata.email === String(email || '').trim().toLowerCase()) {
          suscripcion = candidata;
        } else {
          tokenCorreoNoCoincide = true;
        }
      }
    }

    const existe = await Usuario.findOne({ where: { correo_electronico: email }, transaction: t });
    if (existe) {
      await rollbackSeguro(t);
      return res.status(400).json({ message: 'El correo ya está registrado.' });
    }

    // Como es MVP de tenant único por ahora, todos los usuarios van al primer inquilino existente
    const inquilino = await Inquilino.findOne({ transaction: t, order: [['id', 'ASC']] });
    if (!inquilino) {
      await rollbackSeguro(t);
      return res.status(500).json({ message: 'Error: No hay inquilino base configurado.' });
    }

    // Buscar el rol básico de usuario (debe haber sido creado por el script seed-permissions)
    const rolUsuario = await Rol.findOne({ where: { nombre: 'usuario' }, transaction: t });
    if (!rolUsuario) {
      await rollbackSeguro(t);
      return res.status(500).json({ message: 'Error de configuración del servidor: Roles no inicializados.' });
    }

    const contrasena_hash = await bcrypt.hash(password, 12);
    const otp = generarOTP();
    const otpExpira = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Crear usuario con email no verificado y código OTP
    const usuarioCreado = await Usuario.create({
      inquilino_id: inquilino.id,
      rol_id: rolUsuario.id,
      nombre,
      correo_electronico: email,
      contrasena_hash,
      email_verificado: false,
      codigo_verificacion: otp,
      codigo_verificacion_expira: otpExpira,
      plan: suscripcion && suscripcion.Plan ? suscripcion.Plan.equivale_plan : null,
      affiliate_ref: suscripcion?.afiliado_codigo || null,
      affiliate_id: suscripcion?.afiliado_id || null,
    }, { transaction: t });

    // Ata la suscripcion al usuario y quema el token (un solo uso). Si
    // perdió la carrera contra otro registro con el mismo token (ver
    // vincularUsuario), no se aborta el registro: se sigue como alta
    // normal y el Recovery Path la resuelve por correo al verificar el OTP.
    if (suscripcion) {
      const { reclamada } = await SuscripcionService.vincularUsuario(suscripcion, usuarioCreado.id, token_suscripcion, t);
      if (!reclamada) {
        // El plan/afiliado ya quedaron seteados en el create de arriba
        // asumiendo que la reclamación iba a funcionar. No fue así: se
        // revierte para no dejar un usuario con plan 'pago' sin suscripción
        // real detrás.
        await usuarioCreado.update({ plan: null, affiliate_ref: null, affiliate_id: null }, { transaction: t });
        suscripcion = null;
      }
    }

    await t.commit();

    auditoria('USUARIO_CREADO', { email, ip: req.ip });
    await AuthTracking.registrarEventoConNotificacion({
      tipo: 'register',
      req,
      usuario: usuarioCreado,
      email,
      metadata: {
        plan: usuarioCreado.plan,
        con_suscripcion: Boolean(suscripcion),
      },
    });

    if (tokenCorreoNoCoincide) {
      // Sin notificación push (sería ruido si es solo un mistype propio),
      // pero SÍ queda un AuthEvent persistente — es lo que soporte necesita
      // para reconstruir "alguien intentó este token con otro correo".
      await AuthTracking.registrarEventoConNotificacion({
        tipo: 'subscription_token_email_mismatch',
        req,
        usuario: usuarioCreado,
        email,
        resultado: 'fallo',
        metadata: { token_suscripcion_prefijo: String(token_suscripcion).slice(0, 8) },
      });
    }

    // Enviar OTP por correo (no bloqueante — la cuenta ya está creada)
    EmailService.enviarCodigoVerificacionEmail({ email, nombre, codigo: otp })
      .catch(err => console.error('[register] Error enviando OTP:', err.message));

    return res.status(201).json({
      message: tokenCorreoNoCoincide
        ? 'Cuenta creada. Ojo: el enlace de pago que usaste corresponde a otro correo, así que no activamos ningún plan en esta cuenta. Si la compra es tuya, registrate con el mismo correo con el que pagaste.'
        : 'Cuenta creada. Te enviamos un código de 6 dígitos a tu correo para activarla.',
      requiere_verificacion: true,
      email,
      token_correo_no_coincide: tokenCorreoNoCoincide,
    });
  } catch (err) {
    await rollbackSeguro(t);
    // Doble submit / reintento de red con el mismo correo: el chequeo
    // "existe" de arriba no es atómico con el create, así que dos requests
    // casi simultáneas pueden pasarlo las dos. El UNIQUE de la BD ataja la
    // segunda igual — acá solo se le da un mensaje decente en vez de 500.
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'El correo ya está registrado.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor al crear cuenta.' });
  }
});

// ============================================================
// POST /api/auth/verify-email
// ============================================================
router.post('/verify-email', limiteAuth, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { email, codigo } = req.body;

    if (!email || !codigo) {
      await rollbackSeguro(t);
      return res.status(400).json({ message: 'El correo y el código son obligatorios.' });
    }

    const usuario = await Usuario.findOne({
      where: { correo_electronico: String(email).trim().toLowerCase() },
      include: [{ model: Rol, include: [{ model: Permiso }] }],
      transaction: t,
    });

    if (!usuario) {
      await rollbackSeguro(t);
      return res.status(404).json({ message: 'No encontramos una cuenta con ese correo.' });
    }

    if (usuario.email_verificado) {
      await rollbackSeguro(t);
      return res.status(400).json({ message: 'Este correo ya fue verificado anteriormente. Podés iniciar sesión.' });
    }

    // Validar que el código no expiró
    if (!usuario.codigo_verificacion_expira || new Date() > new Date(usuario.codigo_verificacion_expira)) {
      await rollbackSeguro(t);
      return res.status(410).json({
        message: 'El código expiró. Solicitá uno nuevo.',
        codigo_expirado: true,
      });
    }

    // Validar el código (comparación en string, ambos de 6 dígitos)
    if (String(usuario.codigo_verificacion) !== String(codigo).trim()) {
      await rollbackSeguro(t);
      return res.status(400).json({ message: 'Código incorrecto. Revisá el correo e intentá de nuevo.' });
    }

    // Activar la cuenta y limpiar el OTP
    await usuario.update({
      email_verificado: true,
      codigo_verificacion: null,
      codigo_verificacion_expira: null,
    }, { transaction: t });

    // Recovery Path: recién ahora que demostró que controla el correo (OTP
    // correcto), se busca si hay una compra pagada sin cuenta para
    // vincularla. Misma transacción que activa el email: si algo falla acá,
    // no queda ni la cuenta verificada ni la compra a medio reclamar.
    const reclamo = await SuscripcionService.reclamarPorEmailVerificado({
      usuarioId: usuario.id,
      email: usuario.correo_electronico,
      transaction: t,
    });

    await t.commit();

    auditoria('EMAIL_VERIFICADO', { usuarioId: usuario.id, email: usuario.correo_electronico, ip: req.ip });
    await AuthTracking.registrarEventoConNotificacion({
      tipo: 'email_verified',
      req,
      usuario,
      email: usuario.correo_electronico,
    });

    if (reclamo.resultado === 'reclamada') {
      await AuthTracking.registrarEventoConNotificacion({
        tipo: 'subscription_payment_paid',
        req,
        usuario,
        email: usuario.correo_electronico,
        metadata: {
          origen: 'Recovery Path (verify-email)',
          suscripcion_id: reclamo.suscripcion.id,
          plan_codigo: reclamo.suscripcion.Plan?.codigo || null,
          plan_nombre: reclamo.suscripcion.Plan?.nombre || null,
        },
      });
    } else if (reclamo.resultado === 'ambigua') {
      // Trazabilidad para soporte: no solo "hay ambigüedad", sino con qué
      // referencias de pago exactas — sin datos sensibles (nunca claves ni
      // tokens), solo lo que hace falta para desambiguar a mano.
      await AuthTracking.registrarEventoConNotificacion({
        tipo: 'subscription_claim_ambiguous',
        req,
        usuario,
        email: usuario.correo_electronico,
        metadata: {
          suscripcion_ids: reclamo.candidatas.map(s => s.id),
          cantidad: reclamo.candidatas.length,
          pagos: (reclamo.pagos || []).map(p => ({
            suscripcion_id: p.suscripcion_id,
            referencia: p.referencia,
            hash_pedido: p.hash_pedido,
            monto: p.monto,
            pagado_en: p.pagado_en,
          })),
        },
      });
    }

    // Iniciar sesión automáticamente. Recién verificado: nunca tiene
    // tiendas todavía, así que no hace falta resolverTiendaParaUsuario acá
    // — el frontend manda directo al onboarding de creación.
    const payload = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.correo_electronico,
      rol: usuario.Rol ? usuario.Rol.nombre : 'sin_rol',
      permisos: usuario.Rol && usuario.Rol.Permisos ? usuario.Rol.Permisos.map(p => p.nombre) : [],
      tenantId: usuario.inquilino_id,
      tiendaId: null,
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || '15m',
    });
    const refreshToken = jwt.sign(
      { id: usuario.id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' }
    );

    enviarCookieToken(req, res, accessToken, refreshToken);
    const sesion = await AuthTracking.iniciarSesion({ req, usuario });
    enviarCookieSesion(req, res, sesion);

    return res.json({
      message: reclamo.resultado === 'ambigua'
        ? '¡Correo verificado! Tu cuenta está activa. Encontramos más de un pago pendiente con este correo: te vamos a contactar para activar el plan correcto.'
        : '¡Correo verificado! Tu cuenta está activa.',
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.correo_electronico,
        rol: payload.rol,
        permisos: payload.permisos,
      },
      tiendas: [],
      tienda_activa_id: null,
      suscripcion_vinculada: reclamo.resultado === 'reclamada',
      pago_pendiente_revision: reclamo.resultado === 'ambigua',
    });
  } catch (err) {
    await rollbackSeguro(t);
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// ============================================================
// POST /api/auth/resend-code
// ============================================================
router.post('/resend-code', limiteReenvio, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'El correo es obligatorio.' });
    }

    const usuario = await Usuario.findOne({
      where: { correo_electronico: String(email).trim().toLowerCase() },
    });

    // Respuesta genérica para no revelar si el email existe
    if (!usuario || usuario.email_verificado) {
      return res.json({ message: 'Si existe una cuenta pendiente de verificación con ese correo, te enviamos un nuevo código.' });
    }

    const otp = generarOTP();
    const otpExpira = new Date(Date.now() + 15 * 60 * 1000);

    await usuario.update({
      codigo_verificacion: otp,
      codigo_verificacion_expira: otpExpira,
    });

    EmailService.enviarCodigoVerificacionEmail({ email: usuario.correo_electronico, nombre: usuario.nombre, codigo: otp })
      .catch(err => console.error('[resend-code] Error enviando OTP:', err.message));

    auditoria('OTP_REENVIADO', { email: usuario.correo_electronico, ip: req.ip });
    await AuthTracking.registrarEvento({
      tipo: 'otp_resent',
      req,
      usuario,
      email: usuario.correo_electronico,
    });

    return res.json({ message: 'Si existe una cuenta pendiente de verificación con ese correo, te enviamos un nuevo código.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
// NO lleva verificarToken a propósito: el access token dura 15 minutos, así
// que el caso más común (alguien que estuvo un rato inactivo y recién ahí
// toca "Cerrar sesión") llegaba con el token vencido, respondía 401 y se iba
// sin borrar NADA — el refreshToken quedaba vivo 7 días. Cerrar sesión tiene
// que borrar las cookies siempre, haya o no un token válido.
router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.accessToken;
  const datos = token ? jwt.decode(token) : null; // decode, no verify: es solo para la auditoría
  await AuthTracking.cerrarSesion(req, datos?.id ?? null);
  await AuthTracking.registrarEvento({
    tipo: 'logout',
    req,
    email: datos?.email,
    usuario: datos?.id ? { id: datos.id, correo_electronico: datos.email } : null,
    sessionId: req.cookies?.[AuthTracking.SESSION_COOKIE] || null,
  });
  auditoria('LOGOUT', { usuarioId: datos?.id ?? null, ip: req.ip });

  limpiarCookiesSesion(req, res);

  return res.json({ message: 'Sesión cerrada correctamente.' });
}));

// ============================================================
// POST /api/auth/refresh
// ============================================================
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: 'No autenticado.' });
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    const usuario = await Usuario.findByPk(payload.id, {
      include: [{ 
        model: Rol,
        include: [{ model: Permiso }]
      }]
    });
    
    if (!usuario) {
      return res.status(401).json({ message: 'Usuario no encontrado.' });
    }
    await AuthTracking.marcarActividad(req, usuario.id);

    // El refresh token solo lleva {id}: la tienda activa no viaja ahí, se
    // reconstruye leyendo la cookie tiendaActivaId (ver resolverTiendaParaUsuario).
    const cookieTiendaId = req.cookies?.[TIENDA_ACTIVA_COOKIE] || null;
    const { tiendaId } = await resolverTiendaParaUsuario(usuario.id, cookieTiendaId);

    const nuevoPayload = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.correo_electronico,
      rol: usuario.Rol ? usuario.Rol.nombre : 'sin_rol',
      permisos: usuario.Rol && usuario.Rol.Permisos ? usuario.Rol.Permisos.map(p => p.nombre) : [],
      tenantId: usuario.inquilino_id,
      tiendaId,
    };

    const nuevoAccessToken = jwt.sign(nuevoPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || '15m',
    });

    // Mismos atributos que en el login (incluido domain): si acá se omite,
    // el navegador guarda una SEGUNDA cookie 'accessToken' host-only en vez
    // de pisar la del login. Ver el comentario de opcionesCookie().
    res.cookie('accessToken', nuevoAccessToken, {
      ...opcionesCookie(req),
      path: '/',
      maxAge: 15 * 60 * 1000,
    });

    return res.json({ message: 'Token renovado.' });
  } catch (err) {
    return res.status(401).json({ message: 'Sesión expirada. Por favor inicia sesión.' });
  }
});

// ============================================================
// GET /api/auth/me
// ============================================================
router.get('/me', verificarToken, asyncHandler(async (req, res) => {
  await AuthTracking.marcarActividad(req, req.usuario.id);
  return res.json({
    id: req.usuario.id,
    nombre: req.usuario.nombre,
    email: req.usuario.email,
    rol: req.usuario.rol,
    permisos: req.usuario.permisos,
    tenantId: req.usuario.tenantId,
    tiendaId: req.usuario.tiendaId,
  });
}));

// ============================================================
// POST /api/auth/seleccionar-tienda
// Cambia la tienda activa de la sesión (entre las propias) sin
// reloguearse. Reemite accessToken + la cookie que recuerda la elección
// para que /refresh la siga respetando.
// ============================================================
router.post('/seleccionar-tienda', verificarToken, asyncHandler(async (req, res) => {
  const tiendaId = Number(req.body?.tienda_id);
  if (!tiendaId) return res.status(400).json({ message: 'Falta indicar la tienda.' });

  const tienda = await Tienda.findOne({
    where: { id: tiendaId, usuario_id: req.usuario.id },
    attributes: ['id', 'nombre', 'subdominio', 'logo_imagen'],
  });
  if (!tienda) return res.status(404).json({ message: 'Esa tienda no existe o no te pertenece.' });

  const nuevoPayload = {
    id: req.usuario.id,
    nombre: req.usuario.nombre,
    email: req.usuario.email,
    rol: req.usuario.rol,
    permisos: req.usuario.permisos,
    tenantId: req.usuario.tenantId,
    tiendaId: tienda.id,
  };
  const accessToken = jwt.sign(nuevoPayload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRATION || '15m',
  });

  res.cookie('accessToken', accessToken, {
    ...opcionesCookie(req),
    path: '/',
    maxAge: 15 * 60 * 1000,
  });
  enviarCookieTiendaActiva(req, res, tienda.id);

  return res.json({ tienda: tienda.toJSON() });
}));

// ============================================================
// POST /api/auth/onboarding-event
// Hitos livianos del onboarding que ocurren en frontend antes
// de crear recursos persistentes.
// ============================================================
router.post('/onboarding-event', verificarToken, asyncHandler(async (req, res) => {
  const tipo = String(req.body?.tipo || '');
  if (!EVENTOS_ONBOARDING.has(tipo)) {
    return res.status(400).json({ message: 'Evento de onboarding no permitido.' });
  }

  await AuthTracking.registrarEventoConNotificacion({
    tipo,
    req,
    usuario: req.usuario,
    metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
  });

  return res.status(202).json({ ok: true });
}));

// ============================================================
// GET /api/auth/service-token
//
// Emite un JWT de corta vida para que el frontend llame a otros
// backends de Gesicomm (ej. Automation Hub) sin exponer la cookie
// de sesión ni ampliar su dominio a otros subdominios. Firmado con
// un secreto propio (SERVICE_JWT_SECRET), no con JWT_SECRET.
// ============================================================
router.get('/service-token', verificarToken, (req, res) => {
  if (!process.env.SERVICE_JWT_SECRET) {
    console.error('[service-token] Falta SERVICE_JWT_SECRET en el entorno.');
    return res.status(500).json({ message: 'Error de configuración del servidor.' });
  }

  const payload = {
    id: req.usuario.id,
    rol: req.usuario.rol,
    permisos: req.usuario.permisos,
    tenantId: req.usuario.tenantId,
  };

  const token = jwt.sign(payload, process.env.SERVICE_JWT_SECRET, { expiresIn: '5m' });

  return res.json({ token, expiresIn: 300 });
});

// ============================================================
// POST /api/auth/forgot-password
// ============================================================
router.post('/forgot-password', limiteAuth, validar(esquemaRecuperarPassword), async (req, res) => {
  const { email } = req.body;
  const emailNormalizado = String(email).trim().toLowerCase();

  auditoria('RECUPERACION_PASSWORD_SOLICITADA', { email: emailNormalizado, ip: req.ip });
  await AuthTracking.registrarEvento({
    tipo: 'password_reset_requested',
    req,
    email: emailNormalizado,
  });

  try {
    const usuario = await Usuario.findOne({
      where: { correo_electronico: emailNormalizado },
    });

    if (!usuario) {
      await AuthTracking.registrarEvento({
        tipo: 'password_reset_email_skipped',
        req,
        email: emailNormalizado,
        resultado: 'fallo',
        metadata: { razon: 'usuario_no_encontrado' },
      });
      return res.json({ message: 'Si el correo existe, recibirás instrucciones en breve.' });
    }

    const token = generarTokenRecuperacion();
    const tokenHash = hashTokenRecuperacion(token);
    const expira = new Date(Date.now() + 60 * 60 * 1000);

    await usuario.update({
      password_reset_token_hash: tokenHash,
      password_reset_expira: expira,
    });

    const urlReset = `${frontendUrl(req).replace(/\/$/, '')}/reset-password?token=${token}`;
    const resultadoEmail = await EmailService.enviarRecuperacionPassword({
      email: usuario.correo_electronico,
      nombre: usuario.nombre,
      urlReset,
    });

    await AuthTracking.registrarEvento({
      tipo: resultadoEmail.enviado ? 'password_reset_email_sent' : 'password_reset_email_failed',
      req,
      usuario,
      resultado: resultadoEmail.enviado ? 'ok' : 'fallo',
      metadata: resultadoEmail.enviado
        ? { expira_en_minutos: 60 }
        : { razon: resultadoEmail.razon || resultadoEmail.error || 'email_no_enviado' },
    });
  } catch (err) {
    console.error('[forgot-password] Error preparando recuperación:', err);
    await AuthTracking.registrarEvento({
      tipo: 'password_reset_email_failed',
      req,
      email: emailNormalizado,
      resultado: 'fallo',
      metadata: { razon: 'error_interno' },
    });
  }

  return res.json({ message: 'Si el correo existe, recibirás instrucciones en breve.' });
});

// ============================================================
// POST /api/auth/reset-password
// ============================================================
router.post('/reset-password', limiteAuth, validar(esquemaResetPassword), async (req, res) => {
  const { token, password } = req.body;
  const tokenHash = hashTokenRecuperacion(token);

  try {
    const usuario = await Usuario.findOne({
      where: { password_reset_token_hash: tokenHash },
    });

    if (!usuario) {
      await AuthTracking.registrarEvento({
        tipo: 'password_reset_failed',
        req,
        resultado: 'fallo',
        metadata: { razon: 'token_invalido' },
      });
      return res.status(400).json({ message: 'El enlace de recuperación no es válido o ya fue utilizado.' });
    }

    if (!usuario.password_reset_expira || new Date() > new Date(usuario.password_reset_expira)) {
      await usuario.update({
        password_reset_token_hash: null,
        password_reset_expira: null,
      });
      await AuthTracking.registrarEvento({
        tipo: 'password_reset_failed',
        req,
        usuario,
        resultado: 'fallo',
        metadata: { razon: 'token_expirado' },
      });
      return res.status(410).json({ message: 'El enlace de recuperación venció. Solicitá uno nuevo.' });
    }

    const contrasena_hash = await bcrypt.hash(password, 12);
    await usuario.update({
      contrasena_hash,
      password_reset_token_hash: null,
      password_reset_expira: null,
    });

    auditoria('PASSWORD_CAMBIADO', { usuarioId: usuario.id, email: usuario.correo_electronico, ip: req.ip });
    await AuthTracking.registrarEvento({
      tipo: 'password_reset_completed',
      req,
      usuario,
    });

    return res.json({ message: 'Contraseña actualizada. Ya podés iniciar sesión.' });
  } catch (err) {
    console.error('[reset-password] Error cambiando contraseña:', err);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

module.exports = router;
