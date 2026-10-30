'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS tipo_ingreso_inicial VARCHAR(16)
          CHECK (tipo_ingreso_inicial IN ('usuario', 'proveedor'))`, { transaction });

      // Las cuentas ya existentes no deben volver a atravesar una pregunta
      // pensada para su primer acceso. Las nuevas quedan en NULL hasta elegir.
      await queryInterface.sequelize.query(`UPDATE usuarios
        SET tipo_ingreso_inicial = 'usuario'
        WHERE tipo_ingreso_inicial IS NULL`, { transaction });
    });
  },
  async down() {
    throw new Error('La elección de ingreso es parte del historial de la cuenta y no se revierte automáticamente.');
  },
};
