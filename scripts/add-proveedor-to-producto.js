require('dotenv').config();
const sequelize = require('../src/config/database');

async function up() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('productos');
    if (!tableInfo.proveedor_id) {
      await queryInterface.addColumn('productos', 'proveedor_id', {
        type: require('sequelize').DataTypes.INTEGER,
        allowNull: true,
      });
      console.log('Columna proveedor_id agregada con éxito a la tabla productos.');
    } else {
      console.log('La columna proveedor_id ya existe en la tabla productos.');
    }
  } catch (error) {
    console.error('Error al agregar proveedor_id:', error);
  } finally {
    process.exit(0);
  }
}

up();
