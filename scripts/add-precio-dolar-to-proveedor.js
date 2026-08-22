const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const sequelize = require('../src/config/database');

async function up() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('proveedores');
    if (!tableInfo.precio_dolar) {
      await queryInterface.addColumn('proveedores', 'precio_dolar', {
        type: require('sequelize').DataTypes.DECIMAL(12, 2),
        allowNull: true,
      });
      console.log('Columna precio_dolar agregada con éxito a la tabla proveedores.');
    } else {
      console.log('La columna precio_dolar ya existe en la tabla proveedores.');
    }
  } catch (error) {
    console.error('Error al agregar precio_dolar:', error);
  } finally {
    process.exit(0);
  }
}

up();
