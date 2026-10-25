const express = require('express');
const router = express.Router();
const liquidacionController = require('../controllers/liquidacion.controller');
const { verificarToken } = require('../middleware/autenticacion');
const { exigirTiendaActiva } = require('../middleware/resolverTiendaActiva');

router.use(verificarToken);
router.use(exigirTiendaActiva);

router.post('/previsualizar', liquidacionController.previsualizar);
router.post('/confirmar', liquidacionController.confirmar);
router.get('/courier/:courier_id', liquidacionController.listarPorCourier);
// Qué falta rendir con cada courier (sin fechas): arranque de la pestaña Rendición.
router.get('/saldos-pendientes', liquidacionController.saldosPendientes);

module.exports = router;
