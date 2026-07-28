const sequelize = require('../config/database');
const Inquilino = require('./Inquilino');
const Rol = require('./Rol');
const Permiso = require('./Permiso');
const RolPermiso = require('./RolPermiso');
const Usuario = require('./Usuario');
const MetaIntegration = require('./MetaIntegration');
const Categoria = require('./Categoria');
const Marca = require('./Marca');
const Producto = require('./Producto');
const ProductoVariante = require('./ProductoVariante');
const ProductoImagen = require('./ProductoImagen');
const PrecioMayorista = require('./PrecioMayorista');
const ProductoRelacionado = require('./ProductoRelacionado');
const HistorialPrecio = require('./HistorialPrecio');

// ============================================================
// Relaciones existentes
// ============================================================
Inquilino.hasMany(Usuario, { foreignKey: 'inquilino_id' });
Usuario.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Inquilino.hasOne(MetaIntegration, { foreignKey: 'inquilino_id' });
MetaIntegration.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Rol.hasMany(Usuario, { foreignKey: 'rol_id' });
Usuario.belongsTo(Rol, { foreignKey: 'rol_id' });

Rol.belongsToMany(Permiso, { through: RolPermiso, foreignKey: 'rol_id' });
Permiso.belongsToMany(Rol, { through: RolPermiso, foreignKey: 'permiso_id' });

// ============================================================
// Relaciones de Categoría
// ============================================================
Inquilino.hasMany(Categoria, { foreignKey: 'inquilino_id' });
Categoria.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

// Auto-referencia para jerarquía (parent_id)
Categoria.hasMany(Categoria, { as: 'subcategorias', foreignKey: 'parent_id' });
Categoria.belongsTo(Categoria, { as: 'padre', foreignKey: 'parent_id' });

// ============================================================
// Relaciones de Marca
// ============================================================
Inquilino.hasMany(Marca, { foreignKey: 'inquilino_id' });
Marca.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

// ============================================================
// Relaciones de Producto
// ============================================================
Inquilino.hasMany(Producto, { foreignKey: 'inquilino_id' });
Producto.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Categoria.hasMany(Producto, { foreignKey: 'categoria_id' });
Producto.belongsTo(Categoria, { foreignKey: 'categoria_id' });

Marca.hasMany(Producto, { foreignKey: 'marca_id' });
Producto.belongsTo(Marca, { foreignKey: 'marca_id' });

// Auditoría: quién creó/modificó
Usuario.hasMany(Producto, { as: 'ProductosCreados', foreignKey: 'creado_por' });
Producto.belongsTo(Usuario, { as: 'Creador', foreignKey: 'creado_por' });
Usuario.hasMany(Producto, { as: 'ProductosModificados', foreignKey: 'modificado_por' });
Producto.belongsTo(Usuario, { as: 'Modificador', foreignKey: 'modificado_por' });

// ============================================================
// Relaciones de tablas hijas de Producto
// ============================================================

// Variantes
Producto.hasMany(ProductoVariante, { as: 'variantes', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoVariante.belongsTo(Producto, { foreignKey: 'producto_id' });

// Imágenes (pueden asociarse a producto o a variante específica)
Producto.hasMany(ProductoImagen, { as: 'imagenes', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoImagen.belongsTo(Producto, { foreignKey: 'producto_id' });
ProductoVariante.hasMany(ProductoImagen, { as: 'imagenes', foreignKey: 'variante_id' });
ProductoImagen.belongsTo(ProductoVariante, { foreignKey: 'variante_id' });

// Precios mayoristas
Producto.hasMany(PrecioMayorista, { as: 'precios_mayoristas', foreignKey: 'producto_id', onDelete: 'CASCADE' });
PrecioMayorista.belongsTo(Producto, { foreignKey: 'producto_id' });

// Productos relacionados (relación muchos-a-muchos auto-referencial)
Producto.hasMany(ProductoRelacionado, { as: 'relaciones', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoRelacionado.belongsTo(Producto, { as: 'ProductoBase', foreignKey: 'producto_id' });
ProductoRelacionado.belongsTo(Producto, { as: 'ProductoVinculado', foreignKey: 'producto_relacionado_id' });

// Historial de precios
Producto.hasMany(HistorialPrecio, { as: 'historial_precios', foreignKey: 'producto_id' });
HistorialPrecio.belongsTo(Producto, { foreignKey: 'producto_id' });
Usuario.hasMany(HistorialPrecio, { foreignKey: 'usuario_id' });
HistorialPrecio.belongsTo(Usuario, { foreignKey: 'usuario_id' });

module.exports = {
  sequelize,
  Inquilino,
  Rol,
  Permiso,
  RolPermiso,
  Usuario,
  MetaIntegration,
  Categoria,
  Marca,
  Producto,
  ProductoVariante,
  ProductoImagen,
  PrecioMayorista,
  ProductoRelacionado,
  HistorialPrecio,
};
