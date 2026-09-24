const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const ctrl = require('../controllers/solicitudAbastecimientoController');
const { subirComprobanteAbastecimientoMulter } = require('../controllers/envioController');

router.use(verificarToken);

router.post('/cotizar', ctrl.cotizar);
router.post('/', ctrl.crear);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);
router.post('/:id/comprobante', subirComprobanteAbastecimientoMulter, ctrl.subirComprobante);
router.post('/:id/validar-pago', ctrl.validarPago);
router.post('/:id/rechazar-pago', ctrl.rechazarPago);
router.post('/:id/avanzar', ctrl.avanzar);
router.post('/:id/confirmar-recepcion', ctrl.confirmarRecepcion);

module.exports = router;
