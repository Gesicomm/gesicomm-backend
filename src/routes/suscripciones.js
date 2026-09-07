const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/suscripciones.controller');

// Todas públicas: son el paso previo a tener cuenta.
router.get('/planes', ctrl.listarPlanes);
router.post('/suscripciones/checkout', ctrl.iniciarCheckout);
router.get('/suscripciones/estado/:hash', ctrl.estadoPago);
router.get('/suscripciones/token/:token', ctrl.validarToken);

module.exports = router;
