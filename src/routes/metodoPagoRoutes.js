const express = require('express');
const router = express.Router();
const metodoPagoController = require('../controllers/metodoPagoController');
const { verificarToken } = require('../middleware/autenticacion');

// Todas las rutas requieren autenticación
router.use(verificarToken);

router.get('/', metodoPagoController.listMetodosPago);
router.post('/', metodoPagoController.createMetodoPago);
router.put('/:id', metodoPagoController.updateMetodoPago);
router.delete('/:id', metodoPagoController.deleteMetodoPago);

module.exports = router;
