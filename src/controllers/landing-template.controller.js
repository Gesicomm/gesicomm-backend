'use strict';

const { LandingTemplate } = require('../models');

/**
 * Listar templates (funnels) disponibles para que el comercio elija.
 */
exports.listar = async (req, res, next) => {
  try {
    const templates = await LandingTemplate.findAll({
      where: { status: 'published' },
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
