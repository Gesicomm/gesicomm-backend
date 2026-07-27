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
const { Usuario, Inquilino, Rol, sequelize } = require('../models');

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

    const usuario = await Usuario.findOne({ 
      where: { correo_electronico: email },
      include: [{ model: Rol }]
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
      email: usuario.correo_electronico,
      rol: usuario.Rol ? usuario.Rol.nombre : 'sin_rol',
      permisos: usuario.Rol ? usuario.Rol.permisos : [],
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

    enviarCookieToken(res, accessToken, refreshToken);

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
      await t.rollback();
      return res.status(400).json({ message: 'El correo ya está registrado.' });
    }

    // Como es MVP de tenant único por ahora, buscamos o creamos la empresa principal
    const [inquilino] = await Inquilino.findOrCreate({ 
      where: { nombre: 'Gesicomm Principal' }, 
      transaction: t 
    });

    // Nos aseguramos de que existan los roles básicos
    const [rolUsuario] = await Rol.findOrCreate({
      where: { nombre: 'usuario' },
      defaults: { permisos: ['ver_dashboard'] },
      transaction: t
    });

    await Rol.findOrCreate({
      where: { nombre: 'administrador' },
      defaults: { permisos: ['ver_dashboard', 'gestionar_usuarios', 'configurar_sistema'] },
      transaction: t
    });

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
    await t.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor al crear cuenta.' });
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
// ============================================================
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ message: 'No autenticado.' });
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    const usuario = await Usuario.findByPk(payload.id, {
      include: [{ model: Rol }]
    });
    
    if (!usuario) {
      return res.status(401).json({ message: 'Usuario no encontrado.' });
    }

    const nuevoPayload = {
      id: usuario.id,
      email: usuario.correo_electronico,
      rol: usuario.Rol ? usuario.Rol.nombre : 'sin_rol',
      permisos: usuario.Rol ? usuario.Rol.permisos : [],
      tenantId: usuario.inquilino_id,
    };

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
