/**
 * Controller de Proveedores (costos/gastos).
 */
const ProveedorService = require('../services/proveedor.service');

async function buscar(req, res) {
  try {
    const result = await ProveedorService.buscar(req.body, req.usuario.id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener proveedores.' });
  }
}

async function crear(req, res) {
  try {
    const proveedor = await ProveedorService.crear(req.body, req.usuario.id);
    return res.status(201).json(proveedor);
  } catch (err) {
    console.error(err);
    return res.status(err.message.includes('requerido') ? 400 : 500).json({ message: err.message || 'Error al crear proveedor.' });
  }
}

async function actualizar(req, res) {
  try {
    const proveedor = await ProveedorService.actualizar(req.params.id, req.body, req.usuario.id);
    return res.json(proveedor);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al actualizar proveedor.' });
  }
}

async function eliminar(req, res) {
  try {
    await ProveedorService.eliminar(req.params.id, req.usuario.id);
    return res.json({ message: 'Proveedor dado de baja correctamente.' });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al dar de baja el proveedor.' });
  }
}

module.exports = { buscar, crear, actualizar, eliminar };
