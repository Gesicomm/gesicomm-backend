const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const suscripcionesCtrl = require('../controllers/suscripciones.controller');

/**
 * Configuracion del SISTEMA (no de un comercio).
 *
 * Vivian bajo /api/config/payment-gateways, lo que daba dos problemas: la URL
 * mentia (un telefono de contacto no es una pasarela de pago) y no coincidia
 * con la que consume el panel. Router propio montado en /api/config.
 */
router.get('/parametros', verificarToken, soloAdministrador, suscripcionesCtrl.listarParametros);
router.put('/parametros', verificarToken, soloAdministrador, suscripcionesCtrl.guardarParametros);

module.exports = router;
