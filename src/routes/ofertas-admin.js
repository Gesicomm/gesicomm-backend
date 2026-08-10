'use strict';

/**
 * Rutas administrativas de Ofertas por id (fuera del anidado por producto).
 * Montadas en: /api/ofertas
 */
const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ofertaCtrl = require('../controllers/oferta.controller');

router.use(verificarToken);

router.put('/:id', verificarPermiso('editar_productos'), ofertaCtrl.actualizar);
router.delete('/:id', verificarPermiso('editar_productos'), ofertaCtrl.eliminar);

module.exports = router;
