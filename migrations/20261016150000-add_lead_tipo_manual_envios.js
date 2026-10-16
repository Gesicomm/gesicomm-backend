'use strict';

const TABLA = 'envios';
const COLUMNA = 'lead_tipo_manual';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columnas = await queryInterface.describeTable(TABLA);
    if (!columnas[COLUMNA]) {
      await queryInterface.addColumn(TABLA, COLUMNA, {
        type: Sequelize.STRING(20),
        allowNull: true,
        validate: { isIn: [['organico', 'campana']] },
        comment: 'Override manual de Lead Orgánico/Campaña sobre el cálculo automático (MetaCampanaLead). NULL = usar el automático.',
      });
    }
  },

  async down(queryInterface) {
    const columnas = await queryInterface.describeTable(TABLA);
    if (columnas[COLUMNA]) {
      await queryInterface.removeColumn(TABLA, COLUMNA);
    }
  },
};
