/**
 * Agrega `precio_dolar` a la tabla `proveedores` (Proveedor.js ya la declara
 * pero nunca se migró — cualquier Proveedor.findOne/findAll sin `attributes`
 * explícito rompe con "column precio_dolar does not exist").
 * Idempotente — se puede correr más de una vez sin romper nada.
 */
require('dotenv').config();
const sequelize = require('../src/config/database');
const { DataTypes } = require('sequelize');

async function up() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('proveedores');
    if (!tableInfo.precio_dolar) {
      await queryInterface.addColumn('proveedores', 'precio_dolar', {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Precio del dolar específico para este proveedor',
      });
      console.log('Columna precio_dolar agregada con éxito a la tabla proveedores.');
    } else {
      console.log('La columna precio_dolar ya existe en la tabla proveedores.');
    }
  } catch (error) {
    console.error('Error al agregar precio_dolar:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

up();
