const express = require('express');
const router = express.Router();
const courierController = require('../controllers/courierController');
const { verificarToken } = require('../middleware/autenticacion'); // Middleware de autenticacion

// Todas las rutas requieren autenticación
router.use(verificarToken);

router.get('/zonas-delivery', courierController.listZonasDelivery);
router.put('/zonas-delivery', courierController.replaceZonasDelivery);

router.get('/', courierController.listCouriers);
router.post('/', courierController.createCourier);
router.put('/:id', courierController.updateCourier);
router.delete('/:id', courierController.deleteCourier);

module.exports = router;
