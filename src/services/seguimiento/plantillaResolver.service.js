'use strict';

/**
 * Resuelve las variables de una plantilla de WhatsApp con los datos reales
 * de un pedido (BE-03). Soporta tanto {variable} como {{variable}}.
 * Las variables disponibles deben coincidir con los nombres que muestra
 * SeguimientoConfig.jsx al usuario.
 */
function formatGs(valor) {
  const n = Math.max(0, Math.round(Number(valor) || 0));
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

function nombreProductos(envio) {
  const items = envio.items || [];
  if (items.length === 0) return 'tu pedido';
  return items.map((it) => it.oferta_nombre || it.nombre_producto).filter(Boolean).join(', ');
}

const VARIABLES = {
  // Nombres usados en el editor del frontend (SeguimientoConfig.jsx)
  cliente_nombre: (envio) => [envio.nombre_cliente, envio.apellido_cliente].filter(Boolean).join(' ') || envio.cliente || 'Cliente',
  telefono:       (envio) => envio.telefono || '',
  productos:      (envio) => nombreProductos(envio),
  pedido_id:      (envio) => String(envio.numero_pedido ?? envio.id),
  total_gs:       (envio) => formatGs(envio.monto),
  direccion_entrega: (envio) => envio.direccion || '',
  courier_nombre: (envio) => envio.courier_nombre || envio.courier || '',
  // Aliases por compatibilidad con plantillas antiguas
  nombre:         (envio) => [envio.nombre_cliente, envio.apellido_cliente].filter(Boolean).join(' ') || envio.cliente || 'Cliente',
  producto:       (envio) => nombreProductos(envio),
  numero_pedido:  (envio) => String(envio.numero_pedido ?? envio.id),
  pedido:         (envio) => String(envio.numero_pedido ?? envio.id),
  total:          (envio) => formatGs(envio.monto),
  direccion:      (envio) => envio.direccion || '',
  courier:        (envio) => envio.courier_nombre || envio.courier || '',
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
    { key: 'cliente_nombre',    grupo: 'Cliente', desc: 'Nombre del cliente',          ejemplo: 'María González' },
    { key: 'telefono',          grupo: 'Cliente', desc: 'Teléfono del cliente',        ejemplo: '0981 234 567' },
    { key: 'pedido_id',         grupo: 'Pedido',  desc: 'Número del pedido',           ejemplo: '1842' },
    { key: 'productos',         grupo: 'Pedido',  desc: 'Lista de productos del pedido', ejemplo: 'Zapatilla Urban Black, Remera Oversize' },
    { key: 'total_gs',          grupo: 'Pedido',  desc: 'Monto total en guaraníes',    ejemplo: formatGs(249000) },
    { key: 'direccion_entrega', grupo: 'Envío',  desc: 'Dirección de entrega',        ejemplo: 'Av. Mariscal López 1234, Asunción' },
    { key: 'courier_nombre',    grupo: 'Envío',  desc: 'Nombre del courier',            ejemplo: 'Pronto Entrega' },
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