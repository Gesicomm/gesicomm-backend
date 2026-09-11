'use strict';

const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const BrevoService = require('../services/brevo.service');

router.use(verificarToken);
router.use(soloAdministrador);

router.post('/test', async (req, res) => {
  try {
    const resultado = await BrevoService.enviarPrueba({ to: req.body?.to });
    const status = resultado.enviado ? 200 : 400;
    return res.status(status).json(resultado);
  } catch (error) {
    console.error('[BREVO] Error en endpoint de prueba:', error);
    return res.status(500).json({ enviado: false, error: 'Error interno enviando prueba Brevo.' });
  }
});

module.exports = router;
