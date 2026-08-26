const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LandingTemplate = sequelize.define('LandingTemplate', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  funnel_type: {
    type: DataTypes.ENUM('direct_sale', 'educational', 'lifestyle'),
    allowNull: false,
    defaultValue: 'direct_sale',
  },
  kind: {
    // VARCHAR + validación en la app, no ENUM de Postgres — mismo criterio
    // que Landing.tipo_pagina (ver scripts/migrate-landing-tipo-pagina.js):
    // este proyecto evita crear tipos ENUM a mano en migraciones puntuales.
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'flexible',
    validate: { isIn: [['flexible', 'rigido', 'funnel', 'codigo']] },
    comment: '"rigido" = uno de los templates fijos de LANDING de tienda (Fitness/Beauty/Tech/Básico): estructura hardcodeada en el frontend, el comercio solo edita contenido. "funnel" = embudo de un solo producto (ver funnel.service.js), también rígido pero módulo aparte — nunca aparece en el selector de landing y viceversa. "codigo" = lienzo en blanco: no hay estructura, el comercio escribe el HTML/CSS/JS de la landing a mano (ver landingCodigo.service.js). "flexible" = sistema de constructor (LandingSeccion), DEPRECADO.',
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  status: {
    type: DataTypes.ENUM('draft', 'published', 'archived'),
    allowNull: false,
    defaultValue: 'draft',
  },
  preview_image: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  schema: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [], // Array de definiciones de secciones
  },
  design_tokens: {
    type: DataTypes.JSON,
    allowNull: true, // Colores base, tipografía, etc.
  }
}, {
  tableName: 'landing_templates',
  timestamps: true,
});

module.exports = LandingTemplate;
