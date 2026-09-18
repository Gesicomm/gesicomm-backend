'use strict';

/**
 * CRUD de recursos de seguimiento de WhatsApp que NO dependen de un pedido
 * puntual: plantillas (BE-02), etiquetas (BE-04), configuración de tiempos
 * rápidos (BE-09) y notificaciones internas (BE-19). Las acciones que sí
 * dependen de un pedido viven en envioSeguimientoController.js.
 */
const { Op } = require('sequelize');
const { WhatsappPlantilla, SeguimientoEtiqueta, SeguimientoConfiguracion, Notificacion } = require('../models');
const { listarVariablesDisponibles } = require('../services/seguimiento/plantillaResolver.service');

function esAdministrador(req) {
  return req.usuario?.rol === 'administrador';
}

// ============================================================
// Plantillas de WhatsApp (BE-02)
// ============================================================

exports.listarPlantillas = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { activo } = req.query;
  const where = esAdministrador(req) ? {} : { usuario_id };
  if (activo !== undefined) where.activo = activo === 'true';
  const plantillas = await WhatsappPlantilla.findAll({
    where,
    include: [{ model: SeguimientoEtiqueta, as: 'etiqueta', attributes: ['id', 'nombre', 'codigo'] }],
    order: [['nombre', 'ASC']],
  });
  res.json(plantillas);
};

exports.obtenerPlantilla = async (req, res) => {
  const usuario_id = req.usuario.id;
  const plantilla = await WhatsappPlantilla.findOne({
    where: esAdministrador(req) ? { id: req.params.id } : { id: req.params.id, usuario_id },
    include: [{ model: SeguimientoEtiqueta, as: 'etiqueta' }],
  });
  if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });
  res.json(plantilla);
};

exports.crearPlantilla = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { nombre, codigo, mensaje, etiqueta_id, activo } = req.body;
  if (!nombre || !codigo || !mensaje) {
    return res.status(400).json({ error: 'nombre, codigo y mensaje son obligatorios' });
  }
  try {
    const plantilla = await WhatsappPlantilla.create({
      usuario_id, nombre, codigo, mensaje, etiqueta_id: etiqueta_id || null, activo: activo !== undefined ? activo : true,
    });
    res.status(201).json(plantilla);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: `Ya existe una plantilla con el código "${codigo}"` });
    }
    res.status(500).json({ error: 'Error al crear la plantilla' });
  }
};

exports.editarPlantilla = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { nombre, codigo, mensaje, etiqueta_id, activo } = req.body;
  const plantilla = await WhatsappPlantilla.findOne({
    where: esAdministrador(req) ? { id: req.params.id } : { id: req.params.id, usuario_id },
  });
  if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });

  try {
    await plantilla.update({
      nombre: nombre ?? plantilla.nombre,
      codigo: codigo ?? plantilla.codigo,
      mensaje: mensaje ?? plantilla.mensaje,
      etiqueta_id: etiqueta_id !== undefined ? etiqueta_id : plantilla.etiqueta_id,
      activo: activo !== undefined ? activo : plantilla.activo,
    });
    res.json(plantilla);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: `Ya existe una plantilla con el código "${codigo}"` });
    }
    res.status(500).json({ error: 'Error al editar la plantilla' });
  }
};

exports.eliminarPlantilla = async (req, res) => {
  const usuario_id = req.usuario.id;
  const plantilla = await WhatsappPlantilla.findOne({
    where: esAdministrador(req) ? { id: req.params.id } : { id: req.params.id, usuario_id },
  });
  if (!plantilla) return res.status(404).json({ error: 'Plantilla no encontrada' });
  await plantilla.destroy();
  res.status(204).send();
};

/** GET /api/seguimiento/variables — catálogo de variables soportadas por las plantillas (BE-03), para el editor del frontend. */
exports.listarVariables = async (req, res) => {
  res.json(listarVariablesDisponibles());
};

// ============================================================
// Etiquetas de seguimiento (BE-04)
// ============================================================

