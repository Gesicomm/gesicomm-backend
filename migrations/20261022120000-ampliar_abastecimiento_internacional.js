'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.addColumn('importacion_solicitudes', 'pais_origen', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE importacion_solicitudes DROP CONSTRAINT importacion_solicitudes_datos_validos`, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE importacion_solicitudes ADD CONSTRAINT importacion_solicitudes_datos_validos CHECK (cantidad > 0 AND transporte IN ('conveniente', 'terrestre', 'aereo', 'maritimo'))`, { transaction });
      await queryInterface.sequelize.query(`UPDATE gsql_modulos SET etiqueta = 'Proveete con Gesicom' WHERE modulo_key = 'importada-de-china'`, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      // Los registros de transporte terrestre se conservan: este estado no admite volver al esquema anterior.
      const [rows] = await queryInterface.sequelize.query(`SELECT id FROM importacion_solicitudes WHERE transporte = 'terrestre' LIMIT 1`, { transaction });
      if (rows.length) throw new Error('Hay solicitudes de transporte terrestre. No se puede revertir sin perder su modalidad.');
      await queryInterface.sequelize.query(`ALTER TABLE importacion_solicitudes DROP CONSTRAINT importacion_solicitudes_datos_validos`, { transaction });
      await queryInterface.sequelize.query(`ALTER TABLE importacion_solicitudes ADD CONSTRAINT importacion_solicitudes_datos_validos CHECK (cantidad > 0 AND transporte IN ('conveniente', 'aereo', 'maritimo'))`, { transaction });
      await queryInterface.removeColumn('importacion_solicitudes', 'pais_origen', { transaction });
      await queryInterface.sequelize.query(`UPDATE gsql_modulos SET etiqueta = 'Importar desde China' WHERE modulo_key = 'importada-de-china'`, { transaction });
    });
  },
};
