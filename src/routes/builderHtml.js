'use strict';

/**
 * Punto de entrada público HTML del Page Builder.
 * Montado en: /pb (fuera de /api)
 *
 * Hermano de routes/landingHtml.js, y con el mismo motivo de existir: los
 * bots de preview (WhatsApp, Facebook, Twitter) y el crawler de revisión
 * de anuncios de Meta NO ejecutan JS. Sin esto, compartir el link de una
 * página sale sin preview y un anuncio puede rechazarse por no poder
 * crawlear el destino.
 *
 *   bot     → HTML mínimo con las meta tags de Open Graph, generado acá.
 *   humano  → `X-Accel-Redirect: /_frontend-shell/`, que Nginx intercepta
 *             y resuelve internamente contra el contenedor del frontend
 *             sin cambiar la URL del navegador. Así la detección de bots
 *             vive en un solo lugar (Node) y Nginx solo obedece el header.
 *
 * ⚠️ En desarrollo sin Nginx delante, ese header no lo interpreta nadie y
 * el navegador recibe un 200 vacío. Es la misma limitación conocida que
 * tiene landingHtml.js. Para probar en local se usa el SPA directo
 * (http://localhost:5173/p/<slug>) y el JSON de /api/pb.
 *
 * La detección de bots y el armado del HTML salen de utils/ogHtml.js,
 * compartido con landingHtml.js — no hay dos copias.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { resolverHostBuilder } = require('../middleware/resolverHostBuilder');
const BuilderPublicPageService = require('../services/builderPublicPage.service');
const { esBot, paginaOg } = require('../utils/ogHtml');

const limiteHtml = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[pb-html] 429 rate limit — ip=${req.ip} host=${req.hostname}`);
    res.status(429).send('Demasiadas solicitudes.');
  },
});

function urlCanonica(req) {
  return `https://${req.hostname}${req.originalUrl === '/' ? '' : req.originalUrl}`;
}

/** Resuelve la página según de dónde venga la request (hostname o path). */
async function resolverPagina(req) {
  if (req.builderHost) {
    return BuilderPublicPageService.porHostname(req.builderHost, req.params.pageSlug || null);
  }
  if (req.params.slug) {
    return BuilderPublicPageService.porSlugSuelto(req.params.slug);
  }
  if (req.params.funnelSlug) {
    return BuilderPublicPageService.porSlugDeFunnel(
      req.params.funnelSlug, req.params.pageSlug || null,
    );
  }
  return null;
}

async function manejar(req, res) {
  // El humano no necesita que resolvamos nada: se le sirve el SPA y él
  // pide el JSON. Resolver acá sería una consulta a la base por visita.
  if (!esBot(req.headers['user-agent'])) {
    res.setHeader('X-Accel-Redirect', '/_frontend-shell/');
    return res.status(200).end();
  }

  const url = urlCanonica(req);

  try {
    const resultado = await resolverPagina(req);

    if (!resultado) {
      return res.status(404).send(paginaOg({
        titulo: 'Página no encontrada',
        descripcion: 'Esta página no está disponible.',
        imagen: null,
        url,
      }));
    }

    const { seo } = resultado;
    const imagenAbsoluta = seo.og_imagen
      ? `${req.protocol}://${req.get('host')}${seo.og_imagen}`
      : null;

    return res.status(200).send(paginaOg({
      titulo: seo.og_titulo || seo.titulo,
      descripcion: seo.og_descripcion || seo.descripcion,
      imagen: imagenAbsoluta,
      favicon: seo.favicon,
      url,
    }));
  } catch (err) {
    const status = err.status === 404 ? 404 : 500;
    return res.status(status).send(paginaOg({
      titulo: err.enConstruccion ? 'Página en construcción' : 'Página no encontrada',
      descripcion: err.enConstruccion ? 'Volvé en un rato.' : '',
      imagen: null,
      url,
    }));
  }
}

router.use(limiteHtml);

// Fallback por path — antes que /:pageSlug, que si no se comería "p"/"f".
router.get('/p/:slug', manejar);
router.get('/f/:funnelSlug', manejar);
router.get('/f/:funnelSlug/:pageSlug', manejar);

// Por hostname.
router.get('/', resolverHostBuilder, manejar);
router.get('/:pageSlug', resolverHostBuilder, manejar);

module.exports = router;
