const express = require('express');
const router = express.Router();
const envioController = require('../controllers/envioController');
const { verificarToken } = require('../middleware/autenticacion');

router.use(verificarToken);

// Usamos POST para listar con filtros dinámicos (fecha, estado) según la regla global
router.post('/list', envioController.listEnvios);

// Vista de tabla con paginación, búsqueda y filtros completos
router.post('/list-paginado', envioController.listEnviosPaginados);

// Centro de Inteligencia Comercial & Analytics (filtros dinámicos en req.body)
router.post('/metricas-dashboard', envioController.getDashboardMetricas);

// Crear un nuevo pedido/envío
router.post('/', envioController.createEnvio);

// Actualizar estado o courier
router.put('/:id/estado', envioController.updateEstado);

// Devolución y pérdida, gestionadas por producto/cantidad (ver plan Gestión de Pedidos)
router.post('/:id/devolucion', envioController.registrarDevolucion);
router.post('/:id/perdida', envioController.registrarPerdida);

// Contador de pedidos por estado, respetando los filtros activos (pestañas de la bandeja)
router.post('/conteo-por-estado', envioController.conteoPorEstado);

// Resumen financiero minimalista de la pestaña Entregados
router.post('/resumen-entregados', envioController.resumenEntregados);

// Dashboard general del módulo (3 bloques: trabajo pendiente, resultado operativo, desempeño courier)
router.post('/dashboard-general', envioController.dashboardGeneralPedidos);

// Historial/trazabilidad simple de un pedido
router.get('/:id/historial', envioController.obtenerHistorial);

// Eliminar un pedido (solo admin)
router.delete('/:id', envioController.deleteEnvio);

module.exports = router;
