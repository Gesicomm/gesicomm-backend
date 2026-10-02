const express = require('express');
const router = express.Router();
const courierPortalController = require('../controllers/courierPortalController');
const { verificarCourierToken } = require('../middleware/autenticacionCourier');

router.use(verificarCourierToken);

router.get('/pedidos', courierPortalController.listPedidos);
router.get('/metodos-pago', courierPortalController.listMetodosPago);
router.put('/pedidos/:id/entregar', courierPortalController.marcarEntregado);
router.put('/pedidos/:id/reprogramar', courierPortalController.marcarReprogramado);
router.put('/pedidos/:id/no-entregado', courierPortalController.marcarNoEntregado);

module.exports = router;
