const express = require('express');
const router = express.Router();
const liquidacionController = require('../controllers/liquidacion.controller');
const { verificarToken } = require('../middleware/autenticacion');

router.use(verificarToken);

router.post('/previsualizar', liquidacionController.previsualizar);
router.post('/confirmar', liquidacionController.confirmar);
router.get('/courier/:courier_id', liquidacionController.listarPorCourier);

module.exports = router;
