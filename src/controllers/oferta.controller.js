'use strict';

/**
 * Controller de Ofertas comerciales.
 *
 * GET    /api/productos/:productoId/ofertas → Listar ofertas de un producto
 * POST   /api/productos/:productoId/ofertas → Crear oferta
 * PUT    /api/ofertas/:id                   → Actualizar oferta
 * DELETE /api/ofertas/:id                   → Baja lógica (activo=false)
 */

const { sequelize } = require('../models');
const OfertaService = require('../services/oferta.service');
const { rollbackSeguro } = require('../utils/transaction');

async function listarPorProducto(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    // ?soloActivas=true — la baja de una oferta es lógica (activo=false), así
    // que sin esto quien la acaba de borrar la sigue viendo en la lista y
    // parece que el borrado no hizo nada. La pantalla de administración de
    // ofertas sí las quiere todas (muestra un badge "Inactivo"), por eso es
    // opt-in y no el comportamiento por defecto.
    const soloActivas = req.query.soloActivas === 'true';
    const ofertas = await OfertaService.listarPorProducto(req.params.productoId, inquilino_id, { soloActivas });
    return res.json(ofertas);
  } catch (err) {
    console.error('[oferta] listarPorProducto:', err.message);
    return res.status(500).json({ message: 'Error al listar las ofertas.' });
  }
}

async function crear(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    const oferta = await OfertaService.crear(req.params.productoId, req.body, inquilino_id, t);
    await t.commit();
    return res.status(201).json(oferta);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[oferta] crear:', err.message);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(422).json({ message: 'Ya existe una oferta con ese código.' });
    }
    return res.status(400).json({ message: err.message || 'Error al crear la oferta.' });
  }
}

async function actualizar(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    const oferta = await OfertaService.actualizar(Number(req.params.id), req.body, inquilino_id, t);
    await t.commit();
    return res.json(oferta);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[oferta] actualizar:', err.message);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(422).json({ message: 'Ya existe una oferta con ese código.' });
    }
    const status = err.message === 'Oferta no encontrada.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al actualizar la oferta.' });
  }
}

async function eliminar(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    await OfertaService.eliminar(Number(req.params.id), inquilino_id, t);
    await t.commit();
    return res.json({ success: true });
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[oferta] eliminar:', err.message);
    const status = err.message === 'Oferta no encontrada.' ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al eliminar la oferta.' });
  }
}

module.exports = { listarPorProducto, crear, actualizar, eliminar };
