'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // 1. Columnas en Envios
    await queryInterface.addColumn('envios', 'costo_fulfillment', {
      type: Sequelize.DECIMAL(12, 2),
      defaultValue: 0,
      allowNull: false
    });
    await queryInterface.addColumn('envios', 'ruta_abastecimiento', {
      type: Sequelize.STRING(30),
      allowNull: true
    });

    // 2. Tabla inventario_ubicaciones
    await queryInterface.createTable('inventario_ubicaciones', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      producto_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      variante_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      deposito_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      cantidad_disponible: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      cantidad_reservada: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // 3. Tabla ingresos_inventario
    await queryInterface.createTable('ingresos_inventario', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      centro_gesicomm_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      estado: {
        type: Sequelize.STRING(30),
        defaultValue: 'BORRADOR',
        allowNull: false
      },
      fecha_envio: {
        type: Sequelize.DATE,
        allowNull: true
      },
      fecha_recepcion: {
        type: Sequelize.DATE,
        allowNull: true
      },
      transportista: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      numero_seguimiento: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      observacion: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // 4. Tabla ingreso_inventario_items
    await queryInterface.createTable('ingreso_inventario_items', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      ingreso_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      producto_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      variante_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      cantidad_declarada: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      cantidad_recibida: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      cantidad_aceptada: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      observacion_recepcion: {
        type: Sequelize.STRING(255),
        allowNull: true
      }
    });

    // 5. Tabla historial_ingresos_inventario
    await queryInterface.createTable('historial_ingresos_inventario', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      ingreso_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      estado: {
        type: Sequelize.STRING(30),
        allowNull: false
      },
      comentario: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    // Indexes
    await queryInterface.addIndex('inventario_ubicaciones', ['producto_id', 'variante_id', 'deposito_id'], {
      unique: true,
      name: 'idx_inventario_ubicacion_unica'
    });
    await queryInterface.addIndex('inventario_ubicaciones', ['usuario_id', 'deposito_id']);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('historial_ingresos_inventario');
    await queryInterface.dropTable('ingreso_inventario_items');
    await queryInterface.dropTable('ingresos_inventario');
    await queryInterface.dropTable('inventario_ubicaciones');
    await queryInterface.removeColumn('envios', 'ruta_abastecimiento');
    await queryInterface.removeColumn('envios', 'costo_fulfillment');
  }
};
