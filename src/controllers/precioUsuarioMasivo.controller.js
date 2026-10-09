'use strict';

const service = require('../services/precioUsuarioMasivo.service');

const ejecutar = metodo => async (req, res) => {
  try {
    const resultado = await service[metodo](req.usuario.id, req.usuario.tenantId, req.usuario.rol === 'administrador', req.body, req.usuario.tiendaId || null);
    return res.json(resultado);
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message, errores: error.errores });
    console.error(`[vitrina] precios ${metodo}:`, error.message);
    return res.status(500).json({ message: 'No se pudieron procesar los precios. Intentá nuevamente.' });
  }
};

module.exports = { buscar: ejecutar('buscar'), actualizar: ejecutar('actualizar') };
