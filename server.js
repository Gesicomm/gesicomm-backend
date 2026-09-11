'use strict';
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { logger } = require('./src/utils/logger');
const { validarEsquema } = require('./src/utils/validarEsquema');

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
const landingSimpleRoutes = require('./src/routes/landingSimple');
const landingTemplatesRoutes = require('./src/routes/landing-templates');
const landingPublicaRoutes = require('./src/routes/landingPublica');
const landingHtmlRoutes = require('./src/routes/landingHtml');
const builderPublicaRoutes = require('./src/routes/builderPublica');
const builderHtmlRoutes = require('./src/routes/builderHtml');
const tiendaRoutes = require('./src/routes/tienda');
const educacionRoutes = require('./src/routes/educacionRoutes');
const adminEducacionRoutes = require('./src/routes/adminEducacionRoutes');
const publicoRoutes = require('./src/routes/publico');
const reportesRoutes = require('./src/routes/reportes');
const metaReportesRoutes = require('./src/routes/metaReportes');
const costosGastosRoutes = require('./src/routes/costosGastos');
const categoriasCostosGastosRoutes = require('./src/routes/categoriasCostosGastos');
const canalesVentaRoutes = require('./src/routes/canalesVenta');
const cuponesRoutes = require('./src/routes/cupones');
const proveedoresRoutes = require('./src/routes/proveedores');
const pageBuilderRoutes = require('./src/routes/pageBuilder');
const healthRoutes = require('./src/routes/health');
const internoRoutes = require('./src/routes/interno');
const paymentGatewaysRoutes = require('./src/routes/payment-gateways');
const webhooksRoutes = require('./src/routes/webhooks');
const suscripcionesRoutes = require('./src/routes/suscripciones');
const configRoutes = require('./src/routes/config');
const afiliadosRoutes = require('./src/routes/afiliados');
const adminAuthTrackingRoutes = require('./src/routes/adminAuthTracking');
const brevoRoutes = require('./src/routes/brevo');

