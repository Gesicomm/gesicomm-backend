/**
 * Completa la tabla `productos_relacionados` (ya existía, solo se escribía
 * al crear un producto y nunca se leía en ningún lado — ver
 * producto.controller.js#crear): agrega `orden` para poder priorizar la
 * curación manual, y `relacionados_titulo` en `productos` para el título
 * editable de la sección. Idempotente.
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const columnas = await qi.describeTable('productos_relacionados');
    if (!columnas.orden) {
      await qi.addColumn('productos_relacionados', 'orden', {
        type: DataTypes.INTEGER, allowNull: false, defaultValue: 0,
      }, { transaction: t });
      console.log('  ✓ "productos_relacionados.orden" agregada.');
    } else {
      console.log('  "productos_relacionados.orden" ya existe, se omite.');
    }

    const columnasProducto = await qi.describeTable('productos');
    if (!columnasProducto.relacionados_titulo) {
      await qi.addColumn('productos', 'relacionados_titulo', {
        type: DataTypes.STRING(255), allowNull: true,
      }, { transaction: t });
      console.log('  ✓ "productos.relacionados_titulo" agregada.');
    } else {
      console.log('  "productos.relacionados_titulo" ya existe, se omite.');
    }

    await t.commit();
    console.log('\nMigración completa.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error en la migración:', err);
    process.exit(1);
  });
