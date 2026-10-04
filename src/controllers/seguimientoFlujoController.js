'use strict';

/**
 * CRUD de flujos de mensajes de WhatsApp (el proceso + sus fases). La
 * lógica vive en services/seguimiento/flujo.service.js; acá solo se traduce
 * HTTP ↔ service, como el resto del catálogo.
 *
 * El dueño sale siempre de req.usuario (el JWT), nunca del body.
 */
const flujoService = require('../services/seguimiento/flujo.service');
const { envolverControlador } = require('../utils/asyncHandler');

function contexto(req) {
  return {
    usuarioId: req.usuario.id,
    esAdmin: req.usuario?.rol === 'administrador',
  };
}

/**
 * Traduce el error del service a HTTP leyendo `err.status` (utils/errorHttp),
 * sin adivinar el status por el texto del mensaje.
 */
function manejarError(res, err, mensajePorDefecto) {
  const status = err.status || (err.errores ? 422 : 500);
  if (status >= 500) console.error('[seguimiento:flujos]', err);
  return res.status(status).json({
    error: err.message || mensajePorDefecto,
    message: err.message || mensajePorDefecto,
    errores: err.errores,
  });
}

/** GET /api/seguimiento/flujos?activo=true */
exports.listar = async (req, res) => {
  const flujos = await flujoService.listarFlujos({
    ...contexto(req),
    soloActivos: req.query.activo === 'true',
  });
  res.json(flujos);
};

/** GET /api/seguimiento/flujos/:id */
exports.obtener = async (req, res) => {
  try {
    res.json(await flujoService.obtenerFlujo(req.params.id, contexto(req)));
  } catch (err) {
    manejarError(res, err, 'No se pudo cargar el flujo');
  }
};

/** POST /api/seguimiento/flujos — body: { nombre, descripcion, activo, fases: [...] } */
exports.crear = async (req, res) => {
  try {
    const flujo = await flujoService.crearFlujo(req.body, contexto(req));
    res.status(201).json(flujo);
  } catch (err) {
    manejarError(res, err, 'No se pudo crear el flujo');
  }
};

/** PUT /api/seguimiento/flujos/:id — el array `fases` llega completo y ya ordenado. */
exports.actualizar = async (req, res) => {
  try {
    const flujo = await flujoService.actualizarFlujo(req.params.id, req.body, contexto(req));
    res.json(flujo);
  } catch (err) {
    manejarError(res, err, 'No se pudo guardar el flujo');
  }
};

/**
 * DELETE /api/seguimiento/flujos/:id
 * Si el flujo ya tiene envíos registrados no se borra: queda inactivo, para
 * no romper el historial de los pedidos. La respuesta lo aclara.
 */
exports.eliminar = async (req, res) => {
  try {
    const { desactivado } = await flujoService.eliminarFlujo(req.params.id, contexto(req));
    if (desactivado) {
      return res.json({
        desactivado: true,
        message: 'El flujo ya tiene envíos registrados, así que se desactivó en lugar de borrarse para conservar el historial de los pedidos.',
      });
    }
    res.status(204).send();
  } catch (err) {
    manejarError(res, err, 'No se pudo eliminar el flujo');
  }
};

envolverControlador(module.exports);
