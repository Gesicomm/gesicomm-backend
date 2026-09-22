const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/** Capacidades operativas de un proveedor. Espejo del CHECK de la migración. */
const CAPACIDADES = [
  'RETIRO_EN_PROVEEDOR',
  'CROSS_DOCKING',
  'ALMACENAMIENTO',
  'TRASLADO_ENTRE_CENTROS',
  // Llevar mercadería al depósito de un comercio no es lo mismo que moverla
  // entre centros de Gesicomm ni que entregarla al comprador final: son tres
  // destinos distintos y cada uno se contrata por separado.
  'ENTREGA_A_DEPOSITO_COMERCIO',
  'ULTIMA_MILLA',
];

const TIPOS = ['TRANSPORTADORA', 'OPERADOR_ULTIMA_MILLA', 'FLOTA_PROPIA'];

/**
 * Operador de la red logística de Gesicomm.
 *
 * No es un courier: un courier pertenece a un comercio y entrega los pedidos
 * de ese comercio. Un proveedor logístico mueve mercadería dentro de la red y
 * por eso no tiene `usuario_id`.
 */
const ProveedorLogistico = sequelize.define('ProveedorLogistico', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  tipo: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'TRANSPORTADORA',
    validate: { isIn: [TIPOS] },
  },
  contacto: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  telefono: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  // El CHECK de Postgres garantiza que no entre una capacidad inventada, pero
  // acepta repetidos: `<@` es subconjunto, no igualdad de multiconjuntos. La
  // deduplicación es responsabilidad de la aplicación.
  capacidades: {
    type: DataTypes.ARRAY(DataTypes.TEXT),
    allowNull: false,
    defaultValue: [],
    validate: {
      soloConocidas(valor) {
        const lista = Array.isArray(valor) ? valor : [];
        const desconocida = lista.find((c) => !CAPACIDADES.includes(c));
        if (desconocida) throw new Error(`Capacidad desconocida: "${desconocida}".`);
      },
    },
  },
  activo: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'proveedores_logisticos',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

ProveedorLogistico.CAPACIDADES = CAPACIDADES;
ProveedorLogistico.TIPOS = TIPOS;

module.exports = ProveedorLogistico;
