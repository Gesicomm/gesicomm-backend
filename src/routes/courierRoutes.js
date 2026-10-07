const express = require('express');
const router = express.Router();
const courierController = require('../controllers/courierController');
const { verificarToken } = require('../middleware/autenticacion'); // Middleware de autenticacion
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');

// Todas las rutas requieren autenticación
router.use(verificarToken);
router.use(resolverTiendaActiva);

router.get('/zonas-delivery', courierController.listZonasDelivery);
router.put('/zonas-delivery', courierController.replaceZonasDelivery);
router.post('/geografia', courierController.catalogoGeografico);

router.get('/', courierController.listCouriers);
router.post('/', courierController.createCourier);
router.get('/:id/acceso', courierController.getAccesoCourier);
router.post('/:id/acceso', courierController.createAccesoCourier);
router.put('/:id/acceso/password', courierController.updatePasswordAccesoCourier);
router.put('/:id/acceso/estado', courierController.updateEstadoAccesoCourier);
router.put('/:id', courierController.updateCourier);
router.delete('/:id', courierController.deleteCourier);

module.exports = router;
