/**
 * Cupones de descuento del comercio.
 * Montadas en: /api/cupones
 *
 * No usan `verificarPermiso`: un cupón pertenece al comercio que lo crea y
 * el service filtra todo por req.usuario.id, así que alcanza con estar
 * autenticado. Es el mismo criterio que la landing o la tienda propia —
 * no es configuración del sistema, es contenido del comercio.
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const ctrl = require('../controllers/cupon.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);

module.exports = router;
