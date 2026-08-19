/**
 * Rutas de Categorías de Costos/Gastos.
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/categoriaCostoGasto.controller');

router.use(verificarToken);

router.get('/', verificarPermiso('ver_costos_gastos'), ctrl.listar);
router.post('/', verificarPermiso('gestionar_costos_gastos'), ctrl.crear);
router.delete('/:id', verificarPermiso('gestionar_costos_gastos'), ctrl.eliminar);

module.exports = router;