const app = express();
// 1 hop: Nginx resuelve la IP real del visitante ANTES de proxear acá y
// PISA X-Forwarded-For con un solo valor (ver deploy/nginx/), así que Node
// solo necesita confiar en Nginx mismo por más proxies que haya delante.
// Hoy delante hay dos: Caddy, que termina TLS (deploy/caddy/Caddyfile), y
// para gesicomm.com también Cloudflare. Este valor sigue siendo 1 porque
// lo que importa es cuántos hops REESCRIBEN el header, no cuántos hay.
//
// Ojo: para los dominios propios de clientes, que no pasan por Cloudflare,
// el map de real-ip.conf todavía no sabe caer a X-Forwarded-For y la IP
// que llega es la de Caddy. Está anotado en deploy/PLAN-DOMINIOS-PROPIOS.md.
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
// /api/pb y /pb son las del Page Builder: mismo caso que las de tienda —
// cada página vive en su propio hostname (calcula.gesicomm.com, o el
// dominio propio del usuario), así que su Origin tampoco puede estar en
// una whitelist estática.
const RUTAS_PUBLICAS_TIENDA = /^\/(api\/l|l|api\/pb|pb)(\/|$)/;

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
// El lienzo en blanco manda el HTML/CSS/JS entero de una landing en el
// body — con 10kb no entra ni una página chica. Se declara ANTES del
// parser global: body-parser marca req._body al parsear, así que el de
// abajo ve el body ya leído y no lo vuelve a medir. El límite real por
// campo (y el 422 con el motivo) lo pone landingCodigo.service.js; esto
// es solo el techo del transporte.
app.use('/api/mis-landings-simples', express.json({ limit: '600kb' }));
// Mismo motivo que la línea de arriba: una página del Page Builder manda
// su HTML/CSS/JS entero en el body. El techo de producto son 600 KB
// sumando los tres campos (lo valida builderPageVersion.service.js con un
// 422); acá va 1mb porque serializar 600 KB de HTML a JSON, con todo el
// escapado de comillas, pasa holgadamente de 600 kb en el transporte.
app.use('/api/page-builder', express.json({ limit: '1mb' }));
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
app.use('/api/mis-landings-simples', landingSimpleRoutes);
app.use('/api/landing-templates', landingTemplatesRoutes);
app.use('/api/mi-tienda', tiendaRoutes);
app.use('/api/educacion', educacionRoutes);
app.use('/api/admin/educacion', adminEducacionRoutes);
app.use('/api/admin/auth-tracking', adminAuthTrackingRoutes);
app.use('/api/publico', publicoRoutes);
app.use('/api/l', landingPublicaRoutes);
app.use('/l', landingHtmlRoutes);
app.use('/api/pb', builderPublicaRoutes);
app.use('/pb', builderHtmlRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/meta-reportes', metaReportesRoutes);
app.use('/api/costos-gastos', costosGastosRoutes);
app.use('/api/categorias-costos-gastos', categoriasCostosGastosRoutes);
app.use('/api/canales-venta', canalesVentaRoutes);
app.use('/api/cupones', cuponesRoutes);
app.use('/api/proveedores', proveedoresRoutes);
app.use('/api/page-builder', pageBuilderRoutes);
app.use('/api/health', healthRoutes);
// Fuera de /api a propósito: lo consulta Caddy en localhost, no un navegador.
app.use('/interno', internoRoutes);
app.use('/api/config/payment-gateways', paymentGatewaysRoutes);
// Parametros del sistema. Se monta DESPUES del de pasarelas para no
// interceptar sus rutas anidadas.
app.use('/api/config', configRoutes);
app.use('/api/afiliados', afiliadosRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/brevo', brevoRoutes);
// Planes y suscripciones de Gesicomm (publicas: son el paso previo al alta)
app.use('/api', suscripcionesRoutes);

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

  // 413 del body parser: decirle "error interno" al cliente manda a
  // buscar el problema al lugar equivocado — es el request que no entra.
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      message: 'El contenido enviado es demasiado grande.',
    });
  }

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
const { migrarCanalesVenta, backfillCanalesVenta, retirarCanalMetaAds } = require('./scripts/migrar-canales-venta');
const { migrarCupones } = require('./scripts/migrar-cupones');
const { migrarStockSalonDeposito } = require('./scripts/migrar-stock-salon-deposito');
const { migrarLandingIdEnvios } = require('./scripts/migrar-landing-id-envios');
const { migrarIntentosEntrega } = require('./scripts/migrar-intentos-entrega');
const { migrarAuthTracking } = require('./scripts/migrar-auth-tracking');
const CategoriaCostoGastoService = require('./src/services/categoriaCostoGasto.service');
const CanalVentaService = require('./src/services/canalVenta.service');
const { iniciarJobCostosRecurrentes } = require('./src/services/cron/costosRecurrentes.job');

sequelize.authenticate().then(async () => {
  try {
    await migrarEnvios();
    await migrarLandingEventos();
    await migrarCanalesVenta();
    await migrarCupones();
    await migrarStockSalonDeposito();
    await migrarLandingIdEnvios();
    await migrarIntentosEntrega();
    await migrarAuthTracking();
    await CategoriaCostoGastoService.seedDefaults();
    await CanalVentaService.seedDefaults();
    // Después del seed: necesita los canales ya creados para mapearles los
    // pedidos viejos que solo tienen el `origen` de texto.
    await backfillCanalesVenta();
    await retirarCanalMetaAds();
  } catch (mErr) {
    logger.error('Error al aplicar migraciones de estructura:', mErr);
  }
  logger.info('Migraciones iniciales aplicadas exitosamente.');

  // Validar que el esquema de la BD coincide con los modelos
  try {
    await validarEsquema(sequelize);
  } catch (err) {
    logger.error(err.message);
    console.error(err.message);
    process.exit(1);
  }

  iniciarJobCostosRecurrentes();
  app.listen(PORT, () => {
    logger.info(`Servidor Gesicomm corriendo en puerto ${PORT} [${process.env.NODE_ENV}]`);
  });
}).catch(err => {
  logger.error('Error al sincronizar la base de datos:', err);
});

module.exports = app;
