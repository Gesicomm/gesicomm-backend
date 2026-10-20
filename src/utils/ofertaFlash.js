'use strict';

// La campaña flash modifica la presentación de la oferta en esta landing.
// Su vencimiento no modifica los precios globales del catálogo.
function ofertaFlashVencida(urgencia, item, ahora = Date.now()) {
  if (!urgencia?.activo || urgencia.renovar_cada_visita === true) return false;
  const fin = Date.parse(urgencia.fin_at);
  if (!Number.isFinite(fin) || fin > ahora) return false;
  const ids = urgencia.productos?.length ? urgencia.productos : [urgencia.producto_id || urgencia.content_id].filter(Boolean);
  return !ids.length || ids.some(id => [item.content_id, item.id, `${item.tipo || 'producto'}-${item.referencia_id}`].some(valor => String(valor) === String(id)));
}

function quitarOfertaFlashVencida(urgencia, item, ahora) {
  if (!ofertaFlashVencida(urgencia, item, ahora)) return item;
  item.precio_antes = null;
  item.descuento_pct = 0;
  item.ahorro = 0;
  item.etiqueta = String(item.etiqueta || '').split(',').filter(t => t.trim().toLowerCase() !== 'oferta').join(',').trim() || null;
  for (const campo of ['insignia_principal', 'insignia_secundaria']) {
    if (/^(oferta|oferta flash|descuento|promoción|promocion|\d+%\s*(off|de descuento)?)$/i.test(String(item[campo] || '').trim())) item[campo] = '';
  }
  return item;
}

module.exports = { ofertaFlashVencida, quitarOfertaFlashVencida };
