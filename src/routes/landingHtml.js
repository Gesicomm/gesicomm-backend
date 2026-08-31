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

const { resolverTiendaOpcional } = require('../middleware/resolverTienda');
const LandingService = require('../services/landing.service');
const BuilderPublicPageService = require('../services/builderPublicPage.service');
// La deteccion de bots y el HTML de Open Graph viven en utils/ogHtml.js:
// los comparte con routes/builderHtml.js (Page Builder). Tener dos copias
// garantizaba que en unos meses una tuviera twitter:card y la otra no.
const { esBot, paginaOg } = require('../utils/ogHtml');

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

async function manejarSolicitudPublica(req, res) {
  // *.gesicomm.com dejó de ser exclusivo de las tiendas: ahí también viven
  // los subdominios del Page Builder (calcula.gesicomm.com). Si el
  // hostname no es de ninguna tienda, antes de dar 404 hay que preguntarle
  // al builder. Por eso el middleware de acá abajo es la variante
  // "opcional" de resolverTienda, que no corta con 404 por su cuenta.
  if (!req.tienda) {
    return manejarPaginaDelBuilder(req, res);
  }

  const esUnBot = esBot(req.headers['user-agent']);
  // La home de la tienda es la raíz pelada; un funnel/landing con slug
  // propio cuelga directo de esa raíz (https://<tienda>.gesicomm.com/mi-promo),
  // sin el viejo prefijo "/l". El og:url tiene que ser esa URL canónica y
  // no la raíz, o al compartir un funnel el preview enlaza a otra página.
  const destino = req.params.slug
    ? `https://${req.hostname}/${req.params.slug}`
    : `https://${req.hostname}`;

  if (!esUnBot) {
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
        cta: 'Ver catálogo',
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
      cta: 'Ver catálogo',
    }));
  } catch (err) {
    console.error('[landing-html] error:', err.message);
    return res.status(500).send(paginaOg({ titulo: 'Error', descripcion: '', imagen: null, url: destino }));
  }
}

/**
 * El hostname no es de ninguna tienda: puede ser una página del Page
 * Builder. Mismo trato que una landing — al humano se le sirve el SPA vía
 * X-Accel-Redirect y al bot un HTML con las meta tags de Open Graph.
 *
 * La lógica de armado la comparte con routes/builderHtml.js a través de
 * utils/ogHtml.js; lo único propio de acá es el orden de resolución
 * (primero tienda, después builder).
 */
async function manejarPaginaDelBuilder(req, res) {
  const registro = await BuilderPublicPageService.resolverHostname(req.hostname);

  if (!registro) {
    return res.status(404).send('No se encontró ninguna tienda ni página en este dominio.');
  }

  if (!esBot(req.headers['user-agent'])) {
    res.setHeader('X-Accel-Redirect', '/_frontend-shell/');
    return res.status(200).end();
  }

  const destino = req.params.slug
    ? `https://${req.hostname}/${req.params.slug}`
    : `https://${req.hostname}`;

  try {
    const { seo } = await BuilderPublicPageService.porHostname(registro, req.params.slug || null);
    const imagen = seo.og_imagen ? `${req.protocol}://${req.get('host')}${seo.og_imagen}` : null;

    return res.status(200).send(paginaOg({
      titulo: seo.og_titulo || seo.titulo,
      descripcion: seo.og_descripcion || seo.descripcion,
      imagen,
      favicon: seo.favicon,
      url: destino,
    }));
  } catch (err) {
    return res.status(err.status === 404 ? 404 : 500).send(paginaOg({
      titulo: err.enConstruccion ? 'Página en construcción' : 'Página no encontrada',
      descripcion: err.enConstruccion ? 'Volvé en un rato.' : '',
      imagen: null,
      url: destino,
    }));
  }
}

router.use(limiteHtml, resolverTiendaOpcional);
router.get('/', manejarSolicitudPublica);
router.get('/:slug', manejarSolicitudPublica);

module.exports = router;
