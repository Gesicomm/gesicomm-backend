const sequelize = require('../config/database');
const Inquilino = require('./Inquilino');
const Usuario = require('./Usuario');

// Definir relaciones
Inquilino.hasMany(Usuario, { foreignKey: 'inquilino_id' });
Usuario.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

module.exports = {
  sequelize,
  Inquilino,
  Usuario,
};
