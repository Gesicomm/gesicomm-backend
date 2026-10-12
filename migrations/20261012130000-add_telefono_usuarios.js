module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('usuarios', 'telefono', {
      type: Sequelize.STRING(40),
      allowNull: true,
      comment: 'Telefono personal/de contacto del usuario. Distinto del telefono publico de sus tiendas.',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('usuarios', 'telefono');
  },
};
