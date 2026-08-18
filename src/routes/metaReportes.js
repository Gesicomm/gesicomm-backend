'use strict';

/**
 * Rutas de Reportes de Meta Ads. Montadas en: /api/meta-reportes
 *
 * POST   /campanas                    → crear campaña interna (genera nombre_interno)
 * GET    /campanas                    → listar campañas internas
 * PUT    /campanas/:id                → editar campaña interna
 * DELETE /campanas/:id                → eliminar (si no tiene reportes vinculados)
 * POST   /importar                    → subir CSV de Meta Ads Manager
 * GET    /importaciones               → historial de importaciones
 * DELETE /importaciones/:id           → deshacer una importación (borra sus filas)
 * GET    /filas                       → filas de reporte (paginado, filtrable)
 * PUT    /filas/:id/vincular          → vincular manualmente una fila sin match
 * GET    /metricas-por-producto       → agregado de métricas por producto
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

router.post('/importar', ctrl.subirCSVMiddleware, ctrl.importarCSV);
router.get('/importaciones', ctrl.listarImportaciones);
router.delete('/importaciones/:id', ctrl.eliminarImportacion);

router.get('/filas', ctrl.listarFilas);
router.put('/filas/:id/vincular', ctrl.vincularFila);

router.get('/metricas-por-producto', ctrl.metricasPorProducto);

module.exports = router;
