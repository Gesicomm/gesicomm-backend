'use strict';

/**
 * Migración única: crea la tabla `parametros` para la configuración del
 * sistema editable sin redeploy (empezando por las credenciales de PagoPar
 * con las que Gesicomm cobra sus suscripciones).
 *
 * Si esas credenciales ya estaban en el .env, las copia a la tabla — el
 * privado queda cifrado. A partir de ahí mandan las de la tabla; el .env
 * queda solo como respaldo.
 *
 * Idempotente. Ejecutar:
 *   node scripts/migrate-parametros.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize, Parametro } = require('../src/models');
const { DEFINICIONES } = require('../src/services/parametros.service');

async function existeTabla(qi, nombre) {
  const tablas = await qi.showAllTables();
  return tablas.map(t => (typeof t === 'string' ? t : t.tableName)).includes(nombre);
}

async function main() {
  const qi = sequelize.getQueryInterface();
  try {
    if (await existeTabla(qi, 'parametros')) {
      console.log('→ La tabla "parametros" ya existe.');
    } else {
      console.log('→ Creando tabla "parametros"...');
      await qi.createTable('parametros', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        clave: { type: DataTypes.STRING(100), allowNull: false, unique: true },
        valor: { type: DataTypes.TEXT, allowNull: true },
        secreto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        grupo: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'general' },
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });
      console.log('  tabla creada.');
    }

    let migrados = 0;
    for (const def of DEFINICIONES) {
      const yaEsta = await Parametro.findOne({ where: { clave: def.clave } });
      if (yaEsta) { console.log(`  ${def.clave}: ya estaba en la tabla, no se toca.`); continue; }

      const delEntorno = process.env[def.clave];
      if (!delEntorno) { console.log(`  ${def.clave}: sin valor en .env, queda para cargar desde el panel.`); continue; }

      const fila = Parametro.build({
        clave: def.clave, secreto: def.secreto, grupo: def.grupo, descripcion: def.descripcion,
      });
      fila.valor = delEntorno;
      await fila.save();
      migrados++;
      console.log(`  ${def.clave}: copiado del .env${def.secreto ? ' (cifrado)' : ''}.`);
    }

    console.log(`\n✓ Listo. ${migrados} parámetro(s) migrado(s) del entorno.`);
  } catch (err) {
    console.error('\n✗ Falló:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
