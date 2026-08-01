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
const ProductoCombo = require('./ProductoCombo');
const ProductoComboItem = require('./ProductoComboItem');
const ProductoRelacionado = require('./ProductoRelacionado');
const HistorialPrecio = require('./HistorialPrecio');
const ComboConfiguracion = require('./ComboConfiguracion');
const Courier = require('./Courier');
const CourierTarifa = require('./CourierTarifa');
const Envio = require('./Envio');
const EnvioItem = require('./EnvioItem');
const PrecioUsuario = require('./PrecioUsuario');
const Tienda = require('./Tienda');
const Landing = require('./Landing');
const LandingItem = require('./LandingItem');
const LandingEvento = require('./LandingEvento');

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
// Relaciones de Logística (Courier y Envíos)
// ============================================================
Usuario.hasMany(Courier, { foreignKey: 'usuario_id' });
Courier.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Courier.hasMany(CourierTarifa, { as: 'tarifas', foreignKey: 'courier_id', onDelete: 'CASCADE' });
CourierTarifa.belongsTo(Courier, { foreignKey: 'courier_id' });

Usuario.hasMany(Envio, { foreignKey: 'usuario_id' });
Envio.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Courier.hasMany(Envio, { foreignKey: 'courier_id' });
Envio.belongsTo(Courier, { foreignKey: 'courier_id' });

Envio.hasMany(EnvioItem, { as: 'items', foreignKey: 'envio_id', onDelete: 'CASCADE' });
EnvioItem.belongsTo(Envio, { foreignKey: 'envio_id' });
EnvioItem.belongsTo(Producto, { foreignKey: 'producto_id' });

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
Producto.belongsTo(Categoria, { as: 'categoria', foreignKey: 'categoria_id' });

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

// Combos (Multi-producto)
Inquilino.hasMany(ProductoCombo, { foreignKey: 'inquilino_id' });
ProductoCombo.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

Producto.hasMany(ProductoCombo, { as: 'combos', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoCombo.belongsTo(Producto, { as: 'producto_padre', foreignKey: 'producto_id' });

ProductoCombo.hasMany(ProductoComboItem, { as: 'items', foreignKey: 'combo_id', onDelete: 'CASCADE' });
ProductoComboItem.belongsTo(ProductoCombo, { foreignKey: 'combo_id' });

Producto.hasMany(ProductoComboItem, { as: 'como_item_de_combo', foreignKey: 'producto_incluido_id', onDelete: 'CASCADE' });
ProductoComboItem.belongsTo(Producto, { as: 'producto_incluido', foreignKey: 'producto_incluido_id' });

// Configuración económica de combos por tenant
Inquilino.hasOne(ComboConfiguracion, { foreignKey: 'inquilino_id' });
ComboConfiguracion.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });

// Productos relacionados (relación muchos-a-muchos auto-referencial)
Producto.hasMany(ProductoRelacionado, { as: 'relaciones', foreignKey: 'producto_id', onDelete: 'CASCADE' });
ProductoRelacionado.belongsTo(Producto, { as: 'ProductoBase', foreignKey: 'producto_id' });
ProductoRelacionado.belongsTo(Producto, { as: 'ProductoVinculado', foreignKey: 'producto_relacionado_id' });

// Historial de precios
Producto.hasMany(HistorialPrecio, { as: 'historial_precios', foreignKey: 'producto_id' });
HistorialPrecio.belongsTo(Producto, { foreignKey: 'producto_id' });
Usuario.hasMany(HistorialPrecio, { foreignKey: 'usuario_id' });
HistorialPrecio.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Precios propios por usuario (vitrina / landing)
Usuario.hasMany(PrecioUsuario, { as: 'precios_personalizados', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
PrecioUsuario.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Tienda: 1:1 con Usuario, dueña de las landings públicas
Usuario.hasOne(Tienda, { foreignKey: 'usuario_id', onDelete: 'CASCADE' });
Tienda.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Tienda.hasMany(Landing, { as: 'landings', foreignKey: 'tienda_id', onDelete: 'CASCADE' });
Landing.belongsTo(Tienda, { foreignKey: 'tienda_id' });

Landing.hasMany(LandingItem, { as: 'items', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingItem.belongsTo(Landing, { foreignKey: 'landing_id' });

Landing.hasMany(LandingEvento, { as: 'eventos', foreignKey: 'landing_id', onDelete: 'CASCADE' });
LandingEvento.belongsTo(Landing, { foreignKey: 'landing_id' });

// ============================================================
// Relaciones de Educación / Academia
// ============================================================
const ModuloEducacion = require('./ModuloEducacion');
const Examen = require('./Examen');
const PreguntaExamen = require('./PreguntaExamen');
const ProgresoUsuarioModulo = require('./ProgresoUsuarioModulo');

ModuloEducacion.belongsTo(Inquilino, { foreignKey: 'inquilino_id' });
Inquilino.hasMany(ModuloEducacion, { as: 'modulosEducacion', foreignKey: 'inquilino_id' });

ModuloEducacion.hasOne(Examen, { as: 'examen', foreignKey: 'modulo_id', onDelete: 'CASCADE' });
Examen.belongsTo(ModuloEducacion, { foreignKey: 'modulo_id' });

Examen.hasMany(PreguntaExamen, { as: 'preguntas', foreignKey: 'examen_id', onDelete: 'CASCADE' });
PreguntaExamen.belongsTo(Examen, { foreignKey: 'examen_id' });

Usuario.hasMany(ProgresoUsuarioModulo, { as: 'progresosEducacion', foreignKey: 'usuario_id', onDelete: 'CASCADE' });
ProgresoUsuarioModulo.belongsTo(Usuario, { foreignKey: 'usuario_id' });

ModuloEducacion.hasMany(ProgresoUsuarioModulo, { as: 'progresos', foreignKey: 'modulo_id', onDelete: 'CASCADE' });
ProgresoUsuarioModulo.belongsTo(ModuloEducacion, { foreignKey: 'modulo_id' });

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
  ProductoCombo,
  ProductoComboItem,
  ProductoRelacionado,
  HistorialPrecio,
  ComboConfiguracion,
  Courier,
  CourierTarifa,
  Envio,
  EnvioItem,
  PrecioUsuario,
  Tienda,
  Landing,
  LandingItem,
  LandingEvento,
  ModuloEducacion,
  Examen,
  PreguntaExamen,
  ProgresoUsuarioModulo,
};
