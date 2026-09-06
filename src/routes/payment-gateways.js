const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const ctrl = require('../controllers/paymentGateways.controller');

router.get('/pagopar', verificarToken, ctrl.getPagoparConfig);
router.put('/pagopar', verificarToken, ctrl.updatePagoparConfig);
router.post('/pagopar/test', verificarToken, ctrl.testPagoparConnection);
// Paso #3 del flujo de PagoPar: consultar estado de un pedido (y reconciliar).
router.post('/pagopar/consultar', verificarToken, ctrl.consultarPedidoPagopar);

module.exports = router;
