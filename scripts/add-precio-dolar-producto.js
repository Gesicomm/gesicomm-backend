/**
 * Agrega `precio_dolar` a la tabla `productos`: costo del producto en USD,
 * tal como lo factura el proveedor. Permite recalcular precio_costo/precio_base
 * en guaraníes cuando cambie la cotización, sin tener que re-cargar el producto.
 * Idempotente — se puede correr más de una vez sin romper nada.
 */
require('dotenv').config();
const sequelize = require('../src/config/database');
const { DataTypes } = require('sequelize');

async function up() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('productos');
    if (!tableInfo.precio_dolar) {
      await queryInterface.addColumn('productos', 'precio_dolar', {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        comment: 'Costo del producto en USD (precio de compra al proveedor). Base para recalcular precio_costo/precio_base cuando cambia la cotización.',
      });
      console.log('Columna precio_dolar agregada con éxito a la tabla productos.');
    } else {
      console.log('La columna precio_dolar ya existe en la tabla productos.');
    }
  } catch (error) {
    console.error('Error al agregar precio_dolar:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

up();
