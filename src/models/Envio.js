const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Envio = sequelize.define('Envio', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  fecha: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  hora: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  confirmador: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  cliente: {
    type: DataTypes.STRING(255),
    allowNull: false,
    defaultValue: 'Cliente',
  },
  nombre_cliente: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  apellido_cliente: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  telefono: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  departamento: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  ciudad: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  direccion: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  referencia: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  link_maps: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  monto: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  costo_envio: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  metodo_pago: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Efectivo',
  },
  observaciones: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  estado: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Pendiente',
  },
  dispatchedAt: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  fecha_rendicion: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  // --- Atribución comercial y canales (Escalabilidad ERP) ---
  origen: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'WEB',
  },
  campaign_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  campaign_id: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  adset: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  ad: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  utm_source: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  utm_medium: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  utm_campaign: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  // --- Estados disociados: Comercial (Confirmador) vs Logístico (Courier) ---
  estado_comercial: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Confirmado',
  },
  estado_logistico: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: 'Pendiente',
  },
  // --- Checkout público (landing) ---
  ruc: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'RUC opcional para factura virtual — contexto Paraguay.',
  },
  // --- Facturación del pedido ---
  quiere_factura: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  razon_social: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  nro_comprobante: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Único por usuario cuando está presente (ver índice parcial en migrar-metodos-pago-y-factura.js).',
  },
  // --- Método de pago (ABM) ---
  metodo_pago_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  comision_pct_aplicada: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
    comment: 'Snapshot del % de comisión del método de pago vigente al crear el pedido, para no alterar reportes históricos si luego se edita el ABM.',
  },
  stock_descontado: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'Guarda de idempotencia: el stock se descuenta una sola vez, al pasar a Confirmado (ver envioController.updateEstado), sin importar cuántas veces el pedido pase por ese estado.',
  },
}, {
  tableName: 'envios',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Envio;
