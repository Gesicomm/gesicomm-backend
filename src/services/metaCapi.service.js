'use strict';

/**
 * Envío de eventos a la Conversions API (CAPI) de Meta — el lado servidor
 * del Pixel de cada tienda. Complementa (no reemplaza) al Pixel de
 * navegador: mismo event_id en ambos lados para que Meta los deduplique
 * como un solo evento, en vez de contar dos.
 *
 * Cada tienda tiene su propio pixel_id/access_token (Tienda.meta_*, ver
 * tienda.service.js) — no hay un pixel de plataforma compartido.
 */

const EncryptionService = require('../utils/EncryptionService');
const { LandingEvento } = require('../models');

const FB_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';

/**
 * El INSERT del log nunca puede tumbar la respuesta al visitante — pero
 * tragarse el error tampoco: LandingEvento es la ÚNICA fuente de las
 * estadísticas de la landing, así que un fallo silencioso acá se ve igual
 * que "nadie consultó nada". Se loguea y se sigue.
 *
 * La excepción es el choque contra el índice único (landing_id, event_id):
 * eso no es un fallo sino la deduplicación funcionando — el mismo evento ya
 * quedó registrado y el segundo intento se descarta sin ruido.
 */
async function guardarEvento(registro) {
  try {
    await LandingEvento.create(registro);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return;
    console.error('[meta-capi] No se pudo guardar el LandingEvento:', err.message);
  }
}

/**
 * @param {object} tienda - instancia de Tienda con meta_pixel_id/meta_access_token/meta_test_event_code.
 * @param {object} evento
 * @param {number} evento.landing_id
 * @param {string} evento.event_name
 * @param {string} evento.event_id - mismo valor que se le pasa a fbq(...) en el navegador, para deduplicar.
 * @param {string} evento.event_source_url
 * @param {string|null} evento.client_ip
 * @param {string|null} evento.client_user_agent
 * @param {string|null} evento.fbc
 * @param {string|null} evento.fbp
 * @param {object} evento.custom_data
 * @param {Array|undefined} evento.items - detalle por producto de un checkout de carrito.
 *   Solo se guarda en LandingEvento (lo usa estadisticas() para "productos más
 *   consultados") — nunca se manda a la Graph API, que solo entiende custom_data.
 * @returns {Promise<{enviado: boolean, motivo?: string}>} nunca rechaza — un evento de tracking que falla no
 *   puede tumbar la respuesta al visitante ni el flujo de "abrir WhatsApp".
 */
async function enviarEvento(tienda, evento) {
  const registro = {
    landing_id: evento.landing_id,
    tipo_evento: evento.event_name,
    event_id: evento.event_id,
    payload: {
      event_id: evento.event_id,
      event_source_url: evento.event_source_url,
      custom_data: evento.custom_data || null,
      items: evento.items || undefined,
    },
    enviado_capi: false,
  };

  if (!tienda.meta_capi_activo || !tienda.meta_pixel_id || !tienda.meta_access_token) {
    await guardarEvento(registro);
    return { enviado: false, motivo: 'CAPI no configurado para esta tienda.' };
  }

  try {
    const accessToken = EncryptionService.decrypt(tienda.meta_access_token);

    const userData = {};
    if (evento.client_ip) userData.client_ip_address = evento.client_ip;
    if (evento.client_user_agent) userData.client_user_agent = evento.client_user_agent;
    if (evento.fbc) userData.fbc = evento.fbc;
    if (evento.fbp) userData.fbp = evento.fbp;

    const body = {
      data: [{
        event_name: evento.event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: evento.event_id,
        event_source_url: evento.event_source_url,
        action_source: 'website',
        user_data: userData,
        custom_data: evento.custom_data || undefined,
      }],
      access_token: accessToken,
    };
    if (tienda.meta_test_event_code) body.test_event_code = tienda.meta_test_event_code;

    const resp = await fetch(`https://graph.facebook.com/${FB_API_VERSION}/${tienda.meta_pixel_id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => null);
    registro.enviado_capi = resp.ok;
    await guardarEvento(registro);

    if (!resp.ok) {
      console.warn('[meta-capi] Graph API respondió error:', resp.status, data);
      return { enviado: false, motivo: data?.error?.message || `Graph API ${resp.status}` };
    }
    return { enviado: true };
  } catch (err) {
    console.error('[meta-capi] Error al enviar evento:', err.message);
    await guardarEvento(registro);
    return { enviado: false, motivo: err.message };
  }
}

module.exports = { enviarEvento };
