'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('seguimiento_etiquetas', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'CASCADE',
      },
      nombre: { type: Sequelize.STRING(100), allowNull: false },
      codigo: { type: Sequelize.STRING(50), allowNull: false },
      activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('seguimiento_etiquetas', ['usuario_id', 'codigo'], { unique: true, name: 'uq_seguimiento_etiquetas_usuario_codigo' });

    await queryInterface.createTable('whatsapp_plantillas', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'CASCADE',
      },
      nombre: { type: Sequelize.STRING(100), allowNull: false },
      codigo: { type: Sequelize.STRING(50), allowNull: false },
      mensaje: { type: Sequelize.TEXT, allowNull: false },
      activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      etiqueta_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'seguimiento_etiquetas', key: 'id' },
        onDelete: 'SET NULL',
      },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('whatsapp_plantillas', ['usuario_id', 'codigo'], { unique: true, name: 'uq_whatsapp_plantillas_usuario_codigo' });

    await queryInterface.createTable('envio_etiquetas', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      envio_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'envios', key: 'id' },
        onDelete: 'CASCADE',
      },
      etiqueta_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'seguimiento_etiquetas', key: 'id' },
        onDelete: 'CASCADE',
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'SET NULL',
      },
      origen: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'manual' },
      activa: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      removido_en: { type: Sequelize.DATE, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('envio_etiquetas', ['envio_id'], { name: 'idx_envio_etiquetas_envio_id' });
    await queryInterface.addIndex('envio_etiquetas', ['envio_id', 'activa'], { name: 'idx_envio_etiquetas_envio_activa' });

    await queryInterface.createTable('seguimiento_contactos', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      envio_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'envios', key: 'id' },
        onDelete: 'CASCADE',
      },
      plantilla_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'whatsapp_plantillas', key: 'id' },
        onDelete: 'SET NULL',
      },
      etiqueta_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'seguimiento_etiquetas', key: 'id' },
        onDelete: 'SET NULL',
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'SET NULL',
      },
      telefono: { type: Sequelize.STRING(50), allowNull: false },
      mensaje_generado: { type: Sequelize.TEXT, allowNull: false },
      canal: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'WHATSAPP' },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('seguimiento_contactos', ['envio_id'], { name: 'idx_seguimiento_contactos_envio_id' });

    await queryInterface.createTable('seguimiento_recordatorios', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      envio_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'envios', key: 'id' },
        onDelete: 'CASCADE',
      },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'SET NULL',
      },
      ejecutar_en: { type: Sequelize.DATE, allowNull: false },
      estado: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'PENDIENTE' },
      nota: { type: Sequelize.TEXT, allowNull: true },
      version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      completado_en: { type: Sequelize.DATE, allowNull: true },
      cancelado_en: { type: Sequelize.DATE, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('seguimiento_recordatorios', ['envio_id'], { name: 'idx_seguimiento_recordatorios_envio_id' });
    await queryInterface.addIndex('seguimiento_recordatorios', ['estado', 'ejecutar_en'], { name: 'idx_seguimiento_recordatorios_estado_ejecutar_en' });

    await queryInterface.createTable('notificaciones', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'CASCADE',
      },
      tipo: { type: Sequelize.STRING(50), allowNull: false },
      entidad_tipo: { type: Sequelize.STRING(50), allowNull: true },
      entidad_id: { type: Sequelize.INTEGER, allowNull: true },
      titulo: { type: Sequelize.STRING(255), allowNull: false },
      mensaje: { type: Sequelize.TEXT, allowNull: false },
      leida: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      leida_en: { type: Sequelize.DATE, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
    await queryInterface.addIndex('notificaciones', ['usuario_id', 'leida'], { name: 'idx_notificaciones_usuario_leida' });
    await queryInterface.addIndex('notificaciones', ['tipo', 'entidad_tipo', 'entidad_id'], { unique: true, name: 'uq_notificaciones_tipo_entidad' });

    await queryInterface.createTable('seguimiento_configuraciones', {
      usuario_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'usuarios', key: 'id' },
        onDelete: 'CASCADE',
      },
      tiempos_rapidos_horas: { type: Sequelize.JSONB, allowNull: false, defaultValue: [1, 2, 4, 8, 24] },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn('NOW') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('seguimiento_configuraciones');
    await queryInterface.dropTable('notificaciones');
    await queryInterface.dropTable('seguimiento_recordatorios');
    await queryInterface.dropTable('seguimiento_contactos');
    await queryInterface.dropTable('envio_etiquetas');
    await queryInterface.dropTable('whatsapp_plantillas');
    await queryInterface.dropTable('seguimiento_etiquetas');
  },
};
