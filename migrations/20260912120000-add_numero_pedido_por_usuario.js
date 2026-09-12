'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('envios', 'numero_pedido', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      WITH numerados AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY usuario_id
            ORDER BY COALESCE(created_at, NOW()), id
          ) AS numero
        FROM envios
      )
      UPDATE envios e
      SET numero_pedido = n.numero
      FROM numerados n
      WHERE e.id = n.id
        AND e.numero_pedido IS NULL
    `);

    await queryInterface.createTable('pedido_counters', {
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'CASCADE',
      },
      ultimo_numero_pedido: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.sequelize.query(`
      INSERT INTO pedido_counters (usuario_id, ultimo_numero_pedido, created_at, updated_at)
      SELECT usuario_id, MAX(numero_pedido), NOW(), NOW()
      FROM envios
      WHERE numero_pedido IS NOT NULL
      GROUP BY usuario_id
      ON CONFLICT (usuario_id) DO UPDATE
      SET ultimo_numero_pedido = EXCLUDED.ultimo_numero_pedido,
          updated_at = NOW()
    `);

    await queryInterface.changeColumn('envios', 'numero_pedido', {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.addIndex('envios', ['usuario_id', 'numero_pedido'], {
      name: 'uq_envios_usuario_numero_pedido',
      unique: true,
    });
    await queryInterface.addIndex('envios', ['numero_pedido'], {
      name: 'idx_envios_numero_pedido',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('envios', 'idx_envios_numero_pedido');
    await queryInterface.removeIndex('envios', 'uq_envios_usuario_numero_pedido');
    await queryInterface.dropTable('pedido_counters');
    await queryInterface.removeColumn('envios', 'numero_pedido');
  },
};
