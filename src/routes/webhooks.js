const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/webhooks.controller');

// Los webhooks son públicos y autenticados mediante firmas
router.post('/pagopar', ctrl.pagoparWebhook);

module.exports = router;
