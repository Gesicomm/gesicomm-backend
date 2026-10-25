const express = require('express');
const router = express.Router();
const ReporteService = require('../services/reporteService');
const { verificarToken } = require('../middleware/autenticacion');

// Módulo Clientes. La lista sale del reporte de clientes (POST
// /api/reportes/clientes con `buscador` y sin fechas = historial completo);
// acá vive solo la ficha. Mismo criterio de alcance que reportes: la tienda
// activa del token, nunca la que mande el body.
router.post('/pedidos', verificarToken, async (req, res) => {
  try {
    const datos = await ReporteService.obtenerPedidosCliente(
      (req.comercioId || req.usuario.id),
      req.body?.cliente_key,
      { tienda_id: req.usuario.tiendaId || null },
    );
    res.json(datos);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('Error al obtener los pedidos del cliente:', error);
    res.status(500).json({ error: 'Error al obtener los pedidos del cliente' });
  }
});

module.exports = router;
