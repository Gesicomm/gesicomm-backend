'use strict';
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { logger } = require('./src/utils/logger');

// Rutas
const path = require('path');
const authRoutes = require('./src/routes/auth');
const metaRoutes = require('./src/routes/meta');
const productosRoutes = require('./src/routes/productos');
const categoriasRoutes = require('./src/routes/categorias');
const marcasRoutes = require('./src/routes/marcas');
const combosAdminRoutes = require('./src/routes/combos-admin');
const ofertasAdminRoutes = require('./src/routes/ofertas-admin');
const courierRoutes = require('./src/routes/courierRoutes');
const envioRoutes = require('./src/routes/envioRoutes');
const metodoPagoRoutes = require('./src/routes/metodoPagoRoutes');
const liquidacionRoutes = require('./src/routes/liquidacionRoutes');
const vitrinaRoutes = require('./src/routes/vitrina');
const landingRoutes = require('./src/routes/landing');
const landingTemplatesRoutes = require('./src/routes/landing-templates');
const landingPublicaRoutes = require('./src/routes/landingPublica');
const landingHtmlRoutes = require('./src/routes/landingHtml');
const tiendaRoutes = require('./src/routes/tienda');
const educacionRoutes = require('./src/routes/educacionRoutes');
const adminEducacionRoutes = require('./src/routes/adminEducacionRoutes');
const publicoRoutes = require('./src/routes/publico');
const reportesRoutes = require('./src/routes/reportes');
const metaReportesRoutes = require('./src/routes/metaReportes');

const app = express();
// 1 hop: Nginx (deploy/nginx/gesicomm.conf) resuelve la IP real del
// visitante detrás de Cloudflare vía ngx_http_realip_module ANTES de
// proxear acá, así que Node solo necesita confiar en Nginx mismo — no en
// 2 (Cloudflare + Nginx). Si cambia esa topología (ej. se saca el
// realip_module de Nginx), este valor tiene que subir a 2 o req.ip queda
// mal para rate limiting y, más adelante, para el matching de IP de Meta CAPI.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ============================================================
// 1. HELMET — Headers de seguridad HTTP
//    Configura automáticamente: CSP, HSTS, X-Frame-Options, etc.
// ============================================================
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ============================================================
// 2. CORS — Solo permite peticiones desde el frontend oficial.
//    Permite dinámicamente puertos de localhost / 127.0.0.1 en desarrollo.
// ============================================================
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://gesicomm.com',
  'https://www.gesicomm.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000'
].filter(Boolean);

// Rutas públicas de tienda (/api/l = JSON de la landing, /l = HTML con los
// meta tags de Open Graph). A diferencia del resto de la app, NO se sirven
// desde un origen fijo: cada tienda tiene el suyo (<sub>.gesicomm.com o su
// dominio propio verificado), así que su Origin nunca puede estar en una
// whitelist estática.
const RUTAS_PUBLICAS_TIENDA = /^\/(api\/l|l)(\/|$)/;

const corsApp = cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      /^http:\/\/localhost(:\d+)?$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error('Bloqueado por política CORS'));
  },
  credentials: true,
});

/**
 * El navegador manda el header `Origin` en TODO método que no sea GET/HEAD,
 * incluso cuando la request es same-origin. Con la whitelist de corsApp eso
 * significaba que cada POST a /api/l/eventos desde https://<tienda>.gesicomm.com
 * moría con 500 en el CORS global, antes de llegar a resolverTienda y al
 * controller — los eventos de conversión (AddToCart / InitiateCheckout /
 * Contact) se perdían en silencio y en LandingEvento solo quedaban las
 * 'visita', que se escriben del lado del servidor durante el GET (el GET
 * pasaba justamente porque same-origin no manda Origin).
 *
 * Abrirlo acá es seguro y no agranda la superficie real: estas rutas son
 * anónimas por diseño, no leen sesión (credentials:false ⇒ el navegador no
 * manda ni expone cookies cross-origin) y solo devuelven datos que ya están
 * públicos en la propia página. El abuso posible —mandar eventos falsos— ya
 * era posible con curl desde siempre; contra eso está el rate limit por IP de
 * routes/landingPublica.js, no el CORS.
 */
