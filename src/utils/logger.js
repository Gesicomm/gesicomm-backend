/**
 * Logger de auditoría para Gesicomm.
 *
 * Registra eventos importantes del sistema sin exponer información sensible.
 *
 * ✅ Se registra: acción, usuario, tenant, IP, fecha, resultado.
 * ❌ NUNCA se registra: JWT, passwords, tokens de Meta/Shopify, secretos.
 *
 * Eventos recomendados:
 *   LOGIN, LOGIN_FALLIDO, PASSWORD_CAMBIADO, USUARIO_CREADO,
 *   USUARIO_ELIMINADO, PEDIDO_CREADO, PEDIDO_CANCELADO,
 *   SHOPIFY_CONECTADO, META_CONECTADO, WHATSAPP_CONECTADO
 */
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, json, errors } = format;

const logger = createLogger({
  level: 'info',
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),
  transports: [
    // Consola (para Docker logs)
    new transports.Console(),
    // Archivo de errores
    new transports.File({ filename: 'logs/errores.log', level: 'error' }),
    // Archivo de auditoría general
    new transports.File({ filename: 'logs/auditoria.log' }),
  ],
});

/**
 * Registra un evento de auditoría.
 * @param {string} evento - Nombre del evento (ej: 'LOGIN', 'PEDIDO_CREADO')
 * @param {object} datos - Datos del evento (sin información sensible)
 */
function auditoria(evento, datos = {}) {
  // ⚠️ Filtramos campos que NUNCA deben aparecer en logs
  const { password, token, jwt, secreto, accessToken, refreshToken, ...datosSeguros } = datos;

  logger.info({ evento, ...datosSeguros });
}

module.exports = { logger, auditoria };
