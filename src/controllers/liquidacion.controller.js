'use strict';

const liquidacionService = require('../services/liquidacion.service');
const { envolverControlador } = require('../utils/asyncHandler');

function validarParametrosRango(body) {
  const { courier_id, fecha_desde, fecha_hasta } = body;
  if (!courier_id) return 'courier_id es obligatorio';
  if (!fecha_desde || !fecha_hasta) return 'fecha_desde y fecha_hasta son obligatorias';
  return null;
}

exports.previsualizar = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const error = validarParametrosRango(req.body);
    if (error) return res.status(400).json({ error });

    const { courier_id, fecha_desde, fecha_hasta, ajuste_manual } = req.body;
    const resultado = await liquidacionService.previsualizar({
      courier_id, fecha_desde, fecha_hasta, usuario_id,
      ajuste_manual: ajuste_manual || 0,
    });
    res.json(resultado);
  } catch (error) {
    console.error('Error previsualizando liquidación:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.confirmar = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const error = validarParametrosRango(req.body);
    if (error) return res.status(400).json({ error });

    const { courier_id, fecha_desde, fecha_hasta, ajuste_manual, observacion } = req.body;
    const liquidacion = await liquidacionService.confirmar({
      courier_id, fecha_desde, fecha_hasta, usuario_id,
      usuario_registro_id: usuario_id,
      ajuste_manual: ajuste_manual || 0,
      observacion: observacion || null,
    });
    res.status(201).json(liquidacion);
  } catch (error) {
    console.error('Error confirmando liquidación:', error);
    res.status(400).json({ error: error.message || 'Error al confirmar la liquidación' });
  }
};

exports.listarPorCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { courier_id } = req.params;
    const liquidaciones = await liquidacionService.listarPorCourier(courier_id, usuario_id);
    res.json(liquidaciones);
  } catch (error) {
    console.error('Error listando liquidaciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Todo lo que estos handlers no atrapen termina en el middleware de errores
// de server.js (500 + log) en vez de tumbar el proceso. Ver src/utils/asyncHandler.js.
envolverControlador(module.exports);
