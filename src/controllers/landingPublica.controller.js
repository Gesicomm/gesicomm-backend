'use strict';

/**
 * Controller público de Landings — sin autenticación. La Tienda ya viene
 * resuelta en req.tienda por middleware/resolverTienda (por hostname).
 *
 * GET /api/l/:slug → landing puntual de la tienda del hostname actual.
 * GET /api/l/      → landing es_home de la tienda del hostname actual.
 */

const LandingService = require('../services/landing.service');

async function obtenerPorSlug(req, res) {
  try {
    if (!req.tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }
    const resultado = await LandingService.obtenerPublica(req.tienda, req.params.slug || null);
    if (resultado === null) {
      return res.status(404).json({ message: 'Landing no encontrada.' });
    }
    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[landing-publica] obtenerPorSlug:', err.message);
    return res.status(500).json({ message: 'Error al obtener la landing.' });
  }
}

module.exports = { obtenerPorSlug };
