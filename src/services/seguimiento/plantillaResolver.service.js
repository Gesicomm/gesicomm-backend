'use strict';

/**
 * Resuelve las variables de una plantilla de WhatsApp con los datos reales
 * de un pedido (BE-03). Cada variable es una función que recibe el Envio
 * (con sus items cargados) — agregar una nueva variable es agregar una
 * entrada acá, no tocar el resto del flujo de seguimiento.
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
  nombre: (envio) => [envio.nombre_cliente, envio.apellido_cliente].filter(Boolean).join(' ') || envio.cliente || 'Cliente',
  telefono: (envio) => envio.telefono || '',
  producto: (envio) => nombreProductos(envio),
  numero_pedido: (envio) => String(envio.numero_pedido ?? envio.id),
  total: (envio) => formatGs(envio.monto),
  direccion: (envio) => envio.direccion || '',
};

/** Devuelve el catálogo de variables soportadas, para mostrar en el editor de plantillas del frontend. */
function listarVariablesDisponibles() {
  return Object.keys(VARIABLES);
}

/** Reemplaza {{variable}} en el mensaje. Una variable desconocida se deja tal cual, no se rompe el mensaje. */
function resolverMensaje(mensaje, envio) {
  return String(mensaje || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, clave) => {
    const resolver = VARIABLES[clave];
    if (!resolver) return match;
    try {
      return String(resolver(envio) ?? '');
    } catch {
      return match;
    }
  });
}

module.exports = { resolverMensaje, listarVariablesDisponibles };
