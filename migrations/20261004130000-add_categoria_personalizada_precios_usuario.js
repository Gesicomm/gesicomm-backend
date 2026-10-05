'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('precios_usuario', 'categoria_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'categorias', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      comment: 'Categoria interna que el usuario asigna a este item en su propia vitrina.',
    });

    await queryInterface.addIndex('precios_usuario', ['usuario_id', 'tipo', 'categoria_id'], {
      name: 'idx_precios_usuario_categoria',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('precios_usuario', 'idx_precios_usuario_categoria');
    await queryInterface.removeColumn('precios_usuario', 'categoria_id');
  },
};
