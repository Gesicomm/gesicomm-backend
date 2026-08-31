const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Funnel del Page Builder: una SECUENCIA ORDENADA DE PÁGINAS de código.
 *
 * ⚠️ No es lo mismo que Funnel.js. Ese es el embudo de UN producto sobre
 * la tabla `landings` (tipo_pagina='funnel'), con estructura rígida en
 * React donde el comercio solo edita contenido. Este es un flujo de
 * páginas HTML/CSS/JS arbitrarias:
 *
 *   Landing → Oferta → Checkout → Gracias
 *
 * URL pública: /f/<slug>/<pagina-slug> en el host propio del builder.
 * `/f/<slug>` sin página lleva a la página de entrada del funnel.
 *
 * El ORDEN de las páginas NO vive acá ni en BuilderPage: vive en
 * BuilderFunnelPage, que es su única fuente de verdad.
 *
 * Sin tienda de por medio no hay hostname que aísle un espacio de nombres
 * de otro, así que `slug` es ÚNICO GLOBAL. Los slugs se generan con
 * sufijo aleatorio, así que en la práctica no chocan; el que elige uno a
 * mano tiene que agarrar uno libre.
 *
 * usuario_id/inquilino_id están desnormalizados (los hereda del proyecto)
 * para poder filtrar sin JOIN con builder_projects. Mismo criterio que
 * LandingItem respecto de Landing.
 */
const BuilderFunnel = sequelize.define('BuilderFunnel', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  proyecto_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'El dueño. Filtro de toda consulta del módulo.',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
    comment: 'Nombre interno, no necesariamente el título público.',
  },
  slug: {
    type: DataTypes.STRING(120),
    allowNull: false,
    comment: 'Único GLOBAL: resuelve el primer segmento del path público, /f/<slug>.',
    validate: { is: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/ },
  },
  descripcion: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(15),
    allowNull: false,
    defaultValue: 'draft',
    validate: { isIn: [['draft', 'published', 'unpublished']] },
    comment: 'published = al menos una de sus páginas está publicada.',
  },
}, {
  tableName: 'builder_funnels',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['slug'] },
    { fields: ['proyecto_id'] },
    { fields: ['usuario_id'] },
  ],
});

module.exports = BuilderFunnel;
