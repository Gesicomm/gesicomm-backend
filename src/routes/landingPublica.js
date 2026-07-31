'use strict';

/**
 * Ruta pública (JSON) de Landings — SIN verificarToken.
 * Montada en: /api/l
 *
 * Primera ruta genuinamente pública del proyecto que devuelve datos del
 * catálogo. Rate limit propio y más generoso que el resto: tráfico de
 * campañas de Meta llega en ráfaga y por NAT de operadoras móviles mucha
 * gente real comparte IP saliente — un límite bajo combinado con un
 * trust proxy mal configurado tira 429 en silencio.
 *
 * No cachear esta ruta en ningún CDN/capa intermedia: el query string
 * (fbclid) tiene que sobrevivir intacto para el futuro matching de Meta
 * CAPI (ver Fase 4 del plan de landings) — cachear por URL sin normalizar
 * el query string es la forma típica de perderlo silenciosamente.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { resolverTienda } = require('../middleware/resolverTienda');
const ctrl = require('../controllers/landingPublica.controller');

const limitePublico = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 600,                  // generoso: tráfico de ads llega en ráfaga
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[landing-publica] 429 rate limit — ip=${req.ip} host=${req.hostname} slug=${req.params.slug || '(home)'}`);
    res.status(429).json({ message: 'Demasiadas solicitudes. Por favor intenta más tarde.' });
  },
});

router.use(limitePublico, resolverTienda);

router.get('/', ctrl.obtenerPorSlug);   // landing es_home de la tienda del hostname
router.get('/:slug', ctrl.obtenerPorSlug);

module.exports = router;
