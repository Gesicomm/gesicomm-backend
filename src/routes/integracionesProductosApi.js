'use strict';

/**
 * API pública (API Key, sin sesión) para que un sistema externo sincronice
 * su catálogo de productos con Gesicomm. Contrato completo en
 * docs/api-integraciones-productos.md.
 *
 * Montada en: /api/integraciones/productos/v1
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { verificarApiKeyIntegracion } = require('../middleware/autenticacionIntegracion');
const ctrl = require('../controllers/integracionProductosApi.controller');

// El límite de body (2mb) lo pone server.js ANTES del parser global de
// 10kb, para esta misma ruta — ver el comentario ahí.
router.use(verificarApiKeyIntegracion);
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  keyGenerator: (req) => `integracion:${req.integracion.id}`,
  message: { ok: false, error: 'Demasiadas operaciones. Intentá de nuevo en unos minutos.', codigo: 'RATE_LIMIT' },
}));

router.get('/ping', ctrl.ping);
router.post('/productos', ctrl.upsertProducto);
router.post('/productos/lote', ctrl.sincronizarLote);
router.get('/productos/:sku', ctrl.consultarProducto);
router.patch('/productos/:sku/stock', ctrl.actualizarStock);
router.patch('/productos/:sku/precio', ctrl.actualizarPrecio);
router.delete('/productos/:sku', ctrl.darDeBaja);

module.exports = router;
