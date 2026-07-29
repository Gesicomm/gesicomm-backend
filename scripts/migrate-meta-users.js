const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../src/config/database');

async function up() {
  try {
    await sequelize.authenticate();
    console.log('Conexión a BD establecida.');

    const queryInterface = sequelize.getQueryInterface();

    console.log('Añadiendo columna usuario_id a meta_integrations...');
    await queryInterface.addColumn('meta_integrations', 'usuario_id', {
      type: DataTypes.INTEGER,
      allowNull: true
    });

    console.log('Actualizando registros existentes con usuario_id = 1 (Martín)...');
    await sequelize.query('UPDATE meta_integrations SET usuario_id = 1 WHERE usuario_id IS NULL');

    console.log('Migración de meta_integrations completada.');
    process.exit(0);
  } catch (error) {
    if (error.name === 'SequelizeDatabaseError' && error.message.includes('Duplicate column name')) {
      console.log('La columna usuario_id ya existe, asignando usuario_id = 1 a los nulos...');
      await sequelize.query('UPDATE meta_integrations SET usuario_id = 1 WHERE usuario_id IS NULL');
      console.log('Hecho.');
      process.exit(0);
    }
    console.error('Error migrando:', error);
    process.exit(1);
  }
}

up();
