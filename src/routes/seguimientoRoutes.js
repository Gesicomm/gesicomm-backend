const express = require('express');
const router = express.Router();
const seguimientoController = require('../controllers/seguimientoController');
const flujoController = require('../controllers/seguimientoFlujoController');
const { verificarToken } = require('../middleware/autenticacion');

router.use(verificarToken);

// Flujos de mensajes de WhatsApp: el proceso y sus fases ordenadas. Es la
// unidad principal del seguimiento; las plantillas sueltas de abajo quedan
// por compatibilidad con lo ya cargado.
router.get('/flujos', flujoController.listar);
router.get('/flujos/:id', flujoController.obtener);
router.post('/flujos', flujoController.crear);
router.put('/flujos/:id', flujoController.actualizar);
router.delete('/flujos/:id', flujoController.eliminar);

// Plantillas de WhatsApp sueltas (BE-02, legacy pre-flujos)
router.get('/plantillas', seguimientoController.listarPlantillas);
router.get('/plantillas/:id', seguimientoController.obtenerPlantilla);
router.post('/plantillas', seguimientoController.crearPlantilla);
router.put('/plantillas/:id', seguimientoController.editarPlantilla);
router.delete('/plantillas/:id', seguimientoController.eliminarPlantilla);

// Variables disponibles para armar el mensaje de una plantilla (BE-03)
router.get('/variables', seguimientoController.listarVariables);

// Etiquetas de seguimiento (BE-04)
router.get('/etiquetas', seguimientoController.listarEtiquetas);
router.post('/etiquetas', seguimientoController.crearEtiqueta);
router.put('/etiquetas/:id', seguimientoController.editarEtiqueta);
router.delete('/etiquetas/:id', seguimientoController.eliminarEtiqueta);

// Configuración de tiempos rápidos de recordatorio (BE-09)
router.get('/configuracion', seguimientoController.obtenerConfiguracion);
router.put('/configuracion', seguimientoController.actualizarConfiguracion);

// Notificaciones internas (BE-19)
router.get('/notificaciones', seguimientoController.listarNotificaciones);
router.patch('/notificaciones/:id/leida', seguimientoController.marcarNotificacionLeida);
router.patch('/notificaciones/leer-todas', seguimientoController.marcarTodasLeidas);

module.exports = router;
