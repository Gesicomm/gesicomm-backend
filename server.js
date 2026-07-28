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

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ============================================================
// 1. HELMET — Headers de seguridad HTTP
//    Configura automáticamente: CSP, HSTS, X-Frame-Options, etc.
// ============================================================
app.use(helmet());

// ============================================================
// 2. CORS — Solo permite peticiones desde el frontend oficial.
//    ❌ NUNCA: origin: '*' para APIs autenticadas.
// ============================================================
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'https://gesicomm.com',
    'https://www.gesicomm.com',
    'http://localhost:5173'
  ].filter(Boolean),
  credentials: true,
}));

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
  max: 200,                  // máximo 200 requests por IP en 15 min
  message: { message: 'Demasiadas solicitudes. Por favor intenta más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
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

// ⚠️ PRECAUCIÓN: En producción NUNCA se debe usar { alter: true } salvo que sepas lo que haces.
const forceAlter = process.env.DB_SYNC_ALTER === 'true';

sequelize.sync({ alter: forceAlter }).then(() => {
  logger.info('Modelos sincronizados con la base de datos.');
  app.listen(PORT, () => {
    logger.info(`Servidor Gesicomm corriendo en puerto ${PORT} [${process.env.NODE_ENV}]`);
  });
}).catch(err => {
  logger.error('Error al sincronizar la base de datos:', err);
});

module.exports = app;
