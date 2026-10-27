const express = require('express');
const { z } = require('zod');
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const { validar } = require('../middleware/validacion');
const { asyncHandler } = require('../utils/asyncHandler');
const Tutoriales = require('../services/tutorialSistema.service');

const router = express.Router();
router.use(verificarToken);

router.get('/', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await Tutoriales.listar());
}));

router.put('/:clave', soloAdministrador, validar(z.object({ url: z.string().trim().max(500) })), asyncHandler(async (req, res) => {
  res.json(await Tutoriales.guardar(req.params.clave, req.body.url, req.usuario.id));
}));

module.exports = router;
