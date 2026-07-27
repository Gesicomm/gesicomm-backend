const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Inquilino = sequelize.define('Inquilino', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  tableName: 'inquilinos',
  timestamps: true, // Automáticamente maneja createdAt y updatedAt
});

module.exports = Inquilino;
