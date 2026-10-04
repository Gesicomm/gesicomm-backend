'use strict';

const { z } = require('zod');

function configuration() {
  const environment = process.env.SPEEDBOX_ENVIRONMENT || 'sandbox';
  if (!['sandbox', 'production'].includes(environment)) throw Object.assign(new Error('Ambiente Speedbox invalido.'), { status: 503 });
  const endpoint = process.env.SPEEDBOX_API_URL || (environment === 'sandbox' ? 'https://speedboxpy.com/api/speedbox_sandbox.php' : '');
  let url;
  try { url = new URL(endpoint); } catch { throw Object.assign(new Error('Configura SPEEDBOX_API_URL.'), { status: 503 }); }
  if (url.protocol !== 'https:' || url.hostname !== 'speedboxpy.com' || url.username || url.password || url.search || url.hash ||
      (environment === 'production' && url.pathname.includes('sandbox'))) {
    throw Object.assign(new Error('Endpoint Speedbox invalido para el ambiente.'), { status: 503 });
  }
  const apiKey = process.env.SPEEDBOX_API_KEY;
  const secret = process.env.SPEEDBOX_API_SECRET;
  if (!apiKey || !secret) throw Object.assign(new Error('Faltan credenciales Speedbox en el servidor.'), { status: 503 });
  return { environment, endpoint: url.href, apiKey, secret };
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /secret|token|authorization|api.?key/i.test(key) ? '[REDACTED]' : redact(item)]));
  if (typeof value !== 'string') return value;
  for (const secret of [process.env.SPEEDBOX_API_KEY, process.env.SPEEDBOX_API_SECRET, process.env.SPEEDBOX_WEBHOOK_TOKEN].filter(Boolean)) {
    value = value.split(secret).join('[REDACTED]');
  }
  return value;
}

function remoteId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) || !String(value).trim() || String(value).length > 100) {
    throw Object.assign(new Error('Speedbox devolvio un identificador invalido; debe conservarse como texto.'), { status: 502, uncertain: true });
  }
  return String(value);
}

async function request(action, { method = 'GET', body, sinceAt } = {}) {
  const config = configuration();
  const url = new URL(config.endpoint);
  url.searchParams.set('action', action);
  if (sinceAt) url.searchParams.set('since_at', sinceAt);
  let response;
  let payload;
  try {
    response = await fetch(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'X-API-Secret': config.secret, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    try { payload = JSON.parse(raw); } catch { payload = { raw }; }
  } catch {
    throw Object.assign(new Error('No se pudo confirmar la respuesta de Speedbox.'), { status: 502, uncertain: method === 'POST' });
  }
  if (!response.ok || payload?.ok !== true) {
    throw Object.assign(new Error(`Speedbox rechazo la solicitud (HTTP ${response.status}).`), {
      status: 502, remoteStatus: response.status, remoteResponse: redact(payload),
      uncertain: method === 'POST' && (response.status >= 500 || response.ok),
    });
  }
  return payload;
}

const requiredText = z.string().trim().min(1);
const orderSchema = z.object({
  external_order_id: requiredText, order_name: requiredText, tienda_id: requiredText,
  created_at: z.string().datetime({ offset: true }), currency: z.literal('PYG'),
  total_price: z.number().finite().nonnegative(), financial_status: z.enum(['paid', 'pending']),
  payment_method: requiredText, store_name: requiredText,
  customer: z.object({ name: requiredText, phone: requiredText }),
  shipping_address: z.object({ address: requiredText, city: requiredText, department: requiredText, reference: z.string(), google_maps_url: z.string() }),
  billing_document_type: z.enum(['CI', 'RUC']).optional(), billing_document_number: requiredText.optional(),
  items: z.array(z.object({ sku: requiredText, title: requiredText, quantity: z.number().int().positive(), price: z.number().finite().nonnegative() })).min(1),
});

module.exports = { configuration, request, remoteId, redact, orderSchema };
