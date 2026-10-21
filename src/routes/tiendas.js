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

router.patch('/:id/estado', verificarToken, async (req, res) => {
  const tiendaId = Number(req.params.id);
  if (!Number.isSafeInteger(tiendaId) || tiendaId <= 0) {
    return res.status(400).json({ message: 'Indicá una tienda válida.' });
  }
  try {
    const tienda = await TiendaService.cambiarEstado(tiendaId, req.usuario.id, req.body?.activo);
    return res.json(tienda);
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error('[tiendas] estado:', err.message);
    return res.status(500).json({ message: 'No se pudo cambiar el estado de la tienda.' });
  }
});

router.delete('/:id', verificarToken, async (req, res) => {
  const tiendaId = Number(req.params.id);
  if (!Number.isSafeInteger(tiendaId) || tiendaId <= 0) {
    return res.status(400).json({ message: 'Indicá una tienda válida.' });
  }
  try {
    return res.json(await TiendaService.eliminar(tiendaId, req.usuario.id, req.body?.nombre));
  } catch (err) {
    if ([400, 404, 409].includes(err.status)) return res.status(err.status).json({ message: err.message });
    if (err.name === 'SequelizeForeignKeyConstraintError' || err.original?.code === '40001') {
      return res.status(409).json({ message: 'La tienda tiene datos asociados o cambió mientras intentabas eliminarla. Actualizá el listado y probá de nuevo.' });
    }
    console.error('[tiendas] eliminar:', err.message);
    return res.status(500).json({ message: 'No se pudo eliminar la tienda.' });
  }
});

module.exports = router;
