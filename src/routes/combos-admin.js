'use strict';

/**
 * Rutas administrativas de Combos.
 * Montadas en: /api/combos
 *
 * Permisos RBAC requeridos por endpoint:
 *   ver_combos      → listar, detalle
 *   crear_combos    → simular, crear
 *   editar_combos   → actualizar
 *   activar_combos  → cambiarEstado
 *   configurar_combos → obtener/actualizar configuración
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { verificarPermiso } = require('../middleware/autorizacion');
const comboCtrl = require('../controllers/combo.controller');
const configCtrl = require('../controllers/comboConfiguracion.controller');

// Todos los endpoints del módulo requieren autenticación
router.use(verificarToken);

// ─── Configuración económica ──────────────────────────────────────────────────
// IMPORTANTE: /configuracion debe ir ANTES de /:id para evitar conflicto de rutas
router.get('/configuracion', verificarPermiso('configurar_combos'), configCtrl.obtener);
router.post('/configuracion', verificarPermiso('configurar_combos'), configCtrl.actualizar);

// ─── Simulación (no persiste) ─────────────────────────────────────────────────
router.post('/simular', verificarPermiso('crear_combos'), comboCtrl.simular);

// ─── CRUD de combos ───────────────────────────────────────────────────────────
router.get('/', verificarPermiso('ver_combos'), comboCtrl.listar);
router.post('/', verificarPermiso('crear_combos'), comboCtrl.crear);
router.get('/:id', verificarPermiso('ver_combos'), comboCtrl.detalle);
router.put('/:id', verificarPermiso('editar_combos'), comboCtrl.actualizar);

// ─── Ciclo de vida ────────────────────────────────────────────────────────────
router.patch('/:id/estado', verificarPermiso('activar_combos'), comboCtrl.cambiarEstado);

module.exports = router;
