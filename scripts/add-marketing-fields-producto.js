/**
 * Agrega a `productos` las 6 columnas que el modelo Producto.js ya declara
 * (commit 72a19bd, "feat: add marketing fields to Producto model") pero que
 * nunca se crearon en la tabla real: sobre_este_producto, propuesta_valor,
 * beneficios, confianza, preguntas_frecuentes, es_dolar.
 *
 * Sin esta columna, cualquier SELECT normal sobre Producto (panel, API,
 * tienda pública) rompe con "column ... does not exist" — no es una mejora,
 * es reparar el desajuste de schema para que las lecturas vuelvan a andar.
 *
 * Idempotente — se puede correr más de una vez sin romper nada.
 */
require('dotenv').config();
const sequelize = require('../src/config/database');
const { DataTypes } = require('sequelize');

const COLUMNAS = [
  { nombre: 'sobre_este_producto', def: { type: DataTypes.TEXT, allowNull: true } },
  { nombre: 'propuesta_valor', def: { type: DataTypes.TEXT, allowNull: true } },
  { nombre: 'beneficios', def: { type: DataTypes.JSON, allowNull: true, defaultValue: [] } },
  { nombre: 'confianza', def: { type: DataTypes.JSON, allowNull: true, defaultValue: [] } },
  { nombre: 'preguntas_frecuentes', def: { type: DataTypes.JSON, allowNull: true, defaultValue: [] } },
  {
    nombre: 'es_dolar',
    def: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Si es true, el costo base es en dolares y se calcula en guaranies según el precio_dolar del proveedor.',
    },
  },
];

async function up() {
  try {
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('productos');
    for (const { nombre, def } of COLUMNAS) {
      if (!tableInfo[nombre]) {
        await queryInterface.addColumn('productos', nombre, def);
        console.log(`+ Columna "${nombre}" agregada.`);
      } else {
        console.log(`- Columna "${nombre}" ya existe, se omite.`);
      }
    }
    console.log('\nListo.');
  } catch (error) {
    console.error('Error al agregar columnas:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

up();
