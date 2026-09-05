const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Un viaje del courier a la dirección del cliente. UNA FILA POR VIAJE.
 *
 * Existe porque `Envio.costo_envio` es un solo número y no alcanza para el
 * caso real: el courier va, el cliente no atiende, vuelve, y al día siguiente
 * va de nuevo. Se pagan dos viajes. Antes de esta tabla el sistema registraba
 * uno solo, y el segundo desaparecía del costo y de la rendición.
 *
 * `Envio.costo_envio` sigue siendo la fuente de verdad del TOTAL —es lo que
 * leen el dashboard y la rendición, y no hubo que tocar ninguno de los dos—;
 * acá vive el DESGLOSE de cómo se llegó a ese total. La suma de `costo` de
 * los intentos de un pedido debería dar su `costo_envio`.
 *
 * Se escribe sola, en las transiciones de estado (ver envioController): nadie
 * la carga a mano. Guarda motivo, courier y fecha de cada viaje para poder
 * responder después "qué zona me genera más viajes en falso" o "qué courier
 * no encuentra a los clientes", sin tener que reconstruirlo del historial.
 */
const EnvioIntentoEntrega = sequelize.define('EnvioIntentoEntrega', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  envio_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  // Quién hizo ESTE viaje. Puede cambiar entre intentos del mismo pedido, y
  // por eso se guarda acá y no se lee del pedido: si el segundo intento lo
  // hizo otro courier, el reporte tiene que poder decirlo.
  courier_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  numero: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Orden del viaje dentro del pedido: 1, 2, 3…',
  },
  resultado: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: '"entregado" si el viaje terminó en entrega; "reprogramado" si volvió sin entregar.',
  },
  // Se permite 0 a propósito: hay casos donde el segundo viaje no se cobra
  // (el courier lo absorbe, ya estaba incluido, acuerdo puntual). Cero es un
  // dato válido y distinto de "no lo sabemos".
  costo: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  motivo: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  fecha_reprogramada: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Para qué día quedó agendado el siguiente viaje (solo en los reprogramados).',
  },
  fecha: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Día del viaje, en zona horaria de Paraguay.',
  },
}, {
  tableName: 'envio_intentos_entrega',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['envio_id'] },
    // Para la reportería por courier y período que motivó la tabla.
    { fields: ['courier_id', 'fecha'] },
  ],
});

module.exports = EnvioIntentoEntrega;
