'use strict';

const { LandingTemplate } = require('../models');

/**
 * Listar templates (funnels) disponibles para que el comercio elija.
 */
exports.listar = async (req, res, next) => {
  try {
    const where = { status: 'published' };
    // ?kind=rigido → los 3 templates fijos (Fitness/Beauty/Tech) para el
    // selector nuevo. Sin query param devuelve todo, igual que antes.
    if (req.query.kind === 'rigido' || req.query.kind === 'flexible') {
      where.kind = req.query.kind;
    }
    const templates = await LandingTemplate.findAll({
      where,
      order: [['id', 'ASC']]
    });

    res.json(templates);
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener detalle de un template.
 */
exports.detalle = async (req, res, next) => {
  try {
    const template = await LandingTemplate.findByPk(req.params.id);
    if (!template) {
      return res.status(404).json({ message: 'Template no encontrado.' });
    }
    res.json(template);
  } catch (error) {
    next(error);
  }
};
