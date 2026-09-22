'use strict';

/**
 * Rutas de la Red de Fulfillment. Montadas en /api/fulfillment.
 *
 * Es infraestructura de Gesicomm: todo requiere administrador. El catálogo
 * geográfico va acá por comodidad de montaje, pero es de sólo lectura y no
 * expone datos de ningún comercio.
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const ctrl = require('../controllers/redFulfillment.controller');

router.use(verificarToken);
router.use(soloAdministrador);

router.get('/resumen', ctrl.resumen);
router.get('/geografia', ctrl.catalogoGeografico);
router.get('/proveedores', ctrl.proveedores);

// Las rutas con :id van después de las fijas para que no se las coman.
router.get('/centros', ctrl.listarCentros);
router.get('/centros/:id', ctrl.detalleCentro);
router.get('/centros/:id/cobertura', ctrl.coberturaCentro);
router.post('/centros/:id/designar', ctrl.designarCentro);

// Proveedores logísticos de la red.
router.post('/proveedores', ctrl.crearProveedor);
router.put('/proveedores/:id', ctrl.actualizarProveedor);
router.delete('/proveedores/:id', ctrl.eliminarProveedor);
router.get('/proveedores/:id/centros', ctrl.centrosDeProveedor);

// La cobertura y las tarifas pertenecen al par centro+proveedor, no al
// proveedor solo: el mismo proveedor puede cobrar distinto según desde qué
// centro sale. Por eso la ruta lleva los dos.
router.get('/centros/:centroId/proveedores', ctrl.proveedoresDeCentro);
router.put('/centros/:centroId/proveedores/:proveedorId', ctrl.vincularProveedor);
router.delete('/centros/:centroId/proveedores/:proveedorId', ctrl.desvincularProveedor);
router.get('/centros/:centroId/proveedores/:proveedorId/cobertura', ctrl.coberturaDeProveedor);
router.put('/centros/:centroId/proveedores/:proveedorId/cobertura', ctrl.guardarCoberturaDeProveedor);

module.exports = router;
