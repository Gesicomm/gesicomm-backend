const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const inventarioController = require('../controllers/inventarioController');

router.use(verificarToken);

router.get('/centros-destino', inventarioController.listarCentrosDestino);

// Rutas de Ingresos de Inventario (Inbound)
router.post('/ingresos/listado', inventarioController.listarIngresos);
router.post('/ingresos', inventarioController.crearBorrador);
router.get('/ingresos/:id', inventarioController.obtenerIngreso);

// Acciones de Flujo
router.post('/ingresos/:id/confirmar-envio', inventarioController.confirmarEnvio);
router.post('/ingresos/:id/marcar-en-transito', inventarioController.marcarEnTransito);

// Acciones ADMIN
router.post('/ingresos/:id/recepcion', inventarioController.registrarRecepcion);
router.post('/ingresos/:id/resolver-diferencias', inventarioController.resolverDiferencias);
router.post('/ingresos/:id/habilitar-stock', inventarioController.habilitarStock);

// Rutas de Stock Físico (Existencias)
router.post('/stock/listado', inventarioController.listarStockUbicacion);

module.exports = router;
