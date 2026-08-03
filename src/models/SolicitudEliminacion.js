const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Solicitud de eliminación de datos personales.
 *
 * Existe para cumplir tres requisitos a la vez:
 *  - El "Data Deletion Instructions URL" que exige Meta para cualquier app
 *    que use Facebook Login / Instagram / WhatsApp Cloud API: la web pública
 *    (/data-deletion) postea acá sin autenticación.
 *  - El "Data Deletion Callback" de Meta: cuando un usuario desvincula la app
 *    desde su configuración de Facebook, Meta hace POST con un signed_request
 *    y espera de vuelta {url, confirmation_code}. Ese confirmation_code es el
 *    campo `codigo`, y la url apunta a /data-deletion/estado/<codigo>.
 *  - El derecho de supresión de GDPR (art. 17) y de borrado de CCPA/CPRA, que
 *    exigen poder demostrar cuándo se recibió el pedido y cuándo se resolvió.
 *
 * `codigo` es la única referencia que se expone públicamente: la página de
 * estado se consulta solo con él, así que es aleatorio y no adivinable, y la
 * consulta pública devuelve estado y fechas — nunca el email ni el motivo.
 */
const SolicitudEliminacion = sequelize.define('SolicitudEliminacion', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  codigo: {
    type: DataTypes.STRING(32),
    allowNull: false,
    comment: 'Código de confirmación público. Es el confirmation_code que se devuelve a Meta.',
  },
  origen: {
    type: DataTypes.ENUM('formulario_publico', 'meta_callback', 'panel_usuario'),
    allowNull: false,
    defaultValue: 'formulario_publico',
  },
  estado: {
    type: DataTypes.ENUM('recibida', 'verificando_identidad', 'en_proceso', 'completada', 'rechazada'),
    allowNull: false,
    defaultValue: 'recibida',
  },
  nombre: {
    type: DataTypes.STRING(150),
    allowNull: true,
    comment: 'Nulo en solicitudes que llegan por el callback de Meta: ahí solo viene el user id.',
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  empresa: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  motivo: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  meta_user_id: {
    type: DataTypes.STRING(64),
    allowNull: true,
    comment: 'user_id del signed_request de Meta. Permite localizar la MetaIntegration asociada.',
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Se completa al verificar la identidad y encontrar la cuenta correspondiente.',
  },
  inquilino_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  ip_solicitante: {
    type: DataTypes.STRING(45),
    allowNull: true,
    comment: 'IPv4 o IPv6. Se conserva como evidencia de la solicitud y se borra al completarla.',
  },
  user_agent: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  fecha_limite: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Recepción + 30 días. Es el plazo comprometido públicamente en /data-deletion.',
  },
  procesada_en: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  notas_internas: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Solo para el equipo. Nunca se expone en la consulta pública de estado.',
  },
}, {
  tableName: 'solicitudes_eliminacion',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['codigo'] },
    { fields: ['estado'] },
    { fields: ['email'] },
    { fields: ['meta_user_id'] },
  ],
});

module.exports = SolicitudEliminacion;
