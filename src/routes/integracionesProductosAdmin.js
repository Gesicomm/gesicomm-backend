'use strict';

/**
 * Rutas privadas de gestión de API Keys de integración de productos.
 * Montadas en: /api/integraciones/productos
 */
const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');
const ctrl = require('../controllers/integracionProductosAdmin.controller');

router.use(verificarToken);

// Keys de PROVEEDOR: solo el administrador. Lo que sube un proveedor entra
// al catálogo global y lo ve todo comercio, así que no es algo que pueda
// habilitar un comercio por su cuenta. Van ANTES de resolverTiendaActiva:
// una key de proveedor no tiene tienda.
router.get('/proveedores', soloAdministrador, ctrl.listarProveedores);
router.post('/proveedores', soloAdministrador, ctrl.crearProveedor);
router.delete('/proveedores/:id', soloAdministrador, ctrl.revocarProveedor);

// Keys de TIENDA: el ERP propio de cada comercio, sobre su propio catálogo.
router.use(verificarPermiso('gestionar_integraciones'));
router.use(resolverTiendaActiva);

router.get('/credenciales', ctrl.listar);
router.post('/credenciales', ctrl.crear);
router.delete('/credenciales/:id', ctrl.revocar);

module.exports = router;
