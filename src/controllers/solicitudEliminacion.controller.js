/**
 * Controller de solicitudes de eliminación de datos personales.
 *
 * Tres superficies distintas conviven acá:
 *  - pública sin auth  -> `solicitar` y `estado` (formulario de /data-deletion)
 *  - Meta sin auth     -> `metaCallback` (autenticada por el HMAC del signed_request)
 *  - interna con auth  -> `listar` y `actualizarEstado`
 */
const bcrypt = require('bcryptjs');
const SolicitudEliminacionService = require('../services/solicitudEliminacion.service');
const EmailService = require('../services/email.service');
const { Usuario } = require('../models');
const { auditoria, logger } = require('../utils/logger');

const SITIO_PUBLICO = (process.env.FRONTEND_URL || 'https://gesicomm.com').replace(/\/$/, '');

function contextoDeRequest(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

/** POST /api/publico/eliminacion-datos — formulario público. */
async function solicitar(req, res) {
  try {
    const { solicitud, duplicada } = await SolicitudEliminacionService.crearDesdeFormulario(
      req.body,
      contextoDeRequest(req)
    );

    // El email no va al log de auditoría: es justamente el dato que la
    // persona pidió borrar. El código alcanza para rastrear el caso.
    auditoria('ELIMINACION_DATOS_SOLICITADA', {
      codigo: solicitud.codigo,
      origen: 'formulario_publico',
      duplicada,
      ip: req.ip,
    });

    const url_estado = `${SITIO_PUBLICO}/data-deletion/estado/${solicitud.codigo}`;

    // Envío de correo de confirmación automático (no bloqueante)
    if (!duplicada && req.body && req.body.email) {
      EmailService.enviarConfirmacionEliminacion({
        email: req.body.email,
        nombre: req.body.nombre,
        codigo: solicitud.codigo,
        fechaLimite: solicitud.fecha_limite,
        urlEstado: url_estado,
      }).catch(err => {
        logger.error({ mensaje: '[solicitar] Error enviando email de confirmación:', error: err.message });
      });
    }

    return res.status(duplicada ? 200 : 201).json({
      message: duplicada
        ? 'Ya existe una solicitud en curso para este correo. Te mostramos su estado actual.'
        : 'Solicitud registrada. Te enviamos un correo con tu código de seguimiento y nuestro equipo de privacidad revisará la solicitud.',
      solicitud,
      url_estado,
    });
  } catch (err) {
    logger.error({ mensaje: err.message, stack: err.stack, ruta: req.path });
    return res.status(500).json({ message: 'No se pudo registrar la solicitud. Escribinos a contacto@gesicomm.com.' });
  }
}

/** GET /api/publico/eliminacion-datos/:codigo — consulta pública de estado. */
async function estado(req, res) {
  try {
    const solicitud = await SolicitudEliminacionService.consultarEstado(req.params.codigo);
    return res.json({ solicitud });
  } catch (err) {
    const status = err.message.includes('no encontrada') ? 404 : 500;
    if (status === 500) logger.error({ mensaje: err.message, stack: err.stack, ruta: req.path });
    return res.status(status).json({
      message: status === 404
        ? 'No encontramos ninguna solicitud con ese código.'
        : 'No se pudo consultar el estado de la solicitud.',
    });
  }
}

/**
 * POST /api/meta/data-deletion-callback — Data Deletion Callback de Meta.
 *
 * Meta postea `signed_request` como form-urlencoded y espera exactamente
 * {url, confirmation_code} en la respuesta. La URL tiene que ser una página
 * pública donde el usuario pueda ver el estado del borrado, y el código el
 * identificador con el que se la consulta.
 */
async function metaCallback(req, res) {
  const signedRequest = req.body?.signed_request;

  if (!signedRequest) {
    return res.status(400).json({ error: 'Falta el parámetro signed_request.' });
  }

  try {
    const { codigo, meta_user_id, duplicada } = await SolicitudEliminacionService.crearDesdeMetaCallback(
      signedRequest,
      process.env.FACEBOOK_APP_SECRET,
      contextoDeRequest(req)
    );

    auditoria('ELIMINACION_DATOS_SOLICITADA', {
      codigo,
      origen: 'meta_callback',
      meta_user_id,
      duplicada,
    });

    return res.json({
      url: `${SITIO_PUBLICO}/data-deletion/estado/${codigo}`,
      confirmation_code: codigo,
    });
  } catch (err) {
    // Una firma inválida es un intento de disparar borrados ajenos: se
    // audita y se rechaza, nunca se crea la solicitud igual.
    auditoria('ELIMINACION_DATOS_CALLBACK_RECHAZADO', { motivo: err.message, ip: req.ip });
    logger.error({ mensaje: err.message, ruta: req.path });

    const esErrorDeConfig = err.message.includes('no configurado');
    return res.status(esErrorDeConfig ? 500 : 400).json({
      error: esErrorDeConfig ? 'Callback no disponible.' : 'signed_request inválido.',
    });
  }
}

/**
 * POST /api/publico/mi-cuenta/eliminacion — solicitud desde el panel.
 *
 * Exige token Y reconfirmación de la contraseña. La contraseña es el segundo
 * factor deliberado: una sesión abierta y sin atender no debe alcanzar para
 * que alguien dispare el borrado de una cuenta ajena.
 */
async function solicitarDesdePanel(req, res) {
  try {
    const usuario = await Usuario.findByPk(req.usuario.id);
    if (!usuario) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const passwordValida = await bcrypt.compare(req.body.password, usuario.contrasena_hash);
    if (!passwordValida) {
      auditoria('ELIMINACION_DATOS_PASSWORD_INVALIDA', { usuarioId: req.usuario.id, ip: req.ip });
      return res.status(401).json({ message: 'La contraseña no es correcta.' });
    }

    const { solicitud, duplicada } = await SolicitudEliminacionService.crearDesdePanel(
      {
        usuario: req.usuario,
        alcance: req.body.alcance,
        motivo: req.body.motivo,
      },
      contextoDeRequest(req)
    );

    auditoria('ELIMINACION_DATOS_SOLICITADA', {
      codigo: solicitud.codigo,
      origen: 'panel_usuario',
      alcance: req.body.alcance,
      usuarioId: req.usuario.id,
      duplicada,
    });

    return res.status(duplicada ? 200 : 201).json({
      message: duplicada
        ? 'Ya tenés una solicitud de eliminación en curso. Te mostramos su estado actual.'
        : 'Solicitud registrada. Vamos a procesarla dentro de los próximos 30 días.',
      solicitud,
      url_estado: `${SITIO_PUBLICO}/data-deletion/estado/${solicitud.codigo}`,
    });
  } catch (err) {
    logger.error({ mensaje: err.message, stack: err.stack, ruta: req.path });
    return res.status(500).json({ message: 'No se pudo registrar la solicitud. Escribinos a contacto@gesicomm.com.' });
  }
}

/** GET /api/publico/admin/eliminacion-datos — listado interno. */
async function listar(req, res) {
  try {
    const resultado = await SolicitudEliminacionService.listar(req.query);
    return res.json(resultado);
  } catch (err) {
    logger.error({ mensaje: err.message, stack: err.stack, ruta: req.path });
    return res.status(500).json({ message: 'Error al obtener las solicitudes.' });
  }
}

/** PATCH /api/publico/admin/eliminacion-datos/:id — avance manual del caso. */
async function actualizarEstado(req, res) {
  try {
    const solicitud = await SolicitudEliminacionService.actualizarEstado(req.params.id, req.body);

    auditoria('ELIMINACION_DATOS_ACTUALIZADA', {
      codigo: solicitud.codigo,
      estado: solicitud.estado,
      usuarioId: req.usuario?.id,
    });

    return res.json({ message: 'Solicitud actualizada.', solicitud });
  } catch (err) {
    const status = err.message.includes('no encontrada') ? 404 : 500;
    if (status === 500) logger.error({ mensaje: err.message, stack: err.stack, ruta: req.path });
    return res.status(status).json({ message: err.message || 'Error al actualizar la solicitud.' });
  }
}

module.exports = { solicitar, estado, metaCallback, solicitarDesdePanel, listar, actualizarEstado };
