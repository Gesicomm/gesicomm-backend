'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('importacion_solicitudes', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      usuario_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'usuarios', key: 'id' }, onDelete: 'RESTRICT' },
      tienda_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'tiendas', key: 'id' }, onDelete: 'RESTRICT' },
      inquilino_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'inquilinos', key: 'id' }, onDelete: 'RESTRICT' },
      producto_url: { type: Sequelize.STRING(2000), allowNull: false },
      cantidad: { type: Sequelize.INTEGER, allowNull: false },
      transporte: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'conveniente' },
      observaciones: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      estado: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'Pendiente de cotización' },
      clave_idempotencia: { type: Sequelize.UUID, allowNull: false },
      huella: { type: Sequelize.STRING(64), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('importacion_solicitudes', ['usuario_id', 'tienda_id', 'clave_idempotencia'], { unique: true, name: 'importacion_solicitudes_idempotencia' });
    await queryInterface.addIndex('importacion_solicitudes', ['inquilino_id', 'estado', 'created_at']);
    await queryInterface.sequelize.query(`ALTER TABLE importacion_solicitudes ADD CONSTRAINT importacion_solicitudes_datos_validos CHECK (cantidad > 0 AND transporte IN ('conveniente', 'aereo', 'maritimo'))`);
    await queryInterface.sequelize.query(`UPDATE gsql_modulos SET etiqueta = 'Importar desde China', icono = 'Ship', seccion = 'IMPORTACIÓN', orden = 135 WHERE modulo_key = 'importada-de-china'`);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('importacion_solicitudes');
    await queryInterface.sequelize.query(`UPDATE gsql_modulos SET etiqueta = 'Importa desde China', icono = 'PackageSearch' WHERE modulo_key = 'importada-de-china'`);
  },
};
