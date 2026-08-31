'use strict';

/**
 * HTML mínimo con meta tags de Open Graph para los bots de preview.
 *
 * Estaba adentro de routes/landingHtml.js; se factoriza acá porque el
 * Page Builder necesita exactamente lo mismo (routes/builderHtml.js) y
 * tener dos copias garantiza que en unos meses una tenga twitter:card y
 * la otra no.
 *
 * Los bots de WhatsApp, Facebook, Twitter y el crawler de revisión de
 * anuncios de Meta NO ejecutan JS: sin esto, un link compartido sale sin
 * preview y un anuncio puede rechazarse por no poder crawlear el destino.
 */

const BOT_UA_RE = /facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|Googlebot|Slackbot|TelegramBot|Discordbot|Pinterest|Bingbot/i;

function esBot(userAgent) {
  return BOT_UA_RE.test(userAgent || '');
}

function escapeHtml(valor = '') {
  return String(valor).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * @param {{titulo?: string, descripcion?: string, imagen?: string|null, url?: string, keywords?: string|null, favicon?: string|null, cta?: string}} datos
 * @returns {string}
 */
function paginaOg({ titulo, descripcion, imagen, url, keywords, favicon, cta = 'Ver' }) {
  const t = escapeHtml(titulo);
  const d = escapeHtml(descripcion);
  const u = escapeHtml(url);
  const imgTag = imagen
    ? `<meta property="og:image" content="${escapeHtml(imagen)}">\n<meta name="twitter:card" content="summary_large_image">`
    : '';
  const keywordsTag = keywords ? `<meta name="keywords" content="${escapeHtml(keywords)}">` : '';
  const faviconTag = favicon ? `<link rel="icon" href="${escapeHtml(favicon)}">` : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
${keywordsTag}
${faviconTag}
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
${imgTag}
</head>
<body>
<h1>${t}</h1>
<p>${d}</p>
<a href="${u}">${escapeHtml(cta)}</a>
</body>
</html>`;
}

module.exports = { BOT_UA_RE, esBot, escapeHtml, paginaOg };
