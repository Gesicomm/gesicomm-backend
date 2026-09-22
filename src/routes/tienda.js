'use strict';

/**
 * Rutas privadas de Tienda. Montadas en: /api/mi-tienda
 * IMPORTANTE: /subdominio/disponibilidad debe ir ANTES que cualquier ruta
 * con :id para no chocar (acá no hay :id, pero se mantiene el orden por
 * claridad con el resto del código).
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const ctrl = require('../controllers/tienda.controller');

router.use(verificarToken);
router.use(verificarPermiso('gestionar_tienda'));

router.get('/subdominio/disponibilidad', ctrl.disponibilidadSubdominio);

router.get('/dominio-propio/estado', ctrl.estadoDominioPropio);
router.post('/dominio-propio', ctrl.guardarDominioPropio);
router.patch('/dominio-propio/habilitado', ctrl.habilitacionDominioPropio);
router.delete('/dominio-propio', ctrl.eliminarDominioPropio);

router.post('/dominio/whois', ctrl.whoisDominio);

// Cómo entrega el comercio lo que vende (motor de fulfillment, Fase 3).
router.get('/fulfillment', ctrl.obtenerFulfillment);
router.put('/fulfillment', ctrl.guardarFulfillment);
router.get('/fulfillment/cobertura', ctrl.coberturaGesicomm);

router.get('/', ctrl.obtener);
router.post('/', ctrl.crear);
router.put('/', ctrl.actualizar);

module.exports = router;
