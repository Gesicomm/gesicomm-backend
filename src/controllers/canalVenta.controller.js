/**
 * Controller de Canales de Venta — el catálogo que alimenta el selector
 * "Canal / Origen" de un pedido y el agrupado por canal de los reportes.
 */
const CanalVentaService = require('../services/canalVenta.service');

async function listar(req, res) {
  try {
    const canales = await CanalVentaService.listar(req.usuario.tenantId);
    return res.json({ canales });
  } catch (err) {
    console.error('[canales-venta] listar:', err.message);
    return res.status(500).json({ message: 'Error al obtener los canales de venta.' });
  }
}

async function crear(req, res) {
  try {
    const canal = await CanalVentaService.crear(req.body, req.usuario.tenantId);
    return res.status(201).json(canal);
  } catch (err) {
    console.error('[canales-venta] crear:', err.message);
    const status = err.message.includes('requerido') ? 400 : 500;
    return res.status(status).json({ message: err.message || 'Error al crear el canal de venta.' });
  }
}

async function actualizar(req, res) {
  try {
    const canal = await CanalVentaService.actualizar(req.params.id, req.body, req.usuario.tenantId);
    return res.json(canal);
  } catch (err) {
    console.error('[canales-venta] actualizar:', err.message);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al actualizar el canal de venta.' });
  }
}

module.exports = { listar, crear, actualizar };
