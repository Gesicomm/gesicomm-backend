'use strict';

const { Op, Sequelize } = require('sequelize');
const { Tienda } = require('../models');
const { numeroPedidoVisible } = require('../utils/pedidoNumero');

// La referencia pública usa un correlativo persistido e independiente por
// tienda. Los pedidos sin tienda conservan el correlativo de la cuenta.
async function adjuntarIdentificadores(envios, opciones = {}) {
  if (!envios.length) return envios;
  envios = envios.map(e => typeof e.toJSON === 'function' ? e.toJSON() : e);
  const tiendaIds = [...new Set(envios.map(e => e.tienda_id).filter(Boolean))];
  const usuariosSinTienda = [...new Set(envios.filter(e => !e.tienda_id).map(e => e.usuario_id).filter(Boolean))];
  const condiciones = [];
  if (tiendaIds.length) condiciones.push({ id: { [Op.in]: tiendaIds } });
  if (usuariosSinTienda.length) condiciones.push({ usuario_id: { [Op.in]: usuariosSinTienda } });
  const tiendas = condiciones.length
    ? await Tienda.findAll({ where: { [Op.or]: condiciones }, attributes: ['id', 'usuario_id', 'nombre'], raw: true, ...opciones })
    : [];
  const porId = new Map(tiendas.map(t => [Number(t.id), t]));
  const porUsuario = new Map();
  for (const tienda of tiendas) {
    const id = Number(tienda.usuario_id);
    porUsuario.set(id, porUsuario.has(id) ? null : tienda);
  }
  return envios.map(envio => {
    // Para pedidos históricos sin tienda, solo se infiere si la cuenta
    // tiene exactamente una: nunca se atribuye a otra tienda por azar.
    const tienda = envio.tienda_id ? porId.get(Number(envio.tienda_id)) : porUsuario.get(Number(envio.usuario_id));
    return {
      ...envio,
      tienda_nombre: tienda?.nombre || null,
      numero_pedido_visible: numeroPedidoVisible(envio, tienda?.nombre),
    };
  });
}

function sqlReferenciaPedido(alias = 'Envio') {
  const envio = `"${alias}"`;
  // Subconsultas correlacionadas evitan alterar los joins, la paginación
  // y los conteos. Sequelize escapa el texto del usuario en el predicado.
  const nombreSql = `COALESCE(
    (SELECT t.nombre FROM tiendas t WHERE t.id = ${envio}.tienda_id),
    (SELECT MIN(t.nombre) FROM tiendas t WHERE ${envio}.tienda_id IS NULL
      AND t.usuario_id = ${envio}.usuario_id HAVING COUNT(*) = 1),
    'Sin tienda'
  )`;
  const numeroSql = `CASE WHEN ${envio}.tienda_id IS NULL THEN ${envio}.numero_pedido ELSE ${envio}.numero_pedido_tienda END + 1000`;
  const referenciaSql = `CASE WHEN ${envio}.es_lead = true THEN 'LEAD-' || CAST(${envio}.id AS TEXT) ELSE LEFT(REGEXP_REPLACE(UPPER(TRIM(${nombreSql})), '[[:space:]]', '', 'g'), 3) || '-' || CAST((${numeroSql}) AS TEXT) END`;
  return { numeroSql, referenciaSql };
}

function filtroNumeroPedidoVisible(texto) {
  const valor = String(texto || '').replace(/^#/, '').trim();
  const { numeroSql, referenciaSql } = sqlReferenciaPedido();
  if (/^\d+$/.test(valor)) {
    return { [Op.or]: [Sequelize.where(Sequelize.literal(numeroSql), Number(valor)), { es_lead: true, id: Number(valor) }] };
  }
  return Sequelize.where(Sequelize.literal(referenciaSql), { [Op.iLike]: `%${valor}%` });
}

async function referenciaPedido(envio, opciones) {
  const [pedido] = await adjuntarIdentificadores([envio], opciones);
  return pedido.numero_pedido_visible;
}

module.exports = { numeroPedidoVisible, adjuntarIdentificadores, filtroNumeroPedidoVisible, referenciaPedido, sqlReferenciaPedido };
