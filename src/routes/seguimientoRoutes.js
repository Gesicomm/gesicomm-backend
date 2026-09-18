const express = require('express');
const router = express.Router();
const seguimientoController = require('../controllers/seguimientoController');
const { verificarToken } = require('../middleware/autenticacion');

router.use(verificarToken);

// Plantillas de WhatsApp (BE-02)
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
