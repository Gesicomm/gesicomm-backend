'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ai_generation_logs', 'metadata', {
      type: Sequelize.JSONB,
      allowNull: true,
      comment: 'Telemetría flexible de generación IA: product_family, reference_template, tamaños de prompt/template, etc.',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ai_generation_logs', 'metadata');
  },
};
