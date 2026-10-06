'use strict';

/**
 * Rutas privadas de LISTADO de tiendas del usuario. Montadas en: /api/tiendas
 * Separadas de /api/mi-tienda (que opera sobre la tienda ACTIVA) porque este
 * listado es justamente lo que permite elegir cuál activar.
 *
 * GET /api/tiendas/mias → todas las tiendas del usuario logueado.
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const TiendaService = require('../services/tienda.service');

router.get('/mias', verificarToken, async (req, res) => {
  try {
    const tiendas = await TiendaService.listarPorUsuario(req.usuario.id);
    return res.json(tiendas);
  } catch (err) {
    console.error('[tiendas] mias:', err.message);
    return res.status(500).json({ message: 'Error al listar tus tiendas.' });
  }
});

module.exports = router;
