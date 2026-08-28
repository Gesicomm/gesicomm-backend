'use strict';

const { logger } = require('./logger');

/**
 * Valida que todas las columnas definidas en los modelos de Sequelize
 * existan en las tablas correspondientes de la base de datos PostgreSQL.
 *
 * @param {import('sequelize').Sequelize} sequelizeInstance - Instancia de Sequelize
 * @throws {Error} Si se encuentran columnas definidas en modelos pero ausentes en BD
 */
async function validarEsquema(sequelizeInstance) {
  const sequelize = sequelizeInstance || require('../config/database');
  const models = sequelize.models;

  // Consultar todas las columnas existentes en el esquema 'public'
  const [filas] = await sequelize.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  const columnasPorTabla = new Map();
  for (const fila of filas) {
    const tabla = String(fila.table_name).toLowerCase();
    const columna = String(fila.column_name).toLowerCase();
    if (!columnasPorTabla.has(tabla)) {
      columnasPorTabla.set(tabla, new Set());
    }
    columnasPorTabla.get(tabla).add(columna);
  }

  const columnasFaltantes = [];

  for (const [, model] of Object.entries(models)) {
    let tableName = typeof model.getTableName === 'function' ? model.getTableName() : model.tableName;
    if (typeof tableName === 'object' && tableName !== null) {
      tableName = tableName.tableName;
    }
    tableName = String(tableName).toLowerCase();

    const columnasEnBD = columnasPorTabla.get(tableName) || new Set();

    for (const [key, attr] of Object.entries(model.rawAttributes)) {
      // Ignorar campos virtuales si los hubiera
      if (attr.type && (attr.type.key === 'VIRTUAL' || attr.type.constructor?.name === 'VIRTUAL')) {
        continue;
      }

      // Mapear al nombre real de la columna en la BD
      const nombreColumna = String(attr.field || key).toLowerCase();

      if (!columnasEnBD.has(nombreColumna)) {
        columnasFaltantes.push(`${tableName}.${nombreColumna}`);
      }
    }
  }

  if (columnasFaltantes.length > 0) {
    const lista = columnasFaltantes.map(col => `  • ${col}`).join('\n');
    const mensaje = `❌ Esquema desincronizado — columnas faltantes en la BD:\n${lista}`;
    throw new Error(mensaje);
  }

  const mensajeExito = '✅ Validación de esquema: todos los modelos coinciden con la BD.';
  if (logger && typeof logger.info === 'function') {
    logger.info(mensajeExito);
  }
  console.log(mensajeExito);
}

module.exports = {
  validarEsquema,
};
