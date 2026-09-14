'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../src/config/database');

async function existeTabla(qi, tabla) {
  try {
    await qi.describeTable(tabla);
    return true;
  } catch {
    return false;
  }
}

async function addIndexSafe(qi, tabla, campos, options = {}) {
  const existentes = await qi.showIndex(tabla);
  const nombre = options.name || `${tabla}_${campos.join('_')}`;
  const yaExiste = existentes.some(idx => idx.name === nombre);
  if (yaExiste) return;
  await qi.addIndex(tabla, campos, { ...options, name: nombre });
}

async function migrarComboImagenes() {
  const qi = sequelize.getQueryInterface();
  const tabla = 'producto_combo_imagenes';

  if (!(await existeTabla(qi, tabla))) {
    await qi.createTable(tabla, {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      inquilino_id: { type: DataTypes.INTEGER, allowNull: false },
      combo_id: { type: DataTypes.INTEGER, allowNull: false },
      url: { type: DataTypes.STRING(500), allowNull: false },
      storage_key: { type: DataTypes.STRING(700), allowNull: true },
      mime_type: { type: DataTypes.STRING(100), allowNull: true },
      size: { type: DataTypes.INTEGER, allowNull: true },
      width: { type: DataTypes.INTEGER, allowNull: true },
      height: { type: DataTypes.INTEGER, allowNull: true },
      es_principal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
  }

  await addIndexSafe(qi, tabla, ['combo_id']);
  await addIndexSafe(qi, tabla, ['inquilino_id']);
  await addIndexSafe(qi, tabla, ['storage_key']);
}

if (require.main === module) {
  migrarComboImagenes()
    .then(() => {
      console.log('✓ producto_combo_imagenes lista.');
      return sequelize.close();
    })
    .catch(async (err) => {
      console.error('✗ Falló la migración de imágenes de combo:', err);
      await sequelize.close();
      process.exit(1);
    });
}

module.exports = { migrarComboImagenes };
