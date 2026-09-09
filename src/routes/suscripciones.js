const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/suscripciones.controller');
const { verificarToken } = require('../middleware/autenticacion');

// Públicas: permiten ver planes y el flujo legacy de pagar antes del alta.
router.get('/planes', ctrl.listarPlanes);
router.post('/suscripciones/checkout', ctrl.iniciarCheckout);
router.get('/suscripciones/estado/:hash', ctrl.estadoPago);
router.get('/suscripciones/token/:token', ctrl.validarToken);

// Privadas: flujo nuevo pedido, primero registro/login y después plan pago.
router.get('/suscripciones/mi-estado', verificarToken, ctrl.miEstado);
router.post('/suscripciones/pagopar-dummy', verificarToken, ctrl.pagoDummyPagopar);

module.exports = router;
