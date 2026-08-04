'use strict';

/**
 * Punto de entrada público HTML de una tienda — el link que se comparte
 * (WhatsApp, Meta Ads) apunta a la raíz del hostname de la tienda
 * (https://<tienda>.gesicomm.com), resuelto por hostname vía
 * middleware/resolverTienda (subdominio o dominio propio).
 * Montada en: /l (fuera de /api) — pero desde la IP dedicada, Nginx
 * reescribe internamente "/" a "/l" en el vhost de *.gesicomm.com (ver
 * deploy/nginx/tiendas.gesicomm.com, location = /), así que el visitante
 * nunca ve "/l" en la URL. Sigue viviendo acá adentro porque /l y /l/:slug
 * quedaron como ruta pública de compatibilidad — ver App.jsx del frontend.
 *
 * Arquitectura de despliegue real (VPS de producción, 2026-07-31): el
 * frontend corre como su propio contenedor Docker (gesicomm-front, nginx
 * interno sirviendo el build, expuesto en 127.0.0.1:8080) y el backend
 * como otro (gesicomm-back, 127.0.0.1:3000). Nginx en el host solo hace
 * de reverse proxy hacia esos dos puertos — no sirve archivos del disco
 * directamente. Ver deploy/nginx/tiendas.gesicomm.com.
 *
 * Por qué existe esta ruta además de /api/l/:slug:
 * - Bots de preview (WhatsApp, Facebook, Twitter, etc.) y el crawler de
 *   revisión de anuncios de Meta no ejecutan JS: sin esto, cualquier link
 *   compartido sale sin preview y un anuncio puede rechazarse por no poder
 *   crawlear el destino.
 *
 * Humanos: se responde con `X-Accel-Redirect: /_frontend-shell/` — Nginx
 * lo intercepta y re-enruta internamente a un location marcado `internal`
 * que hace proxy_pass al contenedor del frontend (127.0.0.1:8080), sin
 * cambiar la URL del navegador. Así la detección de bots sigue viviendo
 * en un solo lugar (acá, Node) — Nginx no necesita saber qué es un bot,
 * solo reenvía el User-Agent y obedece el header. Sin Nginx delante (dev
 * local sin el proxy levantado) este header no lo interpreta nadie y el
 * navegador recibe un 200 vacío — es una limitación conocida de probar
 * subdominios reales en local sin Nginx corriendo; para eso, verificar
 * contra /api/l/:slug directo (JSON) alcanza para validar la lógica.
 *
 * Bots conocidos → HTML mínimo con <meta property="og:..."> generado en
 * el momento, sin SSR real.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const { resolverTienda } = require('../middleware/resolverTienda');
const LandingService = require('../services/landing.service');

const BOT_UA_RE = /facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|Googlebot|Slackbot|TelegramBot|Discordbot|Pinterest|Bingbot/i;

const limiteHtml = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[landing-html] 429 rate limit — ip=${req.ip} host=${req.hostname} slug=${req.params.slug || '(home)'}`);
    res.status(429).send('Demasiadas solicitudes.');
  },
});

function escapeHtml(valor = '') {
  return String(valor).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function paginaOg({ titulo, descripcion, imagen, url, keywords }) {
  const t = escapeHtml(titulo);
  const d = escapeHtml(descripcion);
  const u = escapeHtml(url);
  const imgTag = imagen ? `<meta property="og:image" content="${escapeHtml(imagen)}">\n<meta name="twitter:card" content="summary_large_image">` : '';
  const keywordsTag = keywords ? `<meta name="keywords" content="${escapeHtml(keywords)}">` : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
${keywordsTag}
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
${imgTag}
</head>
<body>
<h1>${t}</h1>
<p>${d}</p>
<a href="${u}">Ver catálogo</a>
</body>
</html>`;
}

async function manejarSolicitudPublica(req, res) {
  if (!req.tienda) {
    return res.status(404).send('No se encontró ninguna tienda en este dominio.');
  }

  const esBot = BOT_UA_RE.test(req.headers['user-agent'] || '');
  // Siempre la raíz del hostname: con el cap de una landing por tienda
  // (siempre es_home), esa es la URL pública real sea cual sea el path
  // por el que se haya llegado acá (/, /l, o /l/:slug).
  const destino = `https://${req.hostname}`;

  if (!esBot) {
    res.setHeader('X-Accel-Redirect', '/_frontend-shell/');
    return res.status(200).end();
  }

  try {
    const resultado = await LandingService.obtenerPublica(req.tienda, req.params.slug || null);

    if (!resultado || !resultado.disponible) {
      return res.status(resultado ? 200 : 404).send(paginaOg({
        titulo: 'Vidriera no disponible',
        descripcion: 'Este catálogo no está disponible en este momento.',
        imagen: null,
        url: destino,
      }));
    }

    // resultado.seo.* ya trae los fallbacks resueltos (título/descripción
    // propios de SEO si se cargaron, si no el título/descripción de la
    // landing; og_imagen cae al banner si no hay una imagen OG propia) —
    // ver landing.service.js obtenerPublica(). Antes esto ignoraba todo
    // eso y armaba el preview con el título/descripción crudos y la
    // primera imagen de item, así que el paso "SEO" del editor no tenía
    // ningún efecto sobre lo que ve un bot real.
    const seo = resultado.seo || {};
    const imagenRelativa = seo.og_imagen || resultado.items.find(i => i.imagen)?.imagen || null;
    const imagenAbsoluta = imagenRelativa ? `${req.protocol}://${req.get('host')}${imagenRelativa}` : null;

    return res.status(200).send(paginaOg({
      titulo: seo.titulo || resultado.titulo || resultado.tienda?.nombre || 'Catálogo',
      descripcion: seo.descripcion || resultado.descripcion || '',
      imagen: imagenAbsoluta,
      url: destino,
      keywords: seo.keywords || null,
    }));
  } catch (err) {
    console.error('[landing-html] error:', err.message);
    return res.status(500).send(paginaOg({ titulo: 'Error', descripcion: '', imagen: null, url: destino }));
  }
}

router.use(limiteHtml, resolverTienda);
router.get('/', manejarSolicitudPublica);
router.get('/:slug', manejarSolicitudPublica);

module.exports = router;
