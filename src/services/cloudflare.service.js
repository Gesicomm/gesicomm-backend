'use strict';

/**
 * Cliente de la API de Cloudflare for SaaS (Custom Hostnames) — permite
 * que un usuario apunte su propio dominio (mitienda.com) a la app vía
 * CNAME, delegando la emisión de TLS a Cloudflare.
 *
 * Requiere en el entorno:
 *   CF_ZONE_ID          - zone ID de gesicomm.com en Cloudflare
 *   CF_API_TOKEN         - token con permiso "Zone.SSL and Certificates: Edit"
 *   CF_FALLBACK_ORIGIN   - hostname al que Cloudflare enruta el dominio
 *                          propio del usuario, ej: app.gesicomm.com
 *
 * No se puede probar en local sin credenciales reales de Cloudflare — el
 * resto del flujo de dominio propio (guardar el hostname, mostrar el TXT,
 * el botón "Verificar") sí funciona sin esto, solo estas 3 llamadas
 * dependen de la API real.
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function config() {
  const zoneId = process.env.CF_ZONE_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!zoneId || !apiToken) {
    throw new Error('Cloudflare no está configurado (faltan CF_ZONE_ID / CF_API_TOKEN en el entorno).');
  }
  return { zoneId, apiToken };
}

async function llamarCF(path, options = {}) {
  const { apiToken } = config();
  const res = await fetch(`${CF_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    const mensaje = data.errors?.map(e => e.message).join('; ') || `Error de Cloudflare (HTTP ${res.status}).`;
    throw new Error(mensaje);
  }
  return data.result;
}

class CloudflareService {

  /**
   * Registra un dominio propio como Custom Hostname. Cloudflare devuelve
   * el registro TXT que el usuario tiene que agregar en su DNS para
   * demostrar que el dominio es suyo — recién ahí emite el certificado.
   *
   * @param {string} dominio - ej: "mitienda.com"
   * @returns {Promise<{ id: string, ownershipVerification: { type: string, name: string, value: string }, estado: string }>}
   */
  static async crearCustomHostname(dominio) {
    const { zoneId } = config();
    const fallbackOrigin = process.env.CF_FALLBACK_ORIGIN;
    if (!fallbackOrigin) throw new Error('Falta CF_FALLBACK_ORIGIN en el entorno.');

    const result = await llamarCF(`/zones/${zoneId}/custom_hostnames`, {
      method: 'POST',
      body: JSON.stringify({
        hostname: dominio,
        ssl: { method: 'txt', type: 'dv' },
      }),
    });

    return {
      id: result.id,
      ownershipVerification: result.ownership_verification && {
        type: result.ownership_verification.type,
        name: result.ownership_verification.name,
        value: result.ownership_verification.value,
      },
      estado: result.status,
    };
  }

  /**
   * Cloudflare devuelve ownership_verification en CADA GET, no solo al
   * crear — se reenvía siempre para que el frontend pueda re-mostrar el
   * TXT si el usuario recarga la página antes de que la propagación DNS
   * termine (puede tardar minutos u horas).
   *
   * @param {string} cfHostnameId
   * @returns {Promise<{ estado: string, sslEstado: string, activo: boolean, ownershipVerification: object|null }>}
   */
  static async verificarEstado(cfHostnameId) {
    const { zoneId } = config();
    const result = await llamarCF(`/zones/${zoneId}/custom_hostnames/${cfHostnameId}`, {
      method: 'GET',
    });

    return {
      estado: result.status,
      sslEstado: result.ssl?.status,
      activo: result.status === 'active' && result.ssl?.status === 'active',
      ownershipVerification: result.ownership_verification && {
        type: result.ownership_verification.type,
        name: result.ownership_verification.name,
        value: result.ownership_verification.value,
      },
    };
  }

  /**
   * @param {string} cfHostnameId
   */
  static async eliminarCustomHostname(cfHostnameId) {
    const { zoneId } = config();
    await llamarCF(`/zones/${zoneId}/custom_hostnames/${cfHostnameId}`, {
      method: 'DELETE',
    });
    return true;
  }
}

module.exports = CloudflareService;
