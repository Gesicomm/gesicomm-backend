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

const VARIABLES = {
  // Nombres usados en el editor del frontend (SeguimientoConfig.jsx)
  cliente_nombre: primerNombreCliente,
  telefono:       (envio) => envio.telefono || '',
  productos:      (envio) => nombreProductos(envio),
  pedido_id:      numeroPedidoVisible,
  total_gs:       (envio) => formatGs(envio.monto),
  direccion_entrega: (envio) => envio.direccion || '',
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
    { key: 'pedido_id',         grupo: 'Pedido',  desc: 'Tres primeras letras de la tienda y número correlativo (1001, 1002…)', ejemplo: numeroPedidoVisible({ tienda_nombre: 'Mi tienda', numero_pedido_tienda: 1 }) },
    { key: 'productos',         grupo: 'Pedido',  desc: 'Lista de productos del pedido', ejemplo: 'Zapatilla Urban Black, Remera Oversize' },
    { key: 'total_gs',          grupo: 'Pedido',  desc: 'Monto total en guaraníes',    ejemplo: formatGs(249000) },
    { key: 'direccion_entrega', grupo: 'Envío',  desc: 'Dirección de entrega',        ejemplo: 'Av. Mariscal López 1234, Asunción' },
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
