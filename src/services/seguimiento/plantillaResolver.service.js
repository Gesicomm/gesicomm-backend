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
  courier:        (envio) => envio.courier_nombre || envio.courier || '',
  // Aliases por compatibilidad con plantillas antiguas
  nombre:         (envio) => [envio.nombre_cliente, envio.apellido_cliente].filter(Boolean).join(' ') || envio.cliente || 'Cliente',
  producto:       (envio) => nombreProductos(envio),
  numero_pedido:  (envio) => String(envio.numero_pedido ?? envio.id),
  total:          (envio) => formatGs(envio.monto),
  direccion:      (envio) => envio.direccion || '',
};

/** Devuelve el catalogo de variables soportadas, para mostrar en el editor de plantillas del frontend. */
function listarVariablesDisponibles() {
  // Solo las variables "primarias" (sin aliases) para no confundir al usuario
  return ['cliente_nombre', 'pedido_id', 'productos', 'total_gs', 'direccion_entrega', 'telefono', 'courier'];
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