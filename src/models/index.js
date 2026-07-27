const sequelize = require('../config/database');
const Inquilino = require('./Inquilino');
const Rol = require('./Rol');
const Permiso = require('./Permiso');
const RolPermiso = require('./RolPermiso');
const Usuario = require('./Usuario');
const MetaIntegration = require('./MetaIntegration');

// Definir relaciones
Inquilino.hasMany(Usuario, { foreignKey: 'inquilino_id' });
Usuario.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Inquilino.hasOne(MetaIntegration, { foreignKey: 'inquilino_id' });
MetaIntegration.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Rol.hasMany(Usuario, { foreignKey: 'rol_id' });
Usuario.belongsTo(Rol, { foreignKey: 'rol_id' });

Rol.belongsToMany(Permiso, { through: RolPermiso, foreignKey: 'rol_id' });
Permiso.belongsToMany(Rol, { through: RolPermiso, foreignKey: 'permiso_id' });

module.exports = {
  sequelize,
  Inquilino,
  Rol,
  Permiso,
  RolPermiso,
  Usuario,
  MetaIntegration,
};
