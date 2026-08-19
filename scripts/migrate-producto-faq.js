/**
 * Crea la tabla `producto_faqs` — preguntas frecuentes propias de cada
 * Producto ("Todo lo que necesitas saber" en su página pública), separadas
 * del `faqs` existente que es por Landing. Ver src/models/ProductoFaq.js.
 * Idempotente: se puede correr más de una vez sin romper nada.
 */
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const tablas = await qi.showAllTables();
    if (!tablas.includes('producto_faqs')) {
      await qi.createTable('producto_faqs', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        producto_id: { type: DataTypes.INTEGER, allowNull: false },
        pregunta: { type: DataTypes.STRING(300), allowNull: false },
        respuesta: { type: DataTypes.TEXT, allowNull: false },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      }, { transaction: t });
      await qi.addIndex('producto_faqs', ['producto_id'], { transaction: t });
      console.log('  ✓ tabla "producto_faqs" creada.');
    } else {
      console.log('  tabla "producto_faqs" ya existe, se omite.');
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
