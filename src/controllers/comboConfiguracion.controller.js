'use strict';

/**
 * Controller de Configuración Económica de Combos.
 *
 * GET  /api/combos/configuracion  → obtener configuración del tenant
 * POST /api/combos/configuracion  → actualizar configuración del tenant
 */

const ComboConfiguracionService = require('../services/comboConfiguracion.service');

async function obtener(req, res) {
  try {
    const config = await ComboConfiguracionService.obtenerOCrear(req.usuario.tenantId);
    return res.json(config);
  } catch (err) {
    console.error('[combo config] obtener:', err.message);
    return res.status(500).json({ message: 'Error al obtener la configuración.' });
  }
}

async function actualizar(req, res) {
  try {
    const config = await ComboConfiguracionService.actualizar(req.usuario.tenantId, req.body);
    return res.json(config);
  } catch (err) {
    console.error('[combo config] actualizar:', err.message);
    return res.status(400).json({ message: err.message || 'Error al actualizar la configuración.' });
  }
}

module.exports = { obtener, actualizar };
