'use strict';

/**
 * Controller público de Landings — sin autenticación. La Tienda ya viene
 * resuelta en req.tienda por middleware/resolverTienda (por hostname).
 *
 * GET  /api/l/:slug          → landing puntual de la tienda del hostname actual.
 * GET  /api/l/                → landing es_home de la tienda del hostname actual.
 * POST /api/l/:slug/eventos   → evento de conversión (Meta CAPI), ver metaCapi.service.js.
 * POST /api/l/eventos         → ídem, para la landing es_home.
 */

const LandingService = require('../services/landing.service');
const MetaCapiService = require('../services/metaCapi.service');

const EVENTOS_PERMITIDOS = new Set(['Contact']);
const MAX_CONTENT_IDS = 40;

async function obtenerPorSlug(req, res) {
  try {
    if (!req.tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }
    const resultado = await LandingService.obtenerPublica(req.tienda, req.params.slug || null);
    if (resultado === null) {
      return res.status(404).json({ message: 'Landing no encontrada.' });
    }
    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[landing-publica] obtenerPorSlug:', err.message);
    return res.status(500).json({ message: 'Error al obtener la landing.' });
  }
}

/**
 * Blindaje de custom_data antes de reenviarlo a la Graph API: solo se
 * aceptan las claves que Meta espera para este tipo de evento, con tipos y
 * tamaños acotados. Todo lo demás en el body se descarta en silencio — es
 * un endpoint público de escritura, nunca se reenvía JSON arbitrario del
 * cliente tal cual.
 */
function limpiarCustomData(custom_data) {
  if (!custom_data || typeof custom_data !== 'object') return undefined;
  const limpio = {};

  if (Array.isArray(custom_data.content_ids)) {
    const ids = custom_data.content_ids.filter(id => typeof id === 'string' && id.length <= 100).slice(0, MAX_CONTENT_IDS);
    if (ids.length) limpio.content_ids = ids;
  }
  if (typeof custom_data.content_name === 'string') {
    limpio.content_name = custom_data.content_name.slice(0, 200);
  }
  if (custom_data.content_type === 'product' || custom_data.content_type === 'product_group') {
    limpio.content_type = custom_data.content_type;
  }

  return Object.keys(limpio).length ? limpio : undefined;
}

/**
 * Detalle por producto de un checkout de carrito — NO se manda a la Graph
 * API de Meta (custom_data ya cumple el schema de Meta por su cuenta), se
 * guarda solo en LandingEvento.payload para que estadisticas() pueda
 * calcular "productos más consultados" con más de un producto por evento
 * (content_name de Meta es un string único, no alcanza para eso).
 */
function limpiarItems(items) {
  if (!Array.isArray(items)) return undefined;
  const limpio = items
    .filter(i => i && typeof i.nombre === 'string' && i.nombre.trim())
    .slice(0, MAX_CONTENT_IDS)
    .map(i => ({
      content_id: typeof i.content_id === 'string' ? i.content_id.slice(0, 100) : null,
      nombre: i.nombre.trim().slice(0, 200),
      cantidad: Number.isFinite(i.cantidad) ? Math.max(1, Math.min(999, Math.trunc(i.cantidad))) : 1,
    }));
  return limpio.length ? limpio : undefined;
}

async function registrarEvento(req, res) {
  try {
    if (!req.tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    const { event_name, event_id, event_source_url, fbc, fbp, custom_data, items } = req.body || {};

    if (!EVENTOS_PERMITIDOS.has(event_name)) {
      return res.status(400).json({ message: 'event_name inválido.' });
    }
    if (typeof event_id !== 'string' || !event_id.trim() || event_id.length > 100) {
      return res.status(400).json({ message: 'event_id inválido.' });
    }

    const landing_id = await LandingService.obtenerIdParaEvento(req.tienda, req.params.slug || null);
    if (!landing_id) {
      return res.status(404).json({ message: 'Landing no encontrada.' });
    }

    // Nunca bloquea la respuesta al visitante por un fallo de Meta — ver
    // metaCapi.service.js, enviarEvento() no rechaza.
    const resultado = await MetaCapiService.enviarEvento(req.tienda, {
      landing_id,
      event_name,
      event_id: event_id.trim(),
      event_source_url: typeof event_source_url === 'string' ? event_source_url.slice(0, 500) : null,
      client_ip: req.ip,
      client_user_agent: req.headers['user-agent'] || null,
      fbc: typeof fbc === 'string' ? fbc.slice(0, 200) : (req.cookies?._fbc || null),
      fbp: typeof fbp === 'string' ? fbp.slice(0, 200) : (req.cookies?._fbp || null),
      custom_data: limpiarCustomData(custom_data),
      items: limpiarItems(items),
    });

    return res.status(202).json({ ok: true, enviado_capi: resultado.enviado });
  } catch (err) {
    console.error('[landing-publica] registrarEvento:', err.message);
    // 202 igual: el pixel de navegador ya disparó, no tiene sentido que el
    // visitante vea un error por algo que no lo afecta.
    return res.status(202).json({ ok: false });
  }
}

module.exports = { obtenerPorSlug, registrarEvento };
