'use strict';

/**
 * Resuelve las variables de una plantilla de WhatsApp con los datos reales
 * de un pedido (BE-03). Soporta tanto {variable} como {{variable}}.
 * Las variables disponibles deben coincidir con los nombres que muestra
 * SeguimientoConfig.jsx al usuario.
 */
const { numeroPedidoVisible } = require('../../utils/pedidoNumero');

function formatGs(valor) {
  const n = Math.max(0, Math.round(Number(valor) || 0));
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

function nombreProductos(envio) {
  const items = envio.items || [];
  if (items.length === 0) return 'tu pedido';
  return items.map((it) => it.oferta_nombre || it.nombre_producto).filter(Boolean).join(', ');
}

function primerNombreCliente(envio) {
  const nombre = String(envio.nombre_cliente || '').trim()
    || String(envio.cliente || '').trim();
  return nombre.split(/\s+/)[0] || 'Cliente';
}

function detalleProductos(envio) {
  return (envio.items || []).map(item => {
    const nombre = item.oferta_nombre || item.nombre_producto || item.Producto?.nombre || 'Producto';
    const cantidad = Number(item.cantidad) || 1;
    const tienePrecio = item.precio_unitario !== null && item.precio_unitario !== undefined && item.precio_unitario !== '' && Number.isFinite(Number(item.precio_unitario));
    return `• ${nombre} x${cantidad}${tienePrecio ? ` — ${formatGs(cantidad * Number(item.precio_unitario))}` : ''}`;
  }).join('\n');
}

function modalidadPago(envio) {
  return envio.es_lead ? 'Por definir' : envio.pago_anticipado ? 'Pago anticipado' : 'Contra entrega';
}

function resumenPedido(envio) {
  const lineas = [envio.es_lead ? 'Productos de interés' : `Pedido ${numeroPedidoVisible(envio)}`, detalleProductos(envio), `Total: ${formatGs(envio.monto)}`];
  const direccion = [envio.direccion, envio.ciudad, envio.departamento].filter(Boolean).join(', ');
  if (direccion) lineas.push(`Entrega: ${direccion}`);
  if (envio.link_maps) lineas.push(`Ubicación: ${envio.link_maps}`);
  if (!envio.es_lead) lineas.push(`Pago: ${modalidadPago(envio)}${envio.metodo_pago ? ` · ${envio.metodo_pago}` : ''}`);
  return lineas.filter(Boolean).join('\n');
}

function textoCatalogo(valor) {
  return String(valor || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function informacionProductos(envio, campo) {
  const vistos = new Set();
  const bloques = [];
  for (const item of envio.items || []) {
    const producto = item.Producto || item.producto;
    if (!producto || vistos.has(producto.id ?? item.producto_id)) continue;
    vistos.add(producto.id ?? item.producto_id);
    let texto;
    if (campo === 'descripcion') {
      texto = textoCatalogo(producto.descripcion_corta || producto.sobre_este_producto || producto.descripcion_larga).slice(0, 800);
    } else {
      let beneficios = producto.beneficios || [];
      if (typeof beneficios === 'string') {
        try { beneficios = JSON.parse(beneficios); } catch { beneficios = [beneficios]; }
      }
      if (!Array.isArray(beneficios)) beneficios = [];
      texto = beneficios.slice(0, 6).map(b => textoCatalogo(typeof b === 'string' ? b : [b?.titulo, b?.texto].filter(Boolean).join(': '))).filter(Boolean).map(b => `• ${b.slice(0, 300)}`).join('\n');
      if (!texto) texto = textoCatalogo(producto.propuesta_valor).slice(0, 800);
    }
    if (texto) bloques.push({ nombre: textoCatalogo(producto.nombre || item.nombre_producto), texto });
  }
  return bloques.map(b => bloques.length > 1 ? `${b.nombre}:\n${b.texto}` : b.texto).join('\n\n');
}

const VARIABLES = {
  // Nombres usados en el editor del frontend (SeguimientoConfig.jsx)
  cliente_nombre: primerNombreCliente,
  telefono:       (envio) => envio.telefono || '',
  productos:      (envio) => nombreProductos(envio),
  producto_descripcion: (envio) => informacionProductos(envio, 'descripcion'),
  producto_beneficios: (envio) => informacionProductos(envio, 'beneficios'),
  productos_detalle: detalleProductos,
  pedido_resumen: resumenPedido,
  pedido_id:      numeroPedidoVisible,
  total_gs:       (envio) => formatGs(envio.monto),
  direccion_entrega: (envio) => envio.direccion || '',
  ciudad: (envio) => envio.ciudad || '',
  departamento: (envio) => envio.departamento || '',
  ubicacion_maps: (envio) => envio.link_maps || '',
  pago_modalidad: modalidadPago,
  metodo_pago: (envio) => envio.metodo_pago || envio.MetodoPago?.nombre || '',
  envio_cobrado: (envio) => formatGs(envio.delivery_a_cargo === 'negocio' ? 0 : envio.costo_envio),
  courier_nombre: (envio) => envio.Courier?.nombre || envio.courier_nombre || (typeof envio.courier === 'string' ? envio.courier : '') || '',
  courier_telefono: (envio) => envio.Courier?.telefono || envio.courier_telefono || '',
  // Aliases por compatibilidad con plantillas antiguas
  nombre:         primerNombreCliente,
  producto:       (envio) => nombreProductos(envio),
  numero_pedido:  numeroPedidoVisible,
  pedido:         numeroPedidoVisible,
  total:          (envio) => formatGs(envio.monto),
  direccion:      (envio) => envio.direccion || '',
  courier:        (envio) => VARIABLES.courier_nombre(envio),
};

/**
 * Catalogo de variables soportadas, con su descripcion, para el editor de
 * fases del frontend.
 *
 * Devuelve objetos y no solo las claves a proposito: el editor venia con su
 * propia lista hardcodeada que ya se habia desincronizado de esta (ofrecia
 * {courier_nombre} cuando aca solo existia {courier}, asi que esa variable
 * llegaba literal al cliente). Con una sola fuente eso no puede repetirse.
 *
 * `ejemplo` es el valor ficticio que usa la vista previa del editor de
 * flujos. Vive ACA, al lado de la funcion que produce el valor real, para
 * que la previsualizacion no pueda mentir: si cambia el formato real (por
 * ejemplo el de total_gs, que sale del mismo formatGs), el ejemplo cambia
 * con el. Un preview que muestra otro formato que el mensaje que de verdad
 * se manda es peor que no tener preview.
 *
 * Solo las variables "primarias" (sin aliases) para no confundir al usuario.
 */
function listarVariablesDisponibles() {
  return [
    { key: 'cliente_nombre',    grupo: 'Cliente', desc: 'Primer nombre del cliente',   ejemplo: primerNombreCliente({ nombre_cliente: 'María', apellido_cliente: 'González' }) },
    { key: 'telefono',          grupo: 'Cliente', desc: 'Teléfono del cliente',        ejemplo: '0981 234 567' },
    { key: 'pedido_id',         grupo: 'Pedido',  desc: 'Referencia del pedido; mientras es un lead muestra su referencia LEAD', ejemplo: numeroPedidoVisible({ tienda_nombre: 'Mi tienda', numero_pedido_tienda: 1 }) },
    { key: 'pedido_resumen',    grupo: 'Pedido', desc: 'Resumen completo: productos, cantidades, total, entrega y pago', ejemplo: 'Pedido MIT-1001\n• Zapatilla Urban Black x1 — Gs. 249.000\nTotal: Gs. 249.000\nPago: Contra entrega' },
    { key: 'productos',         grupo: 'Producto',  desc: 'Nombres de los productos seleccionados o incluidos en el pedido', ejemplo: 'Zapatilla Urban Black, Remera Oversize' },
    { key: 'productos_detalle', grupo: 'Producto', desc: 'Productos con cantidades e importes de cada línea', ejemplo: '• Zapatilla Urban Black x2 — Gs. 498.000' },
    { key: 'producto_descripcion', grupo: 'Producto', desc: 'Descripción real de los productos seleccionados, desde su ficha del catálogo', ejemplo: 'Zapatilla liviana para uso diario.' },
    { key: 'producto_beneficios', grupo: 'Producto', desc: 'Beneficios reales de los productos seleccionados, desde su ficha del catálogo', ejemplo: '• Comodidad: Interior acolchado.\n• Uso diario: Suela flexible.' },
    { key: 'total_gs',          grupo: 'Pedido',  desc: 'Monto total en guaraníes',    ejemplo: formatGs(249000) },
    { key: 'direccion_entrega', grupo: 'Envío',  desc: 'Dirección de entrega',        ejemplo: 'Av. Mariscal López 1234, Asunción' },
    { key: 'ciudad', grupo: 'Envío', desc: 'Ciudad de entrega', ejemplo: 'Luque' },
    { key: 'departamento', grupo: 'Envío', desc: 'Departamento de entrega', ejemplo: 'Central' },
    { key: 'ubicacion_maps', grupo: 'Envío', desc: 'Enlace de ubicación guardado en el pedido', ejemplo: 'https://maps.google.com/?q=Luque' },
    { key: 'envio_cobrado', grupo: 'Envío', desc: 'Importe de envío cobrado al cliente; cero si lo paga el negocio', ejemplo: formatGs(20000) },
    { key: 'pago_modalidad', grupo: 'Pago', desc: 'Contra entrega o pago anticipado; por definir mientras es un lead', ejemplo: 'Contra entrega' },
    { key: 'metodo_pago', grupo: 'Pago', desc: 'Método de pago guardado en el pedido', ejemplo: 'Transferencia' },
    { key: 'courier_nombre',    grupo: 'Envío',  desc: 'Nombre del courier',            ejemplo: 'Pronto Entrega' },
    { key: 'courier_telefono',  grupo: 'Envío',  desc: 'Teléfono del courier',          ejemplo: '0981 555 123' },
  ];
}

/**
 * Reemplaza {variable} o {{variable}} en el mensaje.
 * Una variable desconocida se deja tal cual, no se rompe el mensaje.
 */
function resolverMensaje(mensaje, envio) {
  return String(mensaje || '')
    // Primero reemplaza {{variable}} (doble llave)
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (match, clave) => {
      const resolver = VARIABLES[clave];
      if (!resolver) return match;
      try { return String(resolver(envio) ?? ''); } catch { return match; }
    })
    // Luego reemplaza {variable} (llave simple)
    .replace(/\{\s*(\w+)\s*\}/g, (match, clave) => {
      const resolver = VARIABLES[clave];
      if (!resolver) return match;
      try { return String(resolver(envio) ?? ''); } catch { return match; }
    });
}

module.exports = { resolverMensaje, listarVariablesDisponibles };
