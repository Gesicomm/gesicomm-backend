'use strict';
const { errorHttp } = require('../../utils/errorHttp');

// El contexto del mensaje no modifica los productos de interés ni el flujo.
function seleccionarProductosMensaje(envio, productoIds) {
  if (productoIds === undefined) return envio;
  const ids = typeof productoIds === 'string' ? productoIds.split(',') : productoIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 80 || ids.some(id => !String(id).trim() || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw errorHttp('Elegí al menos un producto válido para este mensaje.', 422);
  }
  if (!envio.es_lead || !String(envio.origen || '').toUpperCase().includes('WHATSAPP')) {
    throw errorHttp('La selección de productos por mensaje corresponde a los leads de WhatsApp.', 422);
  }
  const seleccionados = new Set(ids.map(Number));
  const plano = typeof envio.toJSON === 'function' ? envio.toJSON() : envio;
  const items = (plano.items || []).filter(item => seleccionados.has(Number(item.producto_id)));
  if ([...seleccionados].some(id => !items.some(item => Number(item.producto_id) === id))) {
    throw errorHttp('Solo podés enviar información de los productos de interés de este lead.', 422);
  }
  return { ...plano, items, monto: items.reduce((total, item) => total + (Number(item.precio_unitario) || 0) * (Number(item.cantidad) || 1), 0) };
}

module.exports = { seleccionarProductosMensaje };
