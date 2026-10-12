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
const DailyRotateFile = require('winston-daily-rotate-file');
const { combine, timestamp, json, errors } = format;

// Un archivo por día; los de más de 365 días se borran solos. Es el plazo que
// la Política de Privacidad declara para "Registros de acceso y auditoría":
// si se cambia acá, cambiarlo allá.
//
// En producción logs/ es un volumen del host (~/gesicomm/logs/<servicio> en
// docker-compose.yml). Sin ese volumen los archivos vivían dentro del
// contenedor y se perdían en cada deploy.
const archivoDiario = (nombre, opciones = {}) => new DailyRotateFile({
  dirname: 'logs',
  filename: `${nombre}-%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxFiles: '365d',
  ...opciones,
});

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
    archivoDiario('errores', { level: 'error' }),
    // Archivo de auditoría general
    archivoDiario('auditoria'),
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
