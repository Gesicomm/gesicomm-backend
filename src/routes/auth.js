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

const router = express.Router();

// ============================================================
// Rate limiting específico para autenticación.
// Protección contra fuerza bruta.
// ============================================================
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                   // máximo 10 intentos por ventana
  message: { message: 'Demasiados intentos. Por favor espera 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper para enviar la cookie HttpOnly con el access token
function enviarCookieToken(res, accessToken, refreshToken) {
  res.cookie('accessToken', accessToken, {
    httpOnly: true,            // JavaScript del navegador NO puede leerlo
    secure: process.env.NODE_ENV === 'production', // Solo HTTPS en producción
    sameSite: 'Strict',        // Protección CSRF
    maxAge: 15 * 60 * 1000,   // 15 minutos (igual que JWT_EXPIRATION)
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
    path: '/api/auth/refresh',        // Solo se envía a esta ruta
  });
}

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', limiteAuth, validar(esquemaLogin), async (req, res) => {
  try {
    const { email, password } = req.body;

    // TODO: Buscar usuario en DB
    // const usuario = await Usuario.findOne({ where: { email } });
    // if (!usuario) { ... }

    // Simulación de usuario (reemplazar con DB real)
    const usuarioEjemplo = {
      id: 1,
      nombre: 'Admin',
      email,
      passwordHash: await bcrypt.hash('Admin1234', 12), // Solo para demo
      rol: 'TENANT_ADMIN',
      tenantId: 1,
    };

    const passwordValida = await bcrypt.compare(password, usuarioEjemplo.passwordHash);

    if (!passwordValida) {
      auditoria('LOGIN_FALLIDO', { email, ip: req.ip });
      // ⚠️ Mensaje genérico: no revelamos si el email existe o no
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const payload = {
      id: usuarioEjemplo.id,
      email: usuarioEjemplo.email,
      rol: usuarioEjemplo.rol,
      tenantId: usuarioEjemplo.tenantId,
    };

    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || '15m',
    });

    const refreshToken = jwt.sign(
      { id: usuarioEjemplo.id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRATION || '7d' }
    );

    enviarCookieToken(res, accessToken, refreshToken);

    auditoria('LOGIN', { usuarioId: usuarioEjemplo.id, email, ip: req.ip });

    return res.json({
      message: 'Sesión iniciada correctamente.',
      usuario: {
        id: usuarioEjemplo.id,
        nombre: usuarioEjemplo.nombre,
        email: usuarioEjemplo.email,
        rol: usuarioEjemplo.rol,
      },
    });
  } catch (err) {
    // ❌ Nunca enviamos detalles del error interno al cliente
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// ============================================================
// POST /api/auth/register
// ============================================================
router.post('/register', limiteAuth, validar(esquemaRegistro), async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    // Hash de contraseña con bcrypt (nunca guardar en texto plano)
    const passwordHash = await bcrypt.hash(password, 12); // costo 12 = buen balance seguridad/velocidad

    // TODO: Crear usuario en DB con passwordHash (no password)
    auditoria('USUARIO_CREADO', { email, ip: req.ip });

    return res.status(201).json({ message: 'Cuenta creada. Por favor inicia sesión.' });
  } catch (err) {
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
router.post('/logout', verificarToken, (req, res) => {
  auditoria('LOGOUT', { usuarioId: req.usuario.id, ip: req.ip });

  res.clearCookie('accessToken');
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });

  return res.json({ message: 'Sesión cerrada correctamente.' });
});

// ============================================================
// POST /api/auth/refresh
// Renueva el access token usando el refresh token de la cookie
// ============================================================
router.post('/refresh', (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: 'No autenticado.' });
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    // TODO: Obtener datos actualizados del usuario desde DB
    const nuevoPayload = { id: payload.id, tenantId: 1, rol: 'TENANT_ADMIN', email: 'demo@gesicomm.com' };

    const nuevoAccessToken = jwt.sign(nuevoPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRATION || '15m',
    });

    res.cookie('accessToken', nuevoAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 15 * 60 * 1000,
    });

    return res.json({ message: 'Token renovado.' });
  } catch {
    return res.status(401).json({ message: 'Sesión expirada. Por favor inicia sesión.' });
  }
});

// ============================================================
// GET /api/auth/me
// Verifica la sesión activa y devuelve la identidad del usuario
// ============================================================
router.get('/me', verificarToken, (req, res) => {
  return res.json({
    id: req.usuario.id,
    email: req.usuario.email,
    rol: req.usuario.rol,
    tenantId: req.usuario.tenantId,
  });
});

// ============================================================
// POST /api/auth/forgot-password
// ============================================================
router.post('/forgot-password', limiteAuth, validar(esquemaRecuperarPassword), async (req, res) => {
  const { email } = req.body;

  // TODO: Enviar email de recuperación si existe el usuario
  // Respondemos siempre con el mismo mensaje para no revelar si el email existe
  auditoria('RECUPERACION_PASSWORD_SOLICITADA', { email, ip: req.ip });

  return res.json({ message: 'Si el correo existe, recibirás instrucciones en breve.' });
});

module.exports = router;
