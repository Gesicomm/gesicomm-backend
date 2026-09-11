const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const ctrl = require('../controllers/paymentGateways.controller');
const suscripcionesCtrl = require('../controllers/suscripciones.controller');

router.get('/pagopar', verificarToken, ctrl.getPagoparConfig);
router.put('/pagopar', verificarToken, ctrl.updatePagoparConfig);
router.post('/pagopar/test', verificarToken, ctrl.testPagoparConnection);
// Paso #3 del flujo de PagoPar: consultar estado de un pedido (y reconciliar).
router.post('/pagopar/consultar', verificarToken, ctrl.consultarPedidoPagopar);

// Los parametros del SISTEMA se mudaron a routes/config.js (/api/config):
// no son una pasarela de pago y la URL anidada confundia.
router.get('/afiliados', verificarToken, soloAdministrador, suscripcionesCtrl.obtenerAfiliadosConfig);
router.put('/afiliados', verificarToken, soloAdministrador, suscripcionesCtrl.guardarAfiliadosConfig);

module.exports = router;
