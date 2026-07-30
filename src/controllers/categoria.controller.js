/**
 * Controller de Categorías.
 */
const CategoriaService = require('../services/categoria.service');

async function buscar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const result = await CategoriaService.buscar(req.body, inquilino_id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener categorías.' });
  }
}

async function crear(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const categoria = await CategoriaService.crear(req.body, inquilino_id);
    return res.status(201).json(categoria);
  } catch (err) {
    console.error(err);
    return res.status(err.message.includes('requerido') ? 400 : 500).json({ message: err.message || 'Error al crear categoría.' });
  }
}

async function detalle(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const categoria = await CategoriaService.detalle(req.params.id, inquilino_id);
    return res.json(categoria);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al obtener categoría.' });
  }
}

async function actualizar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const categoria = await CategoriaService.actualizar(req.params.id, req.body, inquilino_id);
    return res.json(categoria);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al actualizar categoría.' });
  }
}

async function eliminar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    await CategoriaService.eliminar(req.params.id, inquilino_id);
    return res.json({ message: 'Categoría dada de baja correctamente.' });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al dar de baja la categoría.' });
  }
}

module.exports = { buscar, crear, detalle, actualizar, eliminar };
