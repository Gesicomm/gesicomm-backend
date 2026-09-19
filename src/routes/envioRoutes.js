const express = require('express');
const router = express.Router();
const envioController = require('../controllers/envioController');
const seguimientoController = require('../controllers/envioSeguimientoController');
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

// Editar el precio de un item puntual (ej. descuento por seguimiento comercial)
router.patch('/:id/items/:itemId/precio', envioController.actualizarPrecioItem);

// Abastecimiento Gesicom: definir logística/destino antes de pagar, luego pago real por PagoPar o acreditación manual admin
router.put('/:id/abastecimiento/logistica', envioController.definirLogisticaAbastecimiento);
router.post('/:id/abastecimiento/pagopar', envioController.iniciarPagoAbastecimiento);
router.post('/:id/abastecimiento/manual', envioController.actualizarAbastecimientoManual);

// Devolución y pérdida, gestionadas por producto/cantidad (ver plan Gestión de Pedidos)
router.post('/:id/devolucion', envioController.registrarDevolucion);
router.post('/:id/perdida', envioController.registrarPerdida);

// Contador de pedidos por estado, respetando los filtros activos (pestañas de la bandeja)
router.post('/conteo-por-estado', envioController.conteoPorEstado);

// Contador operativo para la bandeja de abastecimientos del administrador
router.post('/conteo-por-abastecimiento', envioController.conteoPorAbastecimiento);

// Resumen financiero minimalista de la pestaña Entregados
router.post('/resumen-entregados', envioController.resumenEntregados);

// Dashboard general del módulo (3 bloques: trabajo pendiente, resultado operativo, desempeño courier)
router.post('/dashboard-general', envioController.dashboardGeneralPedidos);

// Historial/trazabilidad simple de un pedido
router.get('/:id/historial', envioController.obtenerHistorial);

// Eliminar un pedido (solo admin)
router.delete('/:id', envioController.deleteEnvio);

// --- Seguimiento de pedidos por WhatsApp (RF Seguimiento WhatsApp) ---
router.post('/:id/seguimiento/contactos', seguimientoController.registrarContacto);
router.get('/:id/seguimiento/contactos', seguimientoController.listarContactos);
router.get('/:id/seguimiento/etiquetas', seguimientoController.listarEtiquetasDelPedido);
router.post('/:id/seguimiento/etiquetas', seguimientoController.asociarEtiqueta);
router.delete('/:id/seguimiento/etiquetas/:etiquetaId', seguimientoController.quitarEtiqueta);
router.post('/:id/seguimiento/recordatorio', seguimientoController.programarRecordatorio);
router.patch('/:id/seguimiento/recordatorio/:recordatorioId/completar', seguimientoController.completarRecordatorio);
router.patch('/:id/seguimiento/recordatorio/:recordatorioId/cancelar', seguimientoController.cancelarRecordatorio);
router.get('/:id/seguimiento/historial', seguimientoController.historialSeguimiento);
router.post('/:id/seguimiento/nota', seguimientoController.guardarNota);

module.exports = router;
