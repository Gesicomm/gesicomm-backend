const { Op } = require('sequelize');
const { MetaCampanaInterna, MetaCampanaLead } = require('../models');
const { esOrigenWhatsapp } = require('./seguimiento/flujosBase');

/**
 * Resuelve y registra, sin que el usuario tenga que elegir nada, de qué
 * campaña(s) activas es lead este pedido: para cada producto del pedido,
 * busca campañas activas del mismo tipo (web/whatsapp, según el origen del
 * pedido) que lo incluyan en `producto_ids`. Si un pedido mezcla productos
 * de campañas distintas, cuenta como lead de cada una (no solo la primera).
 *
 * Se llama DENTRO de la misma transacción que crea el Envio+items, desde
 * los dos puntos de alta que existen hoy: envioController.createEnvio
 * (manual/WhatsApp) y landing.service.js crearCheckout (checkout público).
 */
async function registrarLeadsDeCampana({ envioId, usuarioId, inquilinoId, origen, items, transaction }) {
  const productoIds = [...new Set((items || []).map((it) => it.producto_id).filter(Boolean).map(Number))];
  if (!envioId || !usuarioId || productoIds.length === 0) return;

  const tipo = esOrigenWhatsapp(origen) ? 'whatsapp' : 'web';

  for (const productoId of productoIds) {
    const campanas = await MetaCampanaInterna.findAll({
      where: {
        inquilino_id: inquilinoId,
        usuario_id: usuarioId,
        tipo,
        estado: 'activa',
        producto_ids: { [Op.contains]: [productoId] },
      },
      attributes: ['id'],
      transaction,
    });

    for (const campana of campanas) {
      await MetaCampanaLead.findOrCreate({
        where: { meta_campana_interna_id: campana.id, envio_id: envioId, producto_id: productoId },
        transaction,
      });
    }
  }
}

module.exports = { registrarLeadsDeCampana };
