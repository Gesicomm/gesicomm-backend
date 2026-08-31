const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Un paso de un funnel del Page Builder: qué página, en qué orden, y si es
 * la de entrada.
 *
 *   ① Landing → ② Oferta → ③ Checkout → ④ Gracias
 *
 * Esta tabla es la ÚNICA fuente de verdad del orden. BuilderPage no tiene
 * `posicion` ni `es_entrada` justamente para que no haya dos lugares donde
 * el orden pueda quedar distinto.
 *
 * Garantías que están en la base (ver la migración), no solo en el código:
 *  - UNIQUE (pagina_id): una página pertenece a UN solo funnel. Es lo
 *    único que hay que quitar el día que se quiera reutilizar una misma
 *    página en varios funnels.
 *  - UNIQUE (funnel_id, posicion) DEFERRABLE: no hay dos pasos en la misma
 *    posición, pero se puede reindexar 1..N dentro de una transacción sin
 *    pasar por estados intermedios inválidos.
 *  - Índice parcial UNIQUE (funnel_id) WHERE es_entrada: una sola página
 *    de entrada por funnel, garantizado por Postgres.
 *  - FK compuesta (pagina_id, funnel_id) → builder_pages (id, funnel_id):
 *    impide que el funnel de este paso y el funnel_id de la página
 *    diverjan. Sin ON UPDATE CASCADE a propósito: sacar una página de un
 *    funnel es borrar el paso primero y recién después poner su funnel_id
 *    en NULL, no al revés.
 */
const BuilderFunnelPage = sequelize.define('BuilderFunnelPage', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  funnel_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  pagina_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  posicion: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1 },
    comment: '1..N sin huecos. Reordenar manda el array completo de ids y el service reindexa dentro de una transacción.',
  },
  es_entrada: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'A dónde lleva /f/<funnel-slug> sin página. Única por funnel.',
  },
}, {
  tableName: 'builder_funnel_pages',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  // La UNIQUE deferrable de (funnel_id, posicion) y el índice parcial de
  // es_entrada no se pueden expresar acá: viven solo en la migración.
  indexes: [
    { unique: true, fields: ['pagina_id'] },
    { fields: ['funnel_id'] },
  ],
});

module.exports = BuilderFunnelPage;
