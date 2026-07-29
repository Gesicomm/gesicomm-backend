'use strict';

/**
 * Controller de Combos — Módulo Administrativo de Pricing.
 *
 * POST /api/combos/simular         → Simular rentabilidad sin persistir
 * GET  /api/combos                 → Listar todos los combos del tenant
 * POST /api/combos                 → Crear combo
 * GET  /api/combos/:id             → Detalle de un combo
 * PUT  /api/combos/:id             → Actualizar combo
 * PATCH /api/combos/:id/estado     → Cambiar estado (BORRADOR/ACTIVO/INACTIVO)
 *
 * Seguridad:
 * - El backend NUNCA confía en precios, costos ni márgenes del frontend.
 * - Solo acepta IDs de productos y porcentajes de descuento.
 * - Todos los cálculos económicos se hacen desde el catálogo real + configuración del tenant.
 */

const { sequelize } = require('../models');
const ComboService = require('../services/combo.service');
const { rollbackSeguro } = require('../utils/transaction');

// ─── POST /api/combos/simular ─────────────────────────────────────────────────

async function simular(req, res) {
  try {
    const { principalProductId, upsells = [] } = req.body;
    const inquilino_id = req.usuario.tenantId;

    if (!principalProductId) {
      return res.status(400).json({ message: 'El campo principalProductId es requerido.' });
    }

    const resultado = await ComboService.simular(principalProductId, upsells, inquilino_id);
    return res.json(resultado);
  } catch (err) {
    console.error('[combo] simular:', err.message);
    return res.status(400).json({ message: err.message || 'Error al simular el combo.' });
  }
}

// ─── GET /api/combos ──────────────────────────────────────────────────────────

async function listar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const filtros = {
      estado: req.query.estado || undefined,
    };
    const combos = await ComboService.listar(inquilino_id, filtros);
    return res.json(combos);
  } catch (err) {
    console.error('[combo] listar:', err.message);
    return res.status(500).json({ message: 'Error al listar los combos.' });
  }
}

// ─── POST /api/combos ─────────────────────────────────────────────────────────

async function crear(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    const combo = await ComboService.crear(req.body, inquilino_id, t);
    await t.commit();
    return res.status(201).json(combo);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[combo] crear:', err.message);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(422).json({ message: 'Ya existe un combo con este nombre para este producto.' });
    }
    return res.status(400).json({ message: err.message || 'Error al crear el combo.' });
  }
}

// ─── GET /api/combos/:id ──────────────────────────────────────────────────────

async function detalle(req, res) {
  try {
    const combo = await ComboService.obtener(Number(req.params.id), req.usuario.tenantId);
    return res.json(combo);
  } catch (err) {
    console.error('[combo] detalle:', err.message);
    const status = err.message === 'Combo no encontrado.' ? 404 : 500;
    return res.status(status).json({ message: err.message });
  }
}

// ─── PUT /api/combos/:id ──────────────────────────────────────────────────────

async function actualizar(req, res) {
  const t = await sequelize.transaction();
  try {
    const combo = await ComboService.actualizar(Number(req.params.id), req.body, req.usuario.tenantId, t);
    await t.commit();
    return res.json(combo);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[combo] actualizar:', err.message);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(422).json({ message: 'Ya existe un combo con este nombre para este producto.' });
    }
    const status = err.message === 'Combo no encontrado.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al actualizar el combo.' });
  }
}

// ─── PATCH /api/combos/:id/estado ────────────────────────────────────────────

async function cambiarEstado(req, res) {
  const t = await sequelize.transaction();
  try {
    const { estado } = req.body;
    if (!estado) {
      await rollbackSeguro(t);
      return res.status(400).json({ message: 'El campo "estado" es requerido.' });
    }
    const combo = await ComboService.cambiarEstado(Number(req.params.id), estado, req.usuario.tenantId, t);
    await t.commit();
    return res.json(combo);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[combo] cambiarEstado:', err.message);
    const status = err.message === 'Combo no encontrado.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al cambiar el estado.' });
  }
}

// ─── Compatibilidad con rutas anidadas /api/productos/:id/combos ──────────────

async function listarPorProducto(req, res) {
  try {
    const combos = await ComboService.listarPorProducto(req.params.productoId, req.usuario.tenantId);
    return res.json(combos);
  } catch (err) {
    console.error('[combo] listarPorProducto:', err.message);
    return res.status(500).json({ message: 'Error al listar los combos.' });
  }
}

module.exports = { simular, listar, crear, detalle, actualizar, cambiarEstado, listarPorProducto };
