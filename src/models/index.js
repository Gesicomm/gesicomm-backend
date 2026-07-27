const sequelize = require('../config/database');
const Inquilino = require('./Inquilino');
const Rol = require('./Rol');
const Usuario = require('./Usuario');

// Definir relaciones
Inquilino.hasMany(Usuario, { foreignKey: 'inquilino_id' });
Usuario.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Rol.hasMany(Usuario, { foreignKey: 'rol_id' });
Usuario.belongsTo(Rol, { foreignKey: 'rol_id' });

module.exports = {
  sequelize,
  Inquilino,
  Rol,
  Usuario,
};
