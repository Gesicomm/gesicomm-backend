'use strict';

const SolicitudAbastecimientoService = require('../services/solicitudAbastecimiento.service');

const esAdmin = (req) => req.usuario?.rol === 'administrador';

exports.cotizar = async (req, res) => {
  try {
    const { producto_id, variante_id, cantidad, tipoLogistica, depositoId } = req.body || {};
    if (!producto_id || !cantidad || !tipoLogistica) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (producto, cantidad, tipoLogistica).' });
    }
    const cotizacion = await SolicitudAbastecimientoService.cotizar({
      usuario_id: req.usuario.id,
      producto_id,
      variante_id: variante_id || null,
      cantidad,
      tipoLogistica,
      depositoId,
    });
    return res.json(cotizacion);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};  

exports.crear = async (req, res) => {
  try {
    const { producto_id, variante_id, cantidad, tipoLogistica, depositoId } = req.body || {};
    if (!producto_id || !cantidad || !tipoLogistica) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (producto, cantidad, tipoLogistica).' });
    }
    if (tipoLogistica === 'PROPIA' && !depositoId) {
      return res.status(400).json({ error: 'Falta indicar el depósito de destino.' });
    }
    const solicitud = await SolicitudAbastecimientoService.crear({
      usuario_id: req.usuario.id,
      producto_id,
      variante_id: variante_id || null,
      cantidad,
      tipoLogistica,
      depositoId,
    });
    return res.status(201).json(solicitud);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

exports.listar = async (req, res) => {
  try {
    const { estado, texto, tipoLogistica, page, limit } = req.query;
    const solicitudes = await SolicitudAbastecimientoService.listar({
      usuario_id: req.usuario.id,
      esAdmin: esAdmin(req),
      estado,
      texto,
      tipoLogistica,
      page,
      limit,
    });
    return res.json(solicitudes);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

exports.obtener = async (req, res) => {
  try {
    const solicitud = await SolicitudAbastecimientoService.obtener(req.params.id, {
      usuario_id: req.usuario.id,
      esAdmin: esAdmin(req),
    });
    return res.json(solicitud);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

exports.subirComprobante = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo del comprobante.' });
    const solicitud = await SolicitudAbastecimientoService.subirComprobante({
      solicitud_id: req.params.id,
      usuario_id: req.usuario.id,
      fileData: req.file,
    });
    return res.json(solicitud);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

exports.validarPago = async (req, res) => {
  try {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo Admin' });
    const solicitud = await SolicitudAbastecimientoService.validarPago({
      solicitud_id: req.params.id,
      usuario_id: req.usuario.id,
    });
    return res.json(solicitud);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

exports.rechazarPago = async (req, res) => {
  try {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo Admin' });
    const { motivo } = req.body || {};
    const solicitud = await SolicitudAbastecimientoService.rechazarPago({
      solicitud_id: req.params.id,
      usuario_id: req.usuario.id,
      motivo,
    });
    return res.json(solicitud);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

exports.avanzar = async (req, res) => {
  try {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo Admin' });
    const { centroGesicommId } = req.body || {};
    const solicitud = await SolicitudAbastecimientoService.avanzar({
      solicitud_id: req.params.id,
      usuario_id: req.usuario.id,
      centroGesicommId,
    });
    return res.json(solicitud);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

exports.confirmarRecepcion = async (req, res) => {
  try {
    const solicitud = await SolicitudAbastecimientoService.confirmarRecepcionPropia({
      solicitud_id: req.params.id,
      usuario_id: req.usuario.id,
    });
    return res.json(solicitud);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};
