'use strict';

/**
 * Hasta ahora un Envio solo podia guardar `courier_id`, que pertenece a la
 * red de delivery de un comercio (Courier.usuario_id). Para los pedidos que
 * Gesicomm prepara y despacha desde su propia red logistica (ver
 * envio_item_componentes.origen_centro_id) el operador que hace la entrega
 * es un ProveedorLogistico (proveedores_logisticos), que es una entidad
 * distinta: no tiene usuario_id, no pertenece a ningun comercio.
 *
 * Nullable, sin tocar filas existentes: un pedido puede seguir usando solo
 * courier_id (comercio con logistica propia) o solo proveedor_logistico_id
 * (Gesicomm), nunca ambos a la vez en la practica, pero no hay constraint
 * que lo obligue porque no hace falta.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('envios', 'proveedor_logistico_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'proveedores_logisticos', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'FK a proveedores_logisticos.id. Operador de la red de Gesicomm asignado para despachar este pedido (distinto de courier_id, que es del comercio).',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('envios', 'proveedor_logistico_id');
  },
};
