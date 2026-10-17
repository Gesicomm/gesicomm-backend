'use strict';

const axios = require('axios');

/**
 * Purga puntual del cache de borde de nginx (ver deploy/nginx/snippets/
 * landing-cache-purge.conf, instalado a mano en el VPS el 2026-10-17) para
 * que un guardado se vea en la landing pública al toque, en vez de esperar
 * los 60s de proxy_cache_valid (landing-cache-location.conf).
 *
 * Mejor esfuerzo, nunca crítico: si la purga falla (nginx sin el módulo
 * todavía en otro ambiente, timeout, lo que sea) la landing sigue
 * sirviéndose igual — solo tarda los 60s de siempre en refrescarse sola.
 * Por eso nunca propaga el error ni frena el guardado que la dispara.
 */
class CachePurgeService {
  static async purgarLanding(tienda, landing) {
    if (!tienda || !landing) return;
    const hosts = [
      tienda.subdominio ? `${tienda.subdominio}.gesicomm.com` : null,
      tienda.dominio_propio_habilitado && tienda.dominio_propio ? tienda.dominio_propio : null,
    ].filter(Boolean);
    if (!hosts.length) return;
    // '' = /api/l/ (home de la tienda). Una landing es_home se sirve por
    // las dos rutas; el resto solo por su slug.
    const rutas = landing.es_home ? ['', landing.slug] : [landing.slug];
    const pedidos = [];
    for (const host of hosts) {
      for (const ruta of new Set(rutas.filter(r => r !== undefined && r !== null))) {
        pedidos.push(
          axios.get(`http://127.0.0.1/purgar-cache/api/l/${ruta}`, {
            headers: { Host: host },
            timeout: 1500,
            validateStatus: () => true,
          }).catch((err) => {
            console.error('[cachePurge] no se pudo purgar', host, ruta, err.message);
          })
        );
      }
    }
    await Promise.all(pedidos);
  }
}

module.exports = CachePurgeService;
