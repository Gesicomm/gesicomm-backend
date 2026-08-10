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

// Más estricto que el GET: es escritura (dispara una llamada a la Graph
// API de Meta), pero igual de generoso en la ventana — un visitante real
// puede tocar "Consultar" varias veces navegando la landing.
const limiteEventos = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[landing-publica] 429 rate limit eventos — ip=${req.ip} host=${req.hostname}`);
    res.status(429).json({ message: 'Demasiadas solicitudes. Por favor intenta más tarde.' });
  },
});

// Más estricto todavía que /eventos: a diferencia de un evento de
// tracking, esto crea una fila real (Envío) con datos personales del
// visitante — nombre, teléfono, dirección. Sin límite, es trivial de
// abusar para llenar el Kanban de pedidos falsos.
const limiteCheckout = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[landing-publica] 429 rate limit checkout — ip=${req.ip} host=${req.hostname}`);
    res.status(429).json({ message: 'Demasiadas solicitudes. Por favor intenta más tarde.' });
  },
});

// El rate limit corre antes que resolverTienda a propósito (igual que
// antes): así una ráfaga de tráfico abusivo se corta sin gastar una
// consulta a la base por request.
router.get('/', limitePublico, resolverTienda, ctrl.obtenerPorSlug);   // landing es_home de la tienda del hostname
router.post('/eventos', limiteEventos, resolverTienda, ctrl.registrarEvento);
router.post('/checkout', limiteCheckout, resolverTienda, ctrl.crearCheckout);
router.get('/producto/:productoSlug', limitePublico, resolverTienda, ctrl.obtenerProducto);
router.get('/:slug', limitePublico, resolverTienda, ctrl.obtenerPorSlug);
router.get('/:slug/producto/:productoSlug', limitePublico, resolverTienda, ctrl.obtenerProducto);
router.post('/:slug/eventos', limiteEventos, resolverTienda, ctrl.registrarEvento);
router.post('/:slug/checkout', limiteCheckout, resolverTienda, ctrl.crearCheckout);

module.exports = router;
