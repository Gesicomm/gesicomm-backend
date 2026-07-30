/**
 * Controller de Marcas.
 */
const MarcaService = require('../services/marca.service');

async function buscar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const result = await MarcaService.buscar(req.body, inquilino_id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener marcas.' });
  }
}

async function crear(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const marca = await MarcaService.crear(req.body, inquilino_id);
    return res.status(201).json(marca);
  } catch (err) {
    console.error(err);
    return res.status(err.message.includes('requerido') ? 400 : 500).json({ message: err.message || 'Error al crear marca.' });
  }
}

async function detalle(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const marca = await MarcaService.detalle(req.params.id, inquilino_id);
    return res.json(marca);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al obtener marca.' });
  }
}

async function actualizar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const marca = await MarcaService.actualizar(req.params.id, req.body, inquilino_id);
    return res.json(marca);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al actualizar marca.' });
  }
}

async function eliminar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    await MarcaService.eliminar(req.params.id, inquilino_id);
    return res.json({ message: 'Marca dada de baja correctamente.' });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al dar de baja la marca.' });
  }
}

module.exports = { buscar, crear, detalle, actualizar, eliminar };