const corsTiendaPublica = cors({
  origin: true,
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
});

app.use((req, res, next) => (
  RUTAS_PUBLICAS_TIENDA.test(req.path) ? corsTiendaPublica : corsApp
)(req, res, next));

// ============================================================
// 3. Parsers
// ============================================================
app.use(express.json({ limit: '10kb' })); // Límite de tamaño para prevenir ataques
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
// Servir imágenes de productos subidas
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use(cookieParser()); // Necesario para leer cookies HttpOnly

// ============================================================
// 4. Rate limiting global (protección base)
//    Los endpoints de autenticación tienen su propio límite más estricto.
// ============================================================
const limiteGlobal = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: process.env.NODE_ENV === 'production' ? 300 : 3000, // hasta 3000 requests en desarrollo / testing
  message: { message: 'Demasiadas solicitudes. Por favor intenta más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Las rutas públicas de tienda tienen sus propios límites, deliberadamente
  // más altos (600 GET / 120 POST de eventos, ver routes/landingPublica.js y
  // routes/landingHtml.js): el tráfico de campañas de Meta llega en ráfaga y
  // por el CGNAT de las operadoras móviles muchísima gente real comparte IP
  // saliente. Con el límite global de 300 por delante esos límites propios
  // eran inalcanzables — cortaba antes el global, con un 429 igual de
  // invisible que el 500 de CORS. No quedan sin protección: siguen pasando
  // por limitePublico/limiteEventos/limiteHtml.
  skip: (req) => RUTAS_PUBLICAS_TIENDA.test(req.path),
});
app.use(limiteGlobal);

// ============================================================
// 5. Rutas de la API
// ============================================================
app.use('/api/auth', authRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/marcas', marcasRoutes);
app.use('/api/combos', combosAdminRoutes);
app.use('/api/ofertas', ofertasAdminRoutes);
app.use('/api/couriers', courierRoutes);
app.use('/api/envios', envioRoutes);
app.use('/api/metodos-pago', metodoPagoRoutes);
app.use('/api/liquidaciones', liquidacionRoutes);
app.use('/api/vitrina', vitrinaRoutes);
app.use('/api/mis-landings', landingRoutes);
app.use('/api/landing-templates', landingTemplatesRoutes);
app.use('/api/mi-tienda', tiendaRoutes);
app.use('/api/educacion', educacionRoutes);
app.use('/api/admin/educacion', adminEducacionRoutes);
app.use('/api/publico', publicoRoutes);
app.use('/api/l', landingPublicaRoutes);
app.use('/l', landingHtmlRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/meta-reportes', metaReportesRoutes);

// Estado del servidor (público)
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', entorno: process.env.NODE_ENV });
});

// ============================================================
// 6. Manejo de errores global.
//    ❌ NUNCA enviamos stack traces ni detalles internos al cliente.
//    Los detalles se guardan en los logs del servidor.
// ============================================================
app.use((err, req, res, next) => {
  logger.error({
    mensaje: err.message,
    stack: err.stack,
    ruta: req.path,
    metodo: req.method,
    ip: req.ip,
  });

  // Solo enviamos un mensaje genérico al cliente
  res.status(err.status || 500).json({
    message: 'Error interno del servidor.',
  });
});

// ============================================================
// 7. Base de Datos y Servidor
const { sequelize } = require('./src/models');
const { migrarEnvios } = require('./scripts/migrar-envios');
const { migrarLandingEventos } = require('./scripts/migrar-landing-eventos');

sequelize.sync({ alter: false }).then(async () => {
  try {
    await migrarEnvios();
    await migrarLandingEventos();
  } catch (mErr) {
    logger.error('Error al aplicar migraciones de estructura:', mErr);
  }
  logger.info('Modelos y tabla envios sincronizados con la base de datos.');
  app.listen(PORT, () => {
    logger.info(`Servidor Gesicomm corriendo en puerto ${PORT} [${process.env.NODE_ENV}]`);
  });
}).catch(err => {
  logger.error('Error al sincronizar la base de datos:', err);
});

module.exports = app;
