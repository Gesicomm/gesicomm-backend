'use strict';
const RedFulfillment = require('../services/redFulfillment.service');

exports.cotizarEntregaRaha = async (req, res) => {
  try {
    const payload = req.body || {};
    if (typeof payload.ciudad !== 'string' || (payload.departamento != null && typeof payload.departamento !== 'string')) {
      return res.status(400).json({ error: 'Indicá la ciudad y el departamento del destino.' });
    }
    if (payload.pago_anticipado !== undefined && typeof payload.pago_anticipado !== 'boolean') {
      return res.status(400).json({ error: 'El tipo de pago debe ser verdadero o falso.' });
    }
    return res.json(await RedFulfillment.cotizarEntregaRaha(payload));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo cotizar la entrega de RAHA.' });
  }
};
