/**
 * Rutas de movimientos financieros (Finanzas → Control financiero).
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/costoGasto.controller');

router.use(verificarToken);

router.post('/buscar', verificarPermiso('ver_costos_gastos'), ctrl.buscar);
router.get('/resumen', verificarPermiso('ver_costos_gastos'), ctrl.resumen);
router.post('/reporte-desglose', verificarPermiso('ver_costos_gastos'), ctrl.reporteDesglose);
router.get('/reporte-flujo-caja', verificarPermiso('ver_costos_gastos'), ctrl.reporteFlujoCaja);
router.get('/exportar/excel', verificarPermiso('ver_costos_gastos'), ctrl.exportarExcel);
router.get('/exportar/pdf', verificarPermiso('ver_costos_gastos'), ctrl.exportarPdf);
router.post('/', verificarPermiso('gestionar_costos_gastos'), ctrl.crear);
router.get('/:id', verificarPermiso('ver_costos_gastos'), ctrl.detalle);
router.put('/:id', verificarPermiso('gestionar_costos_gastos'), ctrl.actualizar);
router.delete('/:id', verificarPermiso('gestionar_costos_gastos'), ctrl.eliminar);
router.post('/:id/duplicar', verificarPermiso('gestionar_costos_gastos'), ctrl.duplicar);
router.patch('/:id/marcar-pagado', verificarPermiso('gestionar_costos_gastos'), ctrl.marcarPagado);
router.post('/:id/comprobante', verificarPermiso('gestionar_costos_gastos'), ctrl.subirComprobanteMiddleware, ctrl.subirComprobante);

module.exports = router;
