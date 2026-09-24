'use strict';

/**
 * Camino 2 (inbound propio hacia Gesicomm): hasta ahora nada conectaba una
 * venta con el stock que ya vive fisicamente en un centro de Gesicomm
 * (inventario_ubicaciones). descontarStockYSnapshot() solo repartia entre
 * stock_salon/stock_deposito, sin saber que parte de esas unidades estan en
 * Centro Luque y hay que avisarle a Gesicomm para que las prepare.
 *
 * Estas dos columnas, nullables y sin default distinto de NULL, dejan que
 * envio_item_componentes registre cuanto de ese componente salio de un
 * centro Gesicomm en vez del salon/deposito propio. Cuando
 * origen_centro_id no es null, ese componente tiene que aparecer en la
 * cola admin de "Pedidos a preparar por Gesicomm".
 *
 * No toca filas existentes: para pedidos ya confirmados, ambas columnas
 * quedan NULL (se asume que salieron del comercio, que es lo que pasaba
 * antes de que existiera el inbound).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('envio_item_componentes', 'origen_centro_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'FK a depositos.id (alcance GESICOMM). NULL = salio del stock propio del comercio.',
    });
    await queryInterface.addColumn('envio_item_componentes', 'cantidad_desde_centro', {
      type: Sequelize.INTEGER,
      allowNull: true,
      comment: 'Cuanto de `cantidad` salio de origen_centro_id. NULL cuando origen_centro_id es NULL.',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('envio_item_componentes', 'cantidad_desde_centro');
    await queryInterface.removeColumn('envio_item_componentes', 'origen_centro_id');
  },
};
