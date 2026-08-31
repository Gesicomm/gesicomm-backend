'use strict';

/**
 * Rutas públicas (JSON) del Page Builder — SIN verificarToken.
 * Montadas en: /api/pb
 *
 * Rate limit propio y generoso, copiado de routes/landingPublica.js: el
 * tráfico de campañas llega en ráfaga y por NAT de operadoras móviles
 * mucha gente real comparte IP saliente. El limiter corre ANTES de
 * resolver el hostname, para no gastar una consulta a la base por cada
 * request de una ráfaga abusiva.
 *
 * El orden de las rutas importa: /p/... y /f/... son las de fallback y
 * van declaradas antes que /:pageSlug, que si no se comería "p" y "f"
 * como si fueran slugs de páginas de un funnel.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { resolverHostBuilder } = require('../middleware/resolverHostBuilder');
const ctrl = require('../controllers/builderPublica.controller');

const limitePublico = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[pb-publico] 429 rate limit — ip=${req.ip} host=${req.hostname}`);
    res.status(429).json({ message: 'Demasiadas solicitudes. Por favor intentá más tarde.' });
  },
});

router.use(limitePublico);

// Fallback por path, en el host de la app. Antes que /:pageSlug.
router.get('/p/:slug', ctrl.porSlugSuelto);
router.get('/f/:funnelSlug', ctrl.porSlugDeFunnel);
router.get('/f/:funnelSlug/:pageSlug', ctrl.porSlugDeFunnel);

// Preview del borrador — exige la cookie del dueño.
router.get('/preview/:id', ctrl.preview);

// Por hostname: la raíz y los pasos del funnel que sirve ese hostname.
router.get('/', resolverHostBuilder, ctrl.porHostname);
router.get('/:pageSlug', resolverHostBuilder, ctrl.porHostname);

module.exports = router;
