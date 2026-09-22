'use strict';

/**
 * Red de Fulfillment (administración).
 *
 * Todo lo de acá es infraestructura de Gesicomm, no de un comercio: las rutas
 * van detrás de soloAdministrador. La única lectura que se expone al comercio
 * es la cobertura comercial, y vive en el controller de Mi Tienda.
 */
const RedFulfillment = require('../services/redFulfillment.service');
const ProveedorLogistico = require('../services/proveedorLogistico.service');

function responder(res, error, contexto) {
  const status = error.status || 500;
  if (status >= 500) console.error(`[red-fulfillment] ${contexto}:`, error);
  return res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
}

exports.resumen = async (req, res) => {
  try {
    return res.json(await RedFulfillment.resumen());
  } catch (error) {
    return responder(res, error, 'resumen');
  }
};

exports.listarCentros = async (req, res) => {
  try {
    const [centros, candidatos] = await Promise.all([
      RedFulfillment.centros(),
      RedFulfillment.candidatosACentro(req.usuario.id),
    ]);
    return res.json({
      centros: centros.map((c) => ({
        id: c.id, nombre: c.nombre, ciudad: c.ciudad, departamento: c.departamento,
        direccion: c.direccion, activo: c.activo,
      })),
      // Para el onboarding: qué depósitos propios podría designar como centro.
      candidatos: candidatos.map((c) => ({ id: c.id, nombre: c.nombre, ciudad: c.ciudad })),
    });
  } catch (error) {
    return responder(res, error, 'listarCentros');
  }
};

exports.detalleCentro = async (req, res) => {
  try {
    return res.json(await RedFulfillment.detalleCentro(req.params.id));
  } catch (error) {
    return responder(res, error, 'detalleCentro');
  }
};

exports.coberturaCentro = async (req, res) => {
  try {
    await RedFulfillment.centroPorId(req.params.id);
    return res.json(await RedFulfillment.coberturaAgrupada(req.params.id));
  } catch (error) {
    return responder(res, error, 'coberturaCentro');
  }
};

exports.designarCentro = async (req, res) => {
  try {
    const centro = await RedFulfillment.designarCentro(req.params.id, req.usuario.id);
    return res.json({ id: centro.id, nombre: centro.nombre, alcance: centro.alcance });
  } catch (error) {
    return responder(res, error, 'designarCentro');
  }
};

exports.proveedores = async (req, res) => {
  try {
    return res.json(await RedFulfillment.proveedores());
  } catch (error) {
    return responder(res, error, 'proveedores');
  }
};

exports.catalogoGeografico = async (req, res) => {
  try {
    const conCiudades = req.query.conCiudades === '1' || req.query.conCiudades === 'true';
    return res.json(await RedFulfillment.catalogoGeografico({ conCiudades }));
  } catch (error) {
    return responder(res, error, 'catalogoGeografico');
  }
};

// ── Proveedores logísticos ───────────────────────────────────────────────
// Operadores de la red. No son couriers: no pertenecen a ningún comercio y
// sólo un administrador los administra.

exports.crearProveedor = async (req, res) => {
  try {
    const proveedor = await ProveedorLogistico.crear(req.body || {});

    // El wizard crea el proveedor y lo vincula a su centro en un paso: el
    // centro define desde dónde presta servicio, no es un detalle posterior.
    if (req.body?.centro_id) {
      await ProveedorLogistico.vincularACentro(req.body.centro_id, proveedor.id);
    }

    return res.status(201).json(proveedor);
  } catch (error) {
    return responder(res, error, 'crearProveedor');
  }
};

exports.actualizarProveedor = async (req, res) => {
  try {
    return res.json(await ProveedorLogistico.actualizar(req.params.id, req.body || {}));
  } catch (error) {
    return responder(res, error, 'actualizarProveedor');
  }
};

exports.proveedoresDeCentro = async (req, res) => {
  try {
    await RedFulfillment.centroPorId(req.params.centroId);
    return res.json(await ProveedorLogistico.porCentro(req.params.centroId));
  } catch (error) {
    return responder(res, error, 'proveedoresDeCentro');
  }
};

exports.vincularProveedor = async (req, res) => {
  try {
    const vinculo = await ProveedorLogistico.vincularACentro(
      req.params.centroId,
      req.params.proveedorId,
      { prioridad: Number(req.body?.prioridad) || 0 },
    );
    return res.json({ centro_id: vinculo.centro_id, proveedor_logistico_id: vinculo.proveedor_logistico_id });
  } catch (error) {
    return responder(res, error, 'vincularProveedor');
  }
};

exports.desvincularProveedor = async (req, res) => {
  try {
    return res.json(await ProveedorLogistico.desvincularDeCentro(req.params.centroId, req.params.proveedorId));
  } catch (error) {
    return responder(res, error, 'desvincularProveedor');
  }
};

exports.coberturaDeProveedor = async (req, res) => {
  try {
    return res.json(await ProveedorLogistico.cobertura(req.params.centroId, req.params.proveedorId));
  } catch (error) {
    return responder(res, error, 'coberturaDeProveedor');
  }
};

/**
 * Reemplaza la cobertura de UN proveedor desde UN centro.
 *
 * El alcance del borrado es exactamente ese par: borrar por proveedor se
 * llevaría puestas las tarifas que ese mismo proveedor tiene desde los otros
 * centros.
 */
exports.guardarCoberturaDeProveedor = async (req, res) => {
  try {
    const reglas = Array.isArray(req.body?.reglas) ? req.body.reglas : [];
    return res.json(await ProveedorLogistico.reemplazarCobertura(
      req.params.centroId, req.params.proveedorId, reglas,
    ));
  } catch (error) {
    return responder(res, error, 'guardarCoberturaDeProveedor');
  }
};

exports.eliminarProveedor = async (req, res) => {
  try {
    const forzar = req.query.forzar === '1' || req.query.forzar === 'true';
    return res.json(await ProveedorLogistico.eliminar(req.params.id, { forzar }));
  } catch (error) {
    // El 409 lleva el detalle para que la UI pueda decir cuántas tarifas se
    // pierden antes de que alguien confirme.
    if (error.status === 409) {
      return res.status(409).json({ error: error.message, reglas: error.reglas });
    }
    return responder(res, error, 'eliminarProveedor');
  }
};

exports.centrosDeProveedor = async (req, res) => {
  try {
    return res.json(await ProveedorLogistico.centrosDe(req.params.id));
  } catch (error) {
    return responder(res, error, 'centrosDeProveedor');
  }
};
