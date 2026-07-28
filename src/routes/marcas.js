/**
 * Rutas de Marcas.
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const ctrl = require('../controllers/marca.controller');

router.use(verificarToken);

router.post('/buscar', ctrl.buscar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.detalle);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);

module.exports = router;
