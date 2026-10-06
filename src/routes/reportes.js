const express = require('express');
const router = express.Router();
const ReporteService = require('../services/reporteService');
const { verificarToken } = require('../middleware/autenticacion');

// POST /api/reportes/kpis
router.post('/kpis', verificarToken, async (req, res) => {
  try {
    // req.usuario en vez de req.user
    const filtros = { ...req.body, tienda_id: req.usuario.tiendaId || null };
    const kpis = await ReporteService.obtenerKPIs(req.usuario.id, filtros);
    res.json(kpis);
  } catch (error) {
    console.error('Error al obtener KPIs:', error);
    res.status(500).json({ message: 'Error interno del servidor al procesar KPIs' });
  }
});

// POST /api/reportes/evolucion-ventas
router.post('/evolucion-ventas', verificarToken, async (req, res) => {
  try {
    const filtros = { ...req.body, tienda_id: req.usuario.tiendaId || null };
    const data = await ReporteService.obtenerEvolucionVentas(req.usuario.id, filtros);
    res.json(data);
  } catch (error) {
    console.error('Error al obtener evolucion ventas:', error);
    res.status(500).json({ message: 'Error interno' });
  }
});

// POST /api/reportes/pedidos
router.post('/pedidos', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
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
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerItemsVendidos(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener ítems para reporte:', error);
    res.status(500).json({ message: 'Error interno al procesar ítems' });
  }
});

// POST /api/reportes/comisiones
router.post('/comisiones', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteComisiones(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener comisiones:', error);
    res.status(500).json({ message: 'Error interno al procesar comisiones' });
  }
});

// POST /api/reportes/facturacion
router.post('/facturacion', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteFacturacion(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de facturacion:', error);
    res.status(500).json({ error: 'Error al generar reporte de facturacion' });
  }
});

// POST /api/reportes/productos
router.post('/productos', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteProductos(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de productos:', error);
    res.status(500).json({ error: 'Error al generar reporte de productos' });
  }
});

// POST /api/reportes/confirmadores
router.post('/confirmadores', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteConfirmadores(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de confirmadores:', error);
    res.status(500).json({ error: 'Error al generar reporte de confirmadores' });
  }
});

// POST /api/reportes/composicion
router.post('/composicion', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteComposicion(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de composicion:', error);
    res.status(500).json({ error: 'Error al generar reporte de composicion' });
  }
});


// POST /api/reportes/clientes
router.post('/clientes', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteClientes(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de clientes:', error);
    res.status(500).json({ error: 'Error al generar reporte de clientes' });
  }
});

// POST /api/reportes/metodos-pago
router.post('/metodos-pago', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteMetodosPago(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de metodos de pago:', error);
    res.status(500).json({ error: 'Error al generar reporte de metodos de pago' });
  }
});

// POST /api/reportes/fallos
router.post('/fallos', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteFallos(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de fallos:', error);
    res.status(500).json({ error: 'Error al generar reporte de fallos' });
  }
});


// POST /api/reportes/geografia
router.post('/geografia', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteGeografia(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de geografia:', error);
    res.status(500).json({ error: 'Error al generar reporte de geografia' });
  }
});

// POST /api/reportes/logistica
router.post('/logistica', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteLogistica(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de logistica:', error);
    res.status(500).json({ error: 'Error al generar reporte de logistica' });
  }
});

// POST /api/reportes/cross-selling
router.post('/cross-selling', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 50, ...filtros } = req.body;
    filtros.tienda_id = req.usuario.tiendaId || null;
    const datos = await ReporteService.obtenerReporteCrossSelling(req.usuario.id, parseInt(pagina), parseInt(limite), filtros);
    res.json(datos);
  } catch (error) {
    console.error('Error al obtener reporte de cross-selling:', error);
    res.status(500).json({ error: 'Error al generar reporte de cross-selling' });
  }
});

module.exports = router;
