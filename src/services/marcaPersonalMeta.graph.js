'use strict';
// Cliente HTTP de Meta para Marca Personal. Los tokens viajan en el header
// Authorization o en el cuerpo, nunca en logs ni en mensajes de error.
const { MarcaPersonalError } = require('./marcaPersonal.client');

const version = () => process.env.FACEBOOK_API_VERSION || 'v23.0';
const ORIGENES = { instagram: 'https://graph.instagram.com', facebook: 'https://graph.facebook.com' };

function createGraph({ fetchImpl = (...args) => fetch(...args) } = {}) {
  async function llamar(url, { method = 'GET', token, params = {}, json } = {}) {
    const u = new URL(url);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      const valor = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (method === 'GET' || method === 'DELETE') u.searchParams.set(k, valor); else form.set(k, valor);
    }
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    let body;
    if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (method === 'POST') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = form; }
    let respuesta;
    try {
      respuesta = await fetchImpl(u, { method, headers, body, signal: AbortSignal.timeout(25000) });
    } catch {
      throw new MarcaPersonalError(method === 'GET'
        ? 'Meta no respondió a tiempo. Reintentá.'
        : 'Meta no respondió a tiempo. Revisá en la red social si la acción se completó antes de repetirla.', 503);
    }
    const data = await respuesta.json().catch(() => null);
    if (!respuesta.ok || data?.error || data?.error_message) {
      const e = data?.error || {};
      const detalle = e.error_user_msg || e.message || data?.error_message || 'Meta rechazó la operación.';
      const error = new MarcaPersonalError(`Meta rechazó la operación (${e.code || respuesta.status}). ${String(detalle).slice(0, 300)}`, 400);
      error.metaCode = e.code;
      error.metaStatus = respuesta.status;
      throw error;
    }
    return data;
  }
  const graph = (plataforma) => (ruta, opciones) => llamar(`${ORIGENES[plataforma]}/${version()}/${ruta}`, opciones);
  return { llamar, instagram: graph('instagram'), facebook: graph('facebook') };
}

module.exports = { createGraph, ...createGraph() };
