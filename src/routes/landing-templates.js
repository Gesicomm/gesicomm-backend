'use strict';

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/landing-template.controller');

// Rutas protegidas (solo comercios / usuarios registrados)
router.use(verificarToken);
router.use(verificarPermiso('gestionar_landing'));

router.get('/', ctrl.listar);
router.get('/:id', ctrl.detalle);

module.exports = router;
