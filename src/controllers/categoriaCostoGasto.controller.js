/**
 * Controller de Categorías de Costos/Gastos.
 */
const CategoriaCostoGastoService = require('../services/categoriaCostoGasto.service');

async function listar(req, res) {
  try {
    const categorias = await CategoriaCostoGastoService.listar(req.usuario.tenantId);
    return res.json({ categorias });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener categorías.' });
  }
}

async function crear(req, res) {
  try {
    const categoria = await CategoriaCostoGastoService.crear(req.body, req.usuario.tenantId);
    return res.status(201).json(categoria);
  } catch (err) {
    console.error(err);
    return res.status(err.message.includes('requerido') ? 400 : 500).json({ message: err.message || 'Error al crear categoría.' });
  }
}

async function eliminar(req, res) {
  try {
    await CategoriaCostoGastoService.eliminar(req.params.id, req.usuario.tenantId);
    return res.json({ message: 'Categoría dada de baja correctamente.' });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrada') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al dar de baja la categoría.' });
  }
}

module.exports = { listar, crear, eliminar };
