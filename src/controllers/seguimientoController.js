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
  const { nombre, etiqueta_id, activo } = req.body;
  const mensaje = req.body.mensaje || req.body.mensaje_template;
  let codigo = req.body.codigo;
  if (!nombre || !mensaje) {
    return res.status(400).json({ error: 'nombre y mensaje son obligatorios' });
  }
  if (!codigo) {
    codigo = nombre.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Math.floor(Math.random()*1000);
  }
  try {
    const plantilla = await WhatsappPlantilla.create({
      usuario_id, nombre, codigo, mensaje, etiqueta_id: etiqueta_id || null, activo: activo !== undefined ? activo : true,
    });
    res.status(201).json(plantilla);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: `Ya existe una plantilla con el cdigo "${codigo}"` });
    }
    res.status(500).json({ error: 'Error al crear la plantilla' });
  }
};

exports.editarPlantilla = async (req, res) => {
  const usuario_id = req.usuario.id;
  const { nombre, codigo, etiqueta_id, activo } = req.body;
  const mensaje = req.body.mensaje || req.body.mensaje_template;
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
      return res.status(409).json({ error: `Ya existe una plantilla con el cdigo "${codigo}"` });
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
  const { nombre, activo, color } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  let codigo = req.body.codigo;
  if (!codigo) {
    codigo = nombre.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Math.floor(Math.random()*1000);
  }
  try {
    const etiqueta = await SeguimientoEtiqueta.create({ usuario_id, nombre, codigo, color, activo: activo !== undefined ? activo : true });
    res.status(201).json(etiqueta);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: `Ya existe una etiqueta con el cdigo "${codigo}"` });
    }
    console.error('Error en crearEtiqueta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.editarEtiqueta = async (req, res) => {
  const { id } = req.params;
  const { nombre, codigo, activo, color } = req.body;
  try {
    const etiqueta = await SeguimientoEtiqueta.findOne({ where: { id, usuario_id: req.usuario.id } });
    if (!etiqueta) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    
    if (nombre) etiqueta.nombre = nombre;
    if (codigo) etiqueta.codigo = codigo;
    if (activo !== undefined) etiqueta.activo = activo;
    if (color) etiqueta.color = color;
    
    await etiqueta.save();
    res.json(etiqueta);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: `Ya existe una etiqueta con el cdigo "${codigo}"` });
    }
    console.error('Error en editarEtiqueta:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
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
  
  // Incluir conteo de seguimientos vencidos para el badge de la sidebar
  const { SeguimientoRecordatorio } = require('../models');
  const seguimientosVencidos = await SeguimientoRecordatorio.count({
    where: { usuario_id, estado: 'VENCIDO' }
  });
  
  res.json({ data: notificaciones, no_leidas: noLeidas, seguimientos_vencidos: seguimientosVencidos });
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
