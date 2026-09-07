const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Item (producto o combo) incluido en una Landing, con la agrupación
 * propia que el usuario le puso para ESA landing (no depende de la
 * categoría/marca del catálogo del admin).
 */
const LandingItem = sequelize.define('LandingItem', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  landing_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  tipo: {
    type: DataTypes.ENUM('producto', 'combo'),
    allowNull: false,
  },
  referencia_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'FK a Producto.id o ProductoCombo.id según "tipo".',
  },
  etiqueta: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Agrupación propia del usuario dentro de esta landing (ej: "Ofertas").',
  },
  precio_ancla: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Precio tachado / ancla configurado por el usuario para este item en esta landing.',
  },
  envio_incluido: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Si true, este item se vende con delivery incluido en esta landing.',
  },
  orden: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  mostrar_en_inicio: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: 'Solo aplica a landings rígidas: si aparece en "Productos destacados" del home. Siempre aparece en la página de Catálogo completo (/catalogo) sin importar este valor — esa página muestra todos los items de la landing.',
  },
}, {
  tableName: 'landing_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['landing_id', 'tipo', 'referencia_id'] },
    { fields: ['landing_id'] },
  ],
});

module.exports = LandingItem;
