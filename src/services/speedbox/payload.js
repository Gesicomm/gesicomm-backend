'use strict';
const { orderSchema } = require('./client');

function esProductoExterno(product, usuarioId) {
  return usuarioId != null && Number(product?.creado_por) !== Number(usuarioId);
}

function buildOrder(envio, tienda, connection, variants = new Map(), options = {}) {
  const items = [];
  for (const item of envio.items || []) {
    const components = item.componentes_vendidos || [];
    if (!components.length) throw Object.assign(new Error('El pedido no tiene componentes de stock confirmados.'), { status: 422 });
    const units = components.reduce((sum, component) => sum + Number(component.cantidad), 0);
    const included = new Set(components
      .filter(component => !options.onlyExternalProducts || esProductoExterno(component.producto, options.usuarioId))
      .map(component => component.id ?? component));
    let remaining = Number(item.subtotal);
    for (let index = 0; index < components.length; index++) {
      const component = components[index];
      const product = component.producto;
      const variant = component.variante_id ? variants.get(component.variante_id) : null;
      const sku = component.variante_id ? variant?.sku_variante : product?.sku;
      // Flatten the immutable stock recipe; distribute the commercial line total.
      const subtotal = index === components.length - 1 ? remaining : Math.floor(Number(item.subtotal) * Number(component.cantidad) / units);
      remaining -= subtotal;
      if (!included.has(component.id ?? component)) continue;
      if (!sku?.trim()) throw Object.assign(new Error(`Falta SKU Speedbox para ${product?.nombre || item.nombre_producto}.`), { status: 422 });
      items.push({ sku: sku.trim(), title: [product?.nombre || item.nombre_producto, variant?.nombre].filter(Boolean).join(' - '),
        quantity: Number(component.cantidad), price: subtotal / Number(component.cantidad) });
    }
  }
  if (!items.length) throw Object.assign(new Error('El pedido no tiene productos RAHA para enviar a Speedbox.'), { status: 422 });
  const payload = {
    external_order_id: `GESICOMM-${connection.environment}-${envio.usuario_id}-${envio.id}`,
    order_name: `#${envio.numero_pedido}`, tienda_id: String(connection.tienda_id),
    created_at: new Date(envio.created_at).toISOString(), currency: 'PYG',
    total_price: options.onlyExternalProducts
      ? items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0)
      : Number(envio.monto) + (envio.delivery_a_cargo === 'negocio' ? 0 : Number(envio.costo_envio)),
    financial_status: envio.pago_anticipado ? 'paid' : 'pending',
    payment_method: envio.pago_anticipado ? (envio.metodo_pago || 'anticipado') : 'contra_entrega', store_name: tienda.nombre,
    customer: { name: envio.cliente, phone: envio.telefono || '' },
    shipping_address: { address: envio.direccion || '', reference: envio.referencia || '', city: envio.ciudad || '',
      department: envio.departamento || '', google_maps_url: envio.link_maps || '' },
    ...(envio.ruc ? { billing_document_type: 'RUC', billing_document_number: envio.ruc } :
      envio.documento ? { billing_document_type: 'CI', billing_document_number: envio.documento } : {}),
    items,
  };
  const validated = orderSchema.safeParse(payload);
  if (!validated.success) throw Object.assign(new Error(`Completa los datos del pedido: ${validated.error.issues.map(issue => issue.path.join('.')).join(', ')}.`), { status: 422 });
  return validated.data;
}

function plain(row) {
  return row?.toJSON ? row.toJSON() : (row || {});
}

function buildSupplyOrder(solicitud, tienda, connection, { producto, variante = null, deposito }) {
  const pedido = plain(solicitud);
  const product = plain(producto);
  const variant = variante ? plain(variante) : null;
  const destination = plain(deposito);
  const sku = variant?.sku_variante || product.sku;
  if (!sku?.trim()) throw Object.assign(new Error(`Falta SKU Speedbox para ${product.nombre || `producto #${pedido.producto_id}`}.`), { status: 422 });
  if (!destination?.direccion || !destination?.ciudad) {
    throw Object.assign(new Error('El deposito de destino necesita direccion y ciudad para enviar el pedido a RAHA.'), { status: 422 });
  }
  const quantity = Number(pedido.cantidad);
  const unitPrice = quantity > 0 ? Math.round((Number(pedido.costo_producto) || 0) / quantity) : 0;
  const payload = {
    external_order_id: `GESICOMM-ABAST-${connection.environment}-${pedido.usuario_id}-${pedido.id}`,
    order_name: `#ABAST-${pedido.id}`,
    tienda_id: String(connection.tienda_id),
    created_at: new Date(pedido.created_at || Date.now()).toISOString(),
    currency: 'PYG',
    total_price: Number(pedido.costo_producto) || 0,
    financial_status: 'pending',
    payment_method: 'abastecimiento_deposito',
    store_name: tienda.nombre,
    customer: {
      name: destination.persona_contacto || tienda.nombre || 'Deposito',
      phone: destination.telefono_contacto || tienda.whatsapp || '0981000000',
    },
    shipping_address: {
      address: destination.direccion,
      reference: destination.referencia || destination.nombre || '',
      city: destination.ciudad,
      department: destination.departamento || '',
      google_maps_url: destination.link_maps || '',
    },
    items: [{
      sku: sku.trim(),
      title: [product.nombre, variant?.nombre].filter(Boolean).join(' - '),
      quantity,
      price: unitPrice,
    }],
  };
  const validated = orderSchema.safeParse(payload);
  if (!validated.success) throw Object.assign(new Error(`Completa los datos del abastecimiento: ${validated.error.issues.map(issue => issue.path.join('.')).join(', ')}.`), { status: 422 });
  return validated.data;
}

module.exports = { buildOrder, buildSupplyOrder };
