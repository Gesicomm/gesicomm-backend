'use strict';

const express = require('express');
const router = express.Router();
const sequelize = require('../config/database');

/**
 * Health check endpoint para verificar el estado del servidor y la base de datos.
 * GET /api/health
 */
router.get('/', async (req, res) => {
  try {
    await sequelize.query('SELECT 1');
    return res.status(200).json({ status: 'ok', db: 'connected' });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      db: 'disconnected',
      message: err.message,
    });
  }
});

module.exports = router;
