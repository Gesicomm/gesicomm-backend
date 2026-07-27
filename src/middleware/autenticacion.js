/**
 * Middleware de Autenticación JWT.
 *
 * Lee el JWT desde una cookie HttpOnly (no desde Authorization header
 * para evitar que JavaScript del cliente lo manipule directamente).
 *
 * Flujo:
 *   Request → verificarToken → ¿válido? → siguiente middleware
 *                                        → NO: 401
 */
const jwt = require('jsonwebtoken');
const { auditoria } = require('../utils/logger');

/**
 * Verifica el access token JWT de la cookie HttpOnly.
 * Adjunta la identidad autenticada a req.usuario.
 */
function verificarToken(req, res, next) {
  const token = req.cookies?.accessToken;

  if (!token) {
    return res.status(401).json({ message: 'No autenticado.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Adjuntamos la identidad al request.
    // El tenantId viene del token (firmado por el servidor), NO del body del cliente.
    req.usuario = {
      id: payload.id,
      email: payload.email,
      rol: payload.rol,
      tenantId: payload.tenantId, // ⚠️ Siempre del token, nunca de req.body
    };

    next();
  } catch (err) {
    auditoria('TOKEN_INVALIDO', { ip: req.ip, error: err.message });
    return res.status(401).json({ message: 'Sesión inválida o expirada.' });
  }
}

module.exports = { verificarToken };
