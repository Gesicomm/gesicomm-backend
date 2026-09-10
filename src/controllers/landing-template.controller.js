'use strict';

const { Op } = require('sequelize');
const { LandingTemplate } = require('../models');

/**
 * Listar templates disponibles para que el comercio elija.
 */
exports.listar = async (req, res, next) => {
  try {
    // El lienzo en blanco (kind='codigo') nunca se elige de una grilla:
    // se crea por POST /mis-landings-simples/lienzo-blanco y su template
    // se resuelve por slug en el backend. Excluirlo acá evita que aparezca
    // como una opción más en los selectores que listan "todo".
    const where = { status: 'published', kind: { [Op.notIn]: ['codigo', 'funnel'] } };
    // ?kind=rigido → los 4 templates fijos (Fitness/Beauty/Tech/Básico)
    // para el selector nuevo. Sin query param devuelve el resto, igual que
    // antes.
    if (req.query?.kind === 'rigido' || req.query?.kind === 'flexible') {
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
