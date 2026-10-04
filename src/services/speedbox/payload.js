'use strict';
const { orderSchema } = require('./client');

function buildOrder(envio, tienda, connection, variants = new Map()) {
  const items = [];
  for (const item of envio.items || []) {
    const components = item.componentes_vendidos || [];
    if (!components.length) throw Object.assign(new Error('El pedido no tiene componentes de stock confirmados.'), { status: 422 });
    const units = components.reduce((sum, component) => sum + Number(component.cantidad), 0);
    let remaining = Number(item.subtotal);
    for (let index = 0; index < components.length; index++) {
      const component = components[index];
      const product = component.producto;
      const variant = component.variante_id ? variants.get(component.variante_id) : null;
      const sku = component.variante_id ? variant?.sku_variante : product?.sku;
      if (!sku?.trim()) throw Object.assign(new Error(`Falta SKU Speedbox para ${product?.nombre || item.nombre_producto}.`), { status: 422 });
      // Flatten the immutable stock recipe; distribute the commercial line total.
      const subtotal = index === components.length - 1 ? remaining : Math.floor(Number(item.subtotal) * Number(component.cantidad) / units);
      remaining -= subtotal;
      items.push({ sku: sku.trim(), title: [product?.nombre || item.nombre_producto, variant?.nombre].filter(Boolean).join(' - '),
        quantity: Number(component.cantidad), price: subtotal / Number(component.cantidad) });
    }
  }
  const payload = {
    external_order_id: `GESICOMM-${connection.environment}-${envio.usuario_id}-${envio.id}`,
    order_name: `#${envio.numero_pedido}`, tienda_id: String(connection.tienda_id),
    created_at: new Date(envio.created_at).toISOString(), currency: 'PYG',
    total_price: Number(envio.monto) + (envio.delivery_a_cargo === 'negocio' ? 0 : Number(envio.costo_envio)),
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

module.exports = { buildOrder };