exports.listarEtiquetas = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { activo } = req.query;
  const where = esAdministrador(req) ? {} : { usuario_id };
  if (activo !== undefined) where.activo = activo === 'true';
  const etiquetas = await SeguimientoEtiqueta.findAll({ where, order: [['nombre', 'ASC']] });
  res.json(etiquetas);
};

exports.crearEtiqueta = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { nombre, codigo, activo } = req.body;
  if (!nombre || !codigo) return res.status(400).json({ error: 'nombre y codigo son obligatorios' });
  try {
    const etiqueta = await SeguimientoEtiqueta.create({ usuario_id, nombre, codigo, activo: activo !== undefined ? activo : true });
    res.status(201).json(etiqueta);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: `Ya existe una etiqueta con el código "${codigo}"` });
    }
    res.status(500).json({ error: 'Error al crear la etiqueta' });
  }
};

exports.editarEtiqueta = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { nombre, codigo, activo } = req.body;
  const etiqueta = await SeguimientoEtiqueta.findOne({
    where: esAdministrador(req) ? { id: req.params.id } : { id: req.params.id, usuario_id },
  });
  if (!etiqueta) return res.status(404).json({ error: 'Etiqueta no encontrada' });
  try {
    await etiqueta.update({
      nombre: nombre ?? etiqueta.nombre,
      codigo: codigo ?? etiqueta.codigo,
      activo: activo !== undefined ? activo : etiqueta.activo,
    });
    res.json(etiqueta);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: `Ya existe una etiqueta con el código "${codigo}"` });
    }
    res.status(500).json({ error: 'Error al editar la etiqueta' });
  }
};

exports.eliminarEtiqueta = async (req, res) => {
  const usuario_id = req.usuario.id;
  const etiqueta = await SeguimientoEtiqueta.findOne({
    where: esAdministrador(req) ? { id: req.params.id } : { id: req.params.id, usuario_id },
  });
  if (!etiqueta) return res.status(404).json({ error: 'Etiqueta no encontrada' });
  await etiqueta.destroy();
  res.status(204).send();
};

// ============================================================
// Configuración de tiempos rápidos (BE-09)
// ============================================================

exports.obtenerConfiguracion = async (req, res) => {
  const usuario_id = req.usuario.id;
  const [config] = await SeguimientoConfiguracion.findOrCreate({ where: { usuario_id }, defaults: { usuario_id } });
  res.json(config);
};

exports.actualizarConfiguracion = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { tiempos_rapidos_horas } = req.body;
  if (!Array.isArray(tiempos_rapidos_horas) || tiempos_rapidos_horas.some((h) => !Number.isFinite(Number(h)) || Number(h) <= 0)) {
    return res.status(400).json({ error: 'tiempos_rapidos_horas debe ser un array de números positivos (horas)' });
  }
  const [config] = await SeguimientoConfiguracion.findOrCreate({ where: { usuario_id }, defaults: { usuario_id } });
  await config.update({ tiempos_rapidos_horas: tiempos_rapidos_horas.map(Number) });
  res.json(config);
};

// ============================================================
// Notificaciones internas (BE-19)
// ============================================================

exports.listarNotificaciones = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { leida, limit = 50 } = req.query;
  const where = { usuario_id };
  if (leida !== undefined) where.leida = leida === 'true';
  const notificaciones = await Notificacion.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(200, Math.max(1, parseInt(limit, 10) || 50)),
  });
  const noLeidas = await Notificacion.count({ where: { usuario_id, leida: false } });
  res.json({ data: notificaciones, no_leidas: noLeidas });
};

exports.marcarNotificacionLeida = async (req, res) => {
  const usuario_id = req.usuario.id;
  const notificacion = await Notificacion.findOne({ where: { id: req.params.id, usuario_id } });
  if (!notificacion) return res.status(404).json({ error: 'Notificación no encontrada' });
  await notificacion.update({ leida: true, leida_en: new Date() });
  res.json(notificacion);
};

exports.marcarTodasLeidas = async (req, res) => {
  const usuario_id = req.usuario.id;
  await Notificacion.update({ leida: true, leida_en: new Date() }, { where: { usuario_id, leida: false } });
  res.status(204).send();
};
