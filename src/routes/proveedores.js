/**
 * Rutas de Proveedores (costos/gastos).
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/proveedor.controller');

router.use(verificarToken);

router.post('/buscar', verificarPermiso('ver_costos_gastos'), ctrl.buscar);
router.post('/', verificarPermiso('gestionar_costos_gastos'), ctrl.crear);
router.put('/:id', verificarPermiso('gestionar_costos_gastos'), ctrl.actualizar);
router.delete('/:id', verificarPermiso('gestionar_costos_gastos'), ctrl.eliminar);

module.exports = router;
