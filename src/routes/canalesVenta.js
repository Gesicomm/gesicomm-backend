/**
 * Rutas del catálogo de Canales de Venta.
 * Montadas en: /api/canales-venta
 *
 * El listado no exige permiso de gestión a propósito: cualquiera que pueda
 * cargar un pedido necesita ver los canales para elegir uno en el
 * formulario. Crear/editar el catálogo sí queda detrás de un permiso.
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/canalVenta.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.post('/', verificarPermiso('configurar_sistema'), ctrl.crear);
router.put('/:id', verificarPermiso('configurar_sistema'), ctrl.actualizar);

module.exports = router;
