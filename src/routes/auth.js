/**
 * Rutas de autenticación.
 *
 * POST /api/auth/login          → Iniciar sesión
 * POST /api/auth/register       → Registrarse
 * POST /api/auth/logout         → Cerrar sesión
 * POST /api/auth/refresh        → Renovar access token
 * POST /api/auth/forgot-password → Solicitar recuperación de contraseña
 * GET  /api/auth/me             → Verificar sesión activa
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { validar, esquemaLogin, esquemaRegistro, esquemaRecuperarPassword } = require('../middleware/validacion');
const { verificarToken } = require('../middleware/autenticacion');
const { auditoria } = require('../utils/logger');
const { rollbackSeguro } = require('../utils/transaction');
const { Usuario, Inquilino, Rol, Permiso, sequelize } = require('../models');

const router = express.Router();

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
});

// Con subdominios de tienda (*.gesicomm.com), la cookie de sesión NO debe
// viajar a mitienda.gesicomm.com — esas páginas son públicas y no deben
// poder leer ni reenviar la sesión del dueño. COOKIE_DOMAIN (env) fija el
// scope exacto al host de la app (ej: 'app.gesicomm.com'), NUNCA
// '.gesicomm.com' (eso sí viajaría a todos los subdominios). Sin la
// variable seteada (dev local, o mientras no haya subdominios en
// producción todavía) se omite `domain` y el navegador usa el default
// (host exacto de la request) — mismo comportamiento que antes.
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

// Helper para enviar la cookie HttpOnly con el access token
function enviarCookieToken(req, res, accessToken, refreshToken) {
  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || (req.headers.host && req.headers.host.includes('localhost'));
  
  const isSecure = !isLocalhost && process.env.NODE_ENV === 'production';
  const domain = isLocalhost ? undefined : cookieDomain;
  const sameSite = isLocalhost ? 'Lax' : 'Strict';

  res.cookie('accessToken', accessToken, {
    httpOnly: true,            // JavaScript del navegador NO puede leerlo
    secure: isSecure,          // No usar secure en localhost HTTP para que el navegador guarde la cookie
    sameSite: sameSite,        // Lax en localhost para solicitudes cross-port (5173 -> 3000)
    maxAge: 15 * 60 * 1000,   // 15 minutos (igual que JWT_EXPIRATION)
    ...(domain && { domain }),
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: sameSite,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
    path: '/api/auth/refresh',        // Solo se envía a esta ruta
    ...(domain && { domain }),
  });
}

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', limiteAuth, validar(esquemaLogin), async (req, res) => {
  try {
    const { email, password } = req.body;

    const usuario = await Usuario.findOne({ 
      where: { correo_electronico: email },
      include: [{ 
        model: Rol,
        include: [{ model: Permiso }]
      }]
    });
    
    if (!usuario) {
      auditoria('LOGIN_FALLIDO', { email, ip: req.ip, razon: 'Usuario no encontrado' });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.contrasena_hash);

    if (!passwordValida) {
      auditoria('LOGIN_FALLIDO', { email, ip: req.ip, razon: 'Contraseña incorrecta' });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const payload = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.correo_electronico,
      rol: usuario.Rol ? usuario.Rol.nombre : 'sin_rol',
      permisos: usuario.Rol && usuario.Rol.Permisos ? usuario.Rol.Permisos.map(p => p.nombre) : [],
      tenantId: usuario.inquilino_id,
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

    auditoria('LOGIN', { usuarioId: usuario.id, email, ip: req.ip });

    return res.json({
      message: 'Sesión iniciada correctamente.',
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.correo_electronico,
        rol: payload.rol,
        permisos: payload.permisos,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// ============================================================
// POST /api/auth/register
// ============================================================
router.post('/register', limiteAuth, validar(esquemaRegistro), async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { nombre, email, password } = req.body;

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

    // Todo el que se registra públicamente entra como 'usuario'
    await Usuario.create({
      inquilino_id: inquilino.id,
      rol_id: rolUsuario.id,
      nombre,
      correo_electronico: email,
      contrasena_hash,
    }, { transaction: t });

    await t.commit();

    auditoria('USUARIO_CREADO', { email, ip: req.ip });

    return res.status(201).json({ message: 'Cuenta creada. Por favor inicia sesión.' });
  } catch (err) {
    await rollbackSeguro(t);
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor al crear cuenta.' });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
router.post('/logout', verificarToken, (req, res) => {
  auditoria('LOGOUT', { usuarioId: req.usuario.id, ip: req.ip });

  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || (req.headers.host && req.headers.host.includes('localhost'));
  const domain = isLocalhost ? undefined : cookieDomain;

  res.clearCookie('accessToken', { ...(domain && { domain }) });
  res.clearCookie('refreshToken', { path: '/api/auth/refresh', ...(domain && { domain }) });

  return res.json({ message: 'Sesión cerrada correctamente.' });
});

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

    const nuevoPayload = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.correo_electronico,
      rol: usuario.Rol ? usuario.Rol.nombre : 'sin_rol',
      permisos: usuario.Rol && usuario.Rol.Permisos ? usuario.Rol.Permisos.map(p => p.nombre) : [],
      tenantId: usuario.inquilino_id,
    };

    const nuevoAccessToken = jwt.sign(nuevoPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || '15m',
    });

    const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1' || (req.headers.host && req.headers.host.includes('localhost'));
    const isSecure = !isLocalhost && process.env.NODE_ENV === 'production';
    const sameSite = isLocalhost ? 'Lax' : 'Strict';

    res.cookie('accessToken', nuevoAccessToken, {
      httpOnly: true,
      secure: isSecure,
      sameSite: sameSite,
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
router.get('/me', verificarToken, (req, res) => {
  return res.json({
    id: req.usuario.id,
    nombre: req.usuario.nombre,
    email: req.usuario.email,
    rol: req.usuario.rol,
    permisos: req.usuario.permisos,
    tenantId: req.usuario.tenantId,
  });
});

// ============================================================
// POST /api/auth/forgot-password
// ============================================================
router.post('/forgot-password', limiteAuth, validar(esquemaRecuperarPassword), async (req, res) => {
  const { email } = req.body;

  auditoria('RECUPERACION_PASSWORD_SOLICITADA', { email, ip: req.ip });

  return res.json({ message: 'Si el correo existe, recibirás instrucciones en breve.' });
});

module.exports = router;
