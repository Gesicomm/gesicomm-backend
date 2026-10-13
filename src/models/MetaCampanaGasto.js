const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Gasto de una campaña interna en un rango de fechas, cargado a mano.
 *
 * Reemplaza a la importación de CSV de Meta Ads Manager como forma de
 * registrar la inversión: el usuario crea la campaña, y cada tanto anota
 * "del día X al día Y gasté tanto". Una campaña acumula varios registros
 * y su gasto total es la suma de todos.
 *
 * Los rangos de una misma campaña no se pisan entre sí (lo valida el
 * service): si se pudieran solapar, la misma plata se contaría dos veces
 * en el total de la campaña y en la línea "Meta (ads)" del dashboard.
 *
 * `monto` se guarda tal cual lo tipeó el usuario, en guaraníes. No se le
 * aplica el multiplicador de IVA que sí llevan las filas importadas (ver
 * MetaReportesService.MULTIPLICADOR_IVA): acá el usuario declara lo que
 * gastó, no se parte de un export que viene sin IVA.
 */
const MetaCampanaGasto = sequelize.define('MetaCampanaGasto', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  meta_campana_interna_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  fecha_desde: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  fecha_hasta: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Inclusive: un gasto de un solo día tiene fecha_desde = fecha_hasta.',
  },
  monto: {
    type: DataTypes.DECIMAL(14, 2),
    allowNull: false,
    comment: 'Guaraníes gastados en el rango, tal cual los cargó el usuario.',
  },
  nota: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'meta_campana_gastos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['meta_campana_interna_id', 'fecha_desde'] },
    { fields: ['usuario_id', 'fecha_desde', 'fecha_hasta'] },
  ],
});

module.exports = MetaCampanaGasto;
