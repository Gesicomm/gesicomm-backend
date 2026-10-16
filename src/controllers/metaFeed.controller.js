'use strict';
const Feed = require('../services/metaFeed.service');
const { Landing, sequelize } = require('../models');
const ejecutar = action => async (req, res) => {
  try {
    const tienda = await Feed.tiendaPrivada(req.usuario);
    const id = Number(req.params.landingId);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Landing inválida.' });
    const landing = await Landing.findOne({ where: { id, tienda_id: tienda.id }, attributes: ['id', 'slug'] });
    if (!landing) return res.status(404).json({ message: 'Landing no encontrada.' });
    tienda.feed_landing_id = landing.id;
    tienda.feed_slug = landing.slug;
    res.set('Cache-Control', 'no-store');
    return res.json(await action(tienda, req));
  } catch (err) {
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'No se pudo procesar el feed de Meta.' });
  }
};
module.exports = {
  actual: async (req, res) => {
    try {
      const tienda = await Feed.tiendaPrivada(req.usuario);
      // Match the exact source selected by Productos en mi landing.
      const landing = await Landing.findOne({
        where: { tienda_id: tienda.id, inquilino_id: req.usuario.tenantId, activo: true },
        attributes: ['id', 'slug'],
        order: [[sequelize.literal("CASE WHEN tipo_pagina = 'catalogo' THEN 0 WHEN es_home = true THEN 1 ELSE 2 END"), 'ASC'], ['created_at', 'DESC'], ['id', 'DESC']],
      });
      if (!landing) return res.status(409).json({ message: 'No hay una landing publicada en esta tienda. Publicala antes de exportar.' });
      tienda.feed_landing_id = landing.id;
      tienda.feed_slug = landing.slug;
      return res.set('Cache-Control', 'no-store').json(await Feed.estado(tienda));
    } catch (err) {
      return res.status(err.status || 500).json({ message: err.status ? err.message : 'No se pudo consultar el feed de tu landing.' });
    }
  },
  estado: ejecutar(t => Feed.estado(t)),
  activar: ejecutar((t, req) => Feed.activar(t, req.body?.activo)),
  actualizar: ejecutar(async t => { Feed.solicitar(t.feed_landing_id); return Feed.estado(t); }),
};
