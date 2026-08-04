/**
 * Controller del formulario público de contacto (/contact).
 */
const MensajeContactoService = require('../services/mensajeContacto.service');
const { auditoria, logger } = require('../utils/logger');

/** POST /api/publico/contacto */
async function crear(req, res) {
  try {
    const mensaje = await MensajeContactoService.crear(req.body, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    auditoria('CONTACTO_RECIBIDO', { id: mensaje.id, area: mensaje.area, ip: req.ip });

    return res.status(201).json({
      message: 'Mensaje recibido. Te respondemos dentro de un día hábil.',
      mensaje,
    });
  } catch (err) {
    logger.error({ mensaje: err.message, stack: err.stack, ruta: req.path });
    return res.status(500).json({ message: 'No se pudo enviar el mensaje. Escribinos a contacto@gesicomm.com.' });
  }
}

/** GET /api/publico/admin/contacto — listado interno. */
async function listar(req, res) {
  try {
    const resultado = await MensajeContactoService.listar(req.query);
    return res.json(resultado);
  } catch (err) {
    logger.error({ mensaje: err.message, stack: err.stack, ruta: req.path });
    return res.status(500).json({ message: 'Error al obtener los mensajes.' });
  }
}

module.exports = { crear, listar };
