const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const sequelize = require('../src/config/database');

async function up() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('productos');
    if (!tableInfo.es_dolar) {
      await queryInterface.addColumn('productos', 'es_dolar', {
        type: require('sequelize').DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      console.log('Columna es_dolar agregada con éxito a la tabla productos.');
    } else {
      console.log('La columna es_dolar ya existe en la tabla productos.');
    }
  } catch (error) {
    console.error('Error al agregar es_dolar:', error);
  } finally {
    process.exit(0);
  }
}

up();
