const express = require('express');
const router = express.Router();
const educacionController = require('../controllers/educacionController');
const { verificarToken } = require('../middleware/autenticacion');

// Todas las rutas de educación requieren usuario autenticado
router.use(verificarToken);

// Listado de módulos con progresión secuencial
router.get('/modulos', educacionController.getModulos);

// Detalle de módulo específico y su examen (sin respuestas)
router.get('/modulos/:id', educacionController.getDetalleModulo);

// Marcar video como completado
router.post('/modulos/:id/video-visto', educacionController.marcarVideoVisto);

// Enviar y calificar examen
router.post('/modulos/:id/enviar-examen', educacionController.enviarExamen);

// Estado de menús desbloqueados para el sidebar
router.get('/progreso-sidebar', educacionController.getProgresoSidebar);

module.exports = router;
