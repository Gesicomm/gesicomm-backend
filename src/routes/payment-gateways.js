const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const ctrl = require('../controllers/paymentGateways.controller');
const suscripcionesCtrl = require('../controllers/suscripciones.controller');

router.get('/pagopar', verificarToken, ctrl.getPagoparConfig);
router.put('/pagopar', verificarToken, ctrl.updatePagoparConfig);
router.post('/pagopar/test', verificarToken, ctrl.testPagoparConnection);
// Paso #3 del flujo de PagoPar: consultar estado de un pedido (y reconciliar).
router.post('/pagopar/consultar', verificarToken, ctrl.consultarPedidoPagopar);

// Parametros del sistema (credenciales de PagoPar de Gesicomm). Se montan
// bajo /api/config, junto a las pasarelas, pero son de OTRA naturaleza: estas
// son del sistema, las de arriba son de cada comercio.
router.get('/parametros', verificarToken, suscripcionesCtrl.listarParametros);
router.put('/parametros', verificarToken, suscripcionesCtrl.guardarParametros);

module.exports = router;
