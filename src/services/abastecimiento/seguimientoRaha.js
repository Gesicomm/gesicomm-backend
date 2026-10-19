'use strict';

const { Op, literal } = require('sequelize');
const { sequelize, SpeedboxPedido, SpeedboxEvento, InventarioUbicacion } = require('../../models');

function entorno() {
  return require('../speedbox/service').environment();
}

function incluirPedido() {
  return { model: SpeedboxPedido, as: 'pedidoRaha', required: false,
    where: { environment: entorno() },
    attributes: ['order_id', 'estado', 'status', 'status_at', 'updated_at'] };
}

function estadoConsulta() {
  return literal(`COALESCE("pedidoRaha"."status", CASE
    WHEN "pedidoRaha"."estado" IN ('error', 'incierto') THEN 'requiere_revision'
    ELSE 'pendiente_envio' END)`);
}

function presentar(solicitud) {
  const pedido = solicitud.pedidoRaha;
  return { ...solicitud,
    es_raha: solicitud.tipo_logistica === 'PROPIA',
    modalidad_pago: solicitud.tipo_logistica === 'PROPIA' ? 'CONTRA_ENTREGA' : 'TRANSFERENCIA',
    estado_seguimiento: solicitud.tipo_logistica === 'PROPIA'
      ? pedido?.status || (['error', 'incierto'].includes(pedido?.estado) ? 'requiere_revision' : 'pendiente_envio')
      : solicitud.estado,
    precio_unitario: solicitud.cantidad ? Number(solicitud.costo_producto) / solicitud.cantidad : 0,
    stock_acreditado: solicitud.estado === 'recibido_en_deposito_cliente',
  };
}

async function enriquecer(solicitudes, { tiendaId } = {}) {
  if (!solicitudes.length) return [];
  const condiciones = solicitudes.map(solicitud => ({ usuario_id: solicitud.usuario_id,
    producto_id: solicitud.producto_id, variante_id: solicitud.variante_id || null,
    deposito_id: solicitud.deposito_destino_id || solicitud.centro_gesicomm_id }));
  const [inventario, [ventas]] = await Promise.all([
    InventarioUbicacion.findAll({ where: { [Op.or]: condiciones }, raw: true }),
    sequelize.query(`WITH entregados AS (
      SELECT i.*, e.usuario_id FROM envio_items i JOIN envios e ON e.id = i.envio_id
      WHERE e.usuario_id IN (:usuarios) AND e.estado = 'Entregado'
        ${tiendaId ? 'AND e.tienda_id = :tiendaId' : ''}
    ), unidades AS (
      SELECT i.usuario_id, c.producto_id, c.variante_id,
        GREATEST(0, c.cantidad - c.cantidad_devuelta_vendible - c.cantidad_devuelta_danada - c.cantidad_perdida) AS cantidad
      FROM entregados i JOIN envio_item_componentes c ON c.envio_item_id = i.id
      WHERE c.producto_id IN (:productos)
      UNION ALL
      SELECT i.usuario_id, i.producto_id, i.variante_id, i.cantidad
      FROM entregados i WHERE i.producto_id IN (:productos)
        AND NOT EXISTS (SELECT 1 FROM envio_item_componentes c WHERE c.envio_item_id = i.id)
    ) SELECT usuario_id, producto_id, variante_id, SUM(cantidad)::int AS unidades
      FROM unidades GROUP BY usuario_id, producto_id, variante_id`, {
      replacements: { usuarios: [...new Set(solicitudes.map(solicitud => solicitud.usuario_id))],
        productos: [...new Set(solicitudes.map(solicitud => solicitud.producto_id))], tiendaId },
    }),
  ]);
  return solicitudes.map(solicitud => {
    const stock = inventario.find(fila => fila.usuario_id === solicitud.usuario_id &&
      fila.producto_id === solicitud.producto_id && (fila.variante_id || null) === (solicitud.variante_id || null) &&
      fila.deposito_id === (solicitud.deposito_destino_id || solicitud.centro_gesicomm_id));
    const venta = ventas.find(fila => fila.usuario_id === solicitud.usuario_id &&
      fila.producto_id === solicitud.producto_id && (fila.variante_id || null) === (solicitud.variante_id || null));
    return { ...presentar(solicitud), inventario: { disponible: Number(stock?.cantidad_disponible || 0),
      reservado: Number(stock?.cantidad_reservada || 0) },
    ventas_producto: { unidades: Number(venta?.unidades || 0),
      alcance: 'Pedidos entregados del producto y variante, en todos los depósitos y fechas' } };
  });
}

async function historial(solicitud) {
  if (!solicitud.pedidoRaha?.order_id) return [];
  const eventos = await SpeedboxEvento.findAll({ where: { usuario_id: solicitud.usuario_id,
    environment: entorno(), order_id: solicitud.pedidoRaha.order_id,
    tipo: 'shipment.status_changed', estado: 'procesado' },
  order: [['occurred_at', 'ASC'], ['id', 'ASC']], raw: true });
  return eventos.map(evento => ({ id: `raha-${evento.id}`,
    estado: evento.payload?.data?.status || evento.payload?.payload?.status,
    created_at: evento.occurred_at || evento.created_at, origen: 'RAHA' }));
}

module.exports = { incluirPedido, estadoConsulta, presentar, enriquecer, historial };
