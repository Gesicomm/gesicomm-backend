const express = require('express');
const router = express.Router();
const envioController = require('../controllers/envioController');
const { verificarToken } = require('../middleware/autenticacion');

router.use(verificarToken);

// Usamos POST para listar con filtros dinámicos (fecha, estado) según la regla global
router.post('/list', envioController.listEnvios);

// Centro de Inteligencia Comercial & Analytics (filtros dinámicos en req.body)
router.post('/metricas-dashboard', envioController.getDashboardMetricas);

// Crear un nuevo pedido/envío
router.post('/', envioController.createEnvio);

// Actualizar estado o courier
router.put('/:id/estado', envioController.updateEstado);

module.exports = router;
