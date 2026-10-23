const express = require('express');
const router = express.Router();
const envioController = require('../controllers/envioController');
const envioTarifaController = require('../controllers/envioTarifa.controller');
const seguimientoController = require('../controllers/envioSeguimientoController');
const { verificarToken } = require('../middleware/autenticacion');
const { exigirTiendaActiva } = require('../middleware/resolverTiendaActiva');

router.use(verificarToken);
router.use(exigirTiendaActiva);

// Usamos POST para listar con filtros dinámicos (fecha, estado) según la regla global
router.post('/list', envioController.listEnvios);

// Vista de tabla con paginación, búsqueda y filtros completos
router.post('/list-paginado', envioController.listEnviosPaginados);

// Centro de Inteligencia Comercial & Analytics (filtros dinámicos en req.body)
router.post('/metricas-dashboard', envioController.getDashboardMetricas);

// Crear un nuevo pedido/envío
router.post('/cotizar-entrega-raha', envioTarifaController.cotizarEntregaRaha);
router.post('/', envioController.createEnvio);

// Cola admin del Camino 2 (inbound propio -> Gesicomm): pedidos vendidos
// desde stock que fisicamente esta en un Centro de Fulfillment de Gesicomm.
router.get('/gesicomm/pendientes', envioController.listarPedidosParaPrepararGesicomm);

// Actualizar estado o courier
router.put('/:id/estado', envioController.updateEstado);

// Corrección manual de Lead Orgánico/Campaña sobre el cálculo automático
// (ver lead_tipo_manual en Envio.js) — separado de /estado, que tiene su
// propia máquina de transiciones y no debería validar nada de esto.
router.put('/:id/lead-tipo', envioController.actualizarLeadTipoManual);
router.get('/:id/proveedor-logistico-sugerido', envioController.sugerirProveedorLogisticoGesicomm);

// Editar el precio de un item puntual (ej. descuento por seguimiento comercial)
router.patch('/:id/items/:itemId/precio', envioController.actualizarPrecioItem);

// Abastecimiento Gesicom: definir logística/destino antes de pagar, luego
// transferencia + comprobante y seguimiento operativo por máquina de
// estados (ver services/abastecimiento/estadoMachine.js).
router.post('/:id/abastecimiento/cotizar-logistica', envioController.cotizarLogisticaAbastecimiento);
router.put('/:id/abastecimiento/logistica', envioController.definirLogisticaAbastecimiento);
router.get('/:id/abastecimiento/datos-transferencia', envioController.obtenerDatosTransferenciaAbastecimiento);
router.post(
  '/:id/abastecimiento/comprobante',
  envioController.subirComprobanteAbastecimientoMiddleware,
  envioController.subirComprobanteAbastecimiento,
);
router.post('/:id/abastecimiento/pago/validar', envioController.validarPagoAbastecimiento);
router.post('/:id/abastecimiento/pago/rechazar', envioController.rechazarPagoAbastecimiento);
router.post('/:id/abastecimiento/avanzar', envioController.avanzarAbastecimiento);
router.post('/:id/abastecimiento/confirmar-recepcion', envioController.confirmarRecepcionAbastecimiento);
router.get('/:id/abastecimiento/timeline', envioController.timelineAbastecimiento);

// Devolución y pérdida, gestionadas por producto/cantidad (ver plan Gestión de Pedidos)
router.post('/:id/devolucion', envioController.registrarDevolucion);
router.post('/:id/perdida', envioController.registrarPerdida);

// Pestaña Resumen: ventas del período, y el Kanban de mensajes por enviar
// (una columna por fase; filtrado y paginado en el servidor).
router.post('/resumen', envioController.resumenPedidos);
router.post('/seguimiento/tablero', envioController.tableroSeguimiento);
router.post('/seguimiento/pendientes', envioController.pendientesSeguimiento);

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
// Flujos activos + lo que ya se abrio de cada fase en ESTE pedido.
router.get('/:id/seguimiento/flujos', seguimientoController.flujosDelPedido);
router.get('/:id/seguimiento/imagenes/:itemId', seguimientoController.copiarImagenProducto);
router.post('/:id/seguimiento/contactos', seguimientoController.registrarContacto);
router.get('/:id/seguimiento/contactos', seguimientoController.listarContactos);
// El operador confirma que mandó el mensaje de la fase: es lo que la hace avanzar.
router.post('/:id/seguimiento/fases/:faseId/completar', seguimientoController.completarFase);
router.delete('/:id/seguimiento/fases/:faseId/completar', seguimientoController.descompletarFase);
router.get('/:id/seguimiento/etiquetas', seguimientoController.listarEtiquetasDelPedido);
router.post('/:id/seguimiento/etiquetas', seguimientoController.asociarEtiqueta);
router.delete('/:id/seguimiento/etiquetas/:etiquetaId', seguimientoController.quitarEtiqueta);
router.post('/:id/seguimiento/recordatorio', seguimientoController.programarRecordatorio);
router.patch('/:id/seguimiento/recordatorio/:recordatorioId/completar', seguimientoController.completarRecordatorio);
router.patch('/:id/seguimiento/recordatorio/:recordatorioId/cancelar', seguimientoController.cancelarRecordatorio);
router.get('/:id/seguimiento/historial', seguimientoController.historialSeguimiento);
router.post('/:id/seguimiento/nota', seguimientoController.guardarNota);

module.exports = router;
