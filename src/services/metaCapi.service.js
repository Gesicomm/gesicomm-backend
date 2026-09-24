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

const crypto = require('crypto');
const EncryptionService = require('../utils/EncryptionService');
const { LandingEvento, Tienda } = require('../models');

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

const sha256 = valor => crypto.createHash('sha256').update(valor).digest('hex');

/** Minúsculas, sin tildes ni espacios — la normalización que pide Meta para nombre y ciudad. */
function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Teléfono en formato internacional sin "+" (Meta lo exige así para que
 * coincida). Paraguay: 0981 123 456 → 595981123456.
 */
function normalizarTelefono(valor) {
  let digitos = String(valor || '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.startsWith('595')) return digitos;
  if (digitos.startsWith('0')) digitos = digitos.slice(1);
  return digitos.length >= 8 ? `595${digitos}` : null;
}

/**
 * Datos del comprador para la Conversions API, hasheados. Solo viajan
 * hashes: Meta los usa para asociar la compra a la persona que vio el
 * anuncio (sube la "calidad de coincidencia"), nunca el dato en claro.
 */
function userDataCliente(cliente) {
  if (!cliente) return {};
  const salida = {};
  const telefono = normalizarTelefono(cliente.telefono);
  if (telefono) salida.ph = [sha256(telefono)];
  const [nombre, ...resto] = String(cliente.nombre || '').trim().split(/\s+/);
  if (normalizarTexto(nombre)) salida.fn = [sha256(normalizarTexto(nombre))];
  if (normalizarTexto(resto.join(''))) salida.ln = [sha256(normalizarTexto(resto.join('')))];
  if (normalizarTexto(cliente.ciudad)) salida.ct = [sha256(normalizarTexto(cliente.ciudad))];
  salida.country = [sha256('py')];
  if (cliente.id_externo) salida.external_id = [sha256(String(cliente.id_externo))];
  return salida;
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
 * @param {object|undefined} evento.cliente - {telefono, nombre, ciudad, id_externo}: se hashea
 *   antes de salir (ver userDataCliente). Solo lo usa la compra — nunca se guarda.
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

    const userData = userDataCliente(evento.cliente);
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

/** El mismo id que usa el Pixel del navegador para esta compra — así Meta la cuenta una vez. */
function eventIdCompra(envio) {
  return `purchase-${envio.id}`;
}

/**
 * Evento Purchase de un pedido que salió de una landing. Se llama en dos
 * momentos distintos según cómo se paga:
 *   - contra entrega / transferencia: al crear el pedido (crearCheckout);
 *   - PagoPar: recién cuando el pago se confirma (confirmarPedidoPagado),
 *     para no reportarle a Meta como venta un pago abandonado.
 *
 * Pedidos sin landing_id (cargados a mano) no se reportan: no vienen de
 * ningún anuncio. Nunca rechaza, igual que enviarEvento.
 *
 * @param {object} envio - Envio con id, landing_id, usuario_id, monto, numero_pedido, telefono, cliente, ciudad.
 * @param {object} [opciones]
 * @param {object} [opciones.tienda] - si no viene, se busca por envio.usuario_id.
 * @param {object} [opciones.contexto] - {client_ip, client_user_agent, fbc, fbp, event_source_url} del navegador, cuando lo hay.
 * @param {number} [opciones.numItems]
 */
async function enviarCompra(envio, { tienda = null, contexto = {}, numItems = null } = {}) {
  try {
    if (!envio?.landing_id) return { enviado: false, motivo: 'El pedido no viene de una landing.' };
    const tiendaFinal = tienda || await Tienda.findOne({ where: { usuario_id: envio.usuario_id } });
    if (!tiendaFinal) return { enviado: false, motivo: 'Tienda no encontrada.' };
    const custom_data = {
      value: Math.max(0, Math.round(Number(envio.monto) || 0)),
      currency: 'PYG',
      order_id: String(envio.numero_pedido || envio.id),
    };
    if (numItems) custom_data.num_items = numItems;
    return await enviarEvento(tiendaFinal, {
      landing_id: envio.landing_id,
      event_name: 'Purchase',
      event_id: eventIdCompra(envio),
      event_source_url: contexto.event_source_url || null,
      client_ip: contexto.client_ip || null,
      client_user_agent: contexto.client_user_agent || null,
      fbc: contexto.fbc || null,
      fbp: contexto.fbp || null,
      custom_data,
      cliente: {
        telefono: envio.telefono,
        nombre: envio.nombre_cliente || envio.cliente,
        ciudad: envio.ciudad,
        id_externo: envio.telefono ? normalizarTelefono(envio.telefono) : null,
      },
    });
  } catch (err) {
    console.error('[meta-capi] Error al enviar Purchase:', err.message);
    return { enviado: false, motivo: err.message };
  }
}

module.exports = { enviarEvento, enviarCompra, eventIdCompra, userDataCliente, normalizarTelefono };
