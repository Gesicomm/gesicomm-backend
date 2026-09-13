const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Catálogo de planes de Gesicomm — lo que un comercio contrata para usar el
 * sistema. No confundir con las pasarelas de los comercios: esto es lo que
 * Gesicomm le cobra a SUS clientes.
 *
 * Reemplaza al catálogo que hasta ahora vivía en el frontend
 * (lib/planesCatalogo.js, con la edición del admin guardada en localStorage).
 *
 * `equivale_plan` mapea a Usuario.plan, que hoy es ENUM('free','pago'): el
 * catálogo puede tener N planes comerciales, pero el sistema sigue conociendo
 * solo esos dos niveles de acceso. Se deja explícito en vez de inferirlo del
 * precio para que agregar un plan no cambie permisos sin querer.
 */
const Plan = sequelize.define('Plan', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  codigo: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'Identificador estable para referenciarlo desde código y URLs (ej: "pro").',
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  resumen: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  precio: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Precio en guaraníes, sin decimales (PYG no los usa).',
  },
  moneda: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'PYG',
    validate: { isIn: [['PYG', 'USD']] },
    comment: 'Moneda visible y operativa del plan. PagoPar cobra en PYG; USD queda solo para planes dolarizados explícitos.',
  },
  periodicidad: {
    type: DataTypes.ENUM('mensual', 'anual', 'unico'),
    allowNull: false,
    defaultValue: 'mensual',
  },
  equivale_plan: {
    type: DataTypes.ENUM('free', 'pago'),
    allowNull: false,
    defaultValue: 'pago',
    comment: 'Nivel de acceso que otorga, en los términos que entiende Usuario.plan.',
  },
  features: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [],
    comment: 'Array de strings: las líneas de "qué incluye" que se muestran en /planes.',
  },
  etiqueta: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Cinta sobre la tarjeta (ej: "El más elegido"). Vacío = sin cinta.',
  },
  cta: {
    type: DataTypes.STRING(80),
    allowNull: true,
    comment: 'Texto del botón en la pantalla de planes.',
  },
  destacado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Orden de aparición en /planes, de menor a mayor.',
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'false = no se ofrece más, pero las suscripciones existentes lo siguen referenciando.',
  },
}, {
  tableName: 'planes',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Plan;
