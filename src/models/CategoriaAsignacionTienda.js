const { DataTypes } = require('sequelize');
const db = require('../config/database');
module.exports = db.define('CategoriaAsignacionTienda', {
  id: { type:DataTypes.INTEGER, autoIncrement:true, primaryKey:true },
  tienda_id: { type:DataTypes.INTEGER, allowNull:false },
  tipo: { type:DataTypes.STRING(20), allowNull:false },
  referencia_id: { type:DataTypes.INTEGER, allowNull:false },
  categoria_id: { type:DataTypes.INTEGER, allowNull:false },
}, { tableName:'categoria_asignaciones_tienda', timestamps:false,
  indexes:[{unique:true,fields:['tienda_id','tipo','referencia_id']}] });
