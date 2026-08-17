const express = require('express');
const router = express.Router();
const ReporteService = require('../services/reporteService');
const { verificarToken } = require('../middleware/autenticacion');

// POST /api/reportes/kpis
router.post('/kpis', verificarToken, async (req, res) => {
  try {
    // req.usuario en vez de req.user
    const kpis = await ReporteService.obtenerKPIs(req.usuario.id, req.body);
    res.json(kpis);
  } catch (error) {
    console.error('Error al obtener KPIs:', error);
    res.status(500).json({ message: 'Error interno del servidor al procesar KPIs' });
  }
});

// POST /api/reportes/pedidos
router.post('/pedidos', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    const datos = await ReporteService.obtenerPedidos(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener pedidos para reporte:', error);
    res.status(500).json({ message: 'Error interno al procesar pedidos' });
  }
});

// POST /api/reportes/items
router.post('/items', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    const datos = await ReporteService.obtenerItemsVendidos(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener ítems para reporte:', error);
    res.status(500).json({ message: 'Error interno al procesar ítems' });
  }
});

module.exports = router;
