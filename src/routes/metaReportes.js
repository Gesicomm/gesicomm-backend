'use strict';

/**
 * Rutas de Reportes de Meta Ads. Montadas en: /api/meta-reportes
 *
 * POST   /campanas                    → crear campaña interna (genera nombre_interno)
 * GET    /campanas                    → listar campañas internas
 * PUT    /campanas/:id                → editar campaña interna
 * DELETE /campanas/:id                → eliminar (si no tiene gasto ni reportes vinculados)
 * POST   /campanas/:id/gastos         → cargar gasto de un rango de fechas
 * POST   /campanas/:id/gastos/listar  → histórico de gasto (paginado) + total
 * PUT    /gastos/:id                  → corregir un registro de gasto
 * DELETE /gastos/:id                  → eliminar un registro de gasto
 * POST   /importar                    → subir CSV de Meta Ads Manager
 * GET    /importaciones               → historial de importaciones
 * DELETE /importaciones/:id           → deshacer una importación (borra sus filas)
 * GET    /filas                       → filas de reporte (paginado, filtrable)
 * PUT    /filas/:id/vincular          → vincular manualmente una fila sin match
 * GET    /metricas-por-producto       → agregado de métricas por producto
 * GET    /resumen                     → KPIs del período + variación vs. período anterior
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/metaReportes.controller');

router.use(verificarToken);
router.use(verificarPermiso('gestionar_meta_ads'));

router.post('/campanas', ctrl.crearCampana);
router.get('/campanas', ctrl.listarCampanas);
router.put('/campanas/:id', ctrl.actualizarCampana);
router.delete('/campanas/:id', ctrl.eliminarCampana);

router.post('/campanas/:id/gastos', ctrl.crearGasto);
router.post('/campanas/:id/gastos/listar', ctrl.listarGastos);
router.put('/gastos/:id', ctrl.actualizarGasto);
router.delete('/gastos/:id', ctrl.eliminarGasto);

router.post('/importar/analizar', ctrl.subirCSVMiddleware, ctrl.analizarCSV);
router.post('/importar', ctrl.subirCSVMiddleware, ctrl.importarCSV);
router.post('/importaciones/listar', ctrl.listarImportaciones);
router.delete('/importaciones/:id', ctrl.eliminarImportacion);

router.post('/filas/listar', ctrl.listarFilas);
router.put('/filas/:id/vincular', ctrl.vincularFila);

router.post('/metricas-por-producto', ctrl.metricasPorProducto);
router.post('/resumen', ctrl.resumen);

module.exports = router;
