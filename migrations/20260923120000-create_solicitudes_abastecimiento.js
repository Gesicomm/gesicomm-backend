'use strict';

/**
 * Camino 3 (Abastecerme desde catalogo): el comercio pide traer mas stock
 * de un producto del catalogo Gesicomm hacia su deposito propio o hacia un
 * Centro de Fulfillment de Gesicomm, ANTES de que exista ninguna venta.
 *
 * A proposito NO reusa Envio: esa tabla alimenta ventas, dashboards y
 * liquidaciones reales, y una solicitud de abastecimiento no es una venta.
 * Reusa en cambio la MISMA maquina de estados que ya usa Envio.abastecimiento_estado
 * (services/abastecimiento/estadoMachine.js), que ya es generica sobre
 * strings de estado y no conoce a Envio.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('solicitudes_abastecimiento', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      producto_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      variante_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      cantidad: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      tipo_logistica: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'GESICOMM = queda en un Centro Gesicomm. PROPIA = viaja al deposito propio del comercio.',
      },
      deposito_destino_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Deposito propio del comercio cuando tipo_logistica=PROPIA. NULL cuando es GESICOMM (el centro se resuelve al avanzar, igual que en el abastecimiento por venta).',
      },
      centro_gesicomm_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Centro Gesicomm donde termina acreditandose el stock cuando tipo_logistica=GESICOMM.',
      },
      costo_producto: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Snapshot: costoParaComerciante(producto) x cantidad, al momento de crear la solicitud.',
      },
      costo_logistico: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      estado: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'pendiente_pago',
        comment: 'Mismos valores que Envio.abastecimiento_estado (ver estadoMachine.js) — pendiente_pago, pago_enviado, pago_validado, pago_rechazado, proveedor_contactado, enviado_por_proveedor, en_transito_a_gesicomm, en_transito_a_deposito_cliente, recibido_en_gesicomm, preparando_envio_a_deposito_cliente, despachado_a_deposito_cliente, disponible_en_gesicomm, recibido_en_deposito_cliente, cancelada.',
      },
      comprobante_url: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      comprobante_storage_key: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      rechazo_motivo: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('solicitudes_abastecimiento', ['usuario_id', 'estado']);
    await queryInterface.addIndex('solicitudes_abastecimiento', ['estado']);

    await queryInterface.createTable('historial_solicitudes_abastecimiento', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      solicitud_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      estado: {
        type: Sequelize.STRING(40),
        allowNull: false,
      },
      comentario: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('historial_solicitudes_abastecimiento', ['solicitud_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('historial_solicitudes_abastecimiento');
    await queryInterface.dropTable('solicitudes_abastecimiento');
  },
};
