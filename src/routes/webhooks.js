const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/webhooks.controller');
const suscripcionesCtrl = require('../controllers/suscripciones.controller');

// Los webhooks son públicos y autenticados mediante firmas
router.post('/pagopar', ctrl.pagoparWebhook);
router.post('/speedbox', require('../controllers/speedboxWebhook.controller').webhook);
// Cobros de las suscripciones de Gesicomm — separado del de pedidos de tienda
// porque acredita una suscripcion en vez de confirmar un Envio.
router.post('/pagopar/suscripciones', suscripcionesCtrl.webhookSuscripciones);

module.exports = router;
