'use strict';

/**
 * Script de migración — Multi-página por tienda (Inicio / Catálogo / Contacto).
 *
 * Agrega a "landings":
 *   - tipo_pagina  VARCHAR(20) NOT NULL DEFAULT 'inicio'  (validado como
 *     ENUM a nivel Sequelize en el modelo — ver Landing.js; se usa VARCHAR
 *     acá porque este proyecto no tiene precedente de crear un tipo ENUM de
 *     Postgres a mano en un script de migración, y ALTER TYPE ... ADD VALUE
 *     no se puede revertir ni correr dentro de una transacción junto con
 *     otro DDL — VARCHAR + validación en la app es más seguro de migrar).
 *   - índice único (tienda_id, tipo_pagina)
 *
 * Backfill: toda landing existente (siempre es_home=true bajo el MVP de
 * "una landing por tienda") pasa a tipo_pagina='inicio' — coincide con el
 * default de la columna, así que no hace falta un UPDATE explícito, pero se
 * deja documentado acá por las dudas de que exista alguna fila con
 * es_home=false de datos viejos.
 *
 * Sin `references`/FK a nivel Postgres — misma convención que el resto del
 * proyecto (ver migrate-landing-contenido.js). No usa sync_db.js ni
 * sequelize.sync({alter:true}) global. DDL puntual vía QueryInterface,
 * dentro de UNA transacción (todo o nada). Idempotente: se puede correr
 * más de una vez sin romper nada.
 *
 * Rollback manual si hiciera falta (no se corre acá):
 *   DROP INDEX IF EXISTS landings_tienda_id_tipo_pagina;
 *   ALTER TABLE landings DROP COLUMN IF EXISTS tipo_pagina;
 *
 * Ejecutar: node scripts/migrate-landing-tipo-pagina.js
 */

require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('../src/models');

async function migrar() {
  const qi = sequelize.getQueryInterface();
  const t = await sequelize.transaction();

  try {
    const columnasLanding = await qi.describeTable('landings');

    if (!columnasLanding.tipo_pagina) {
      await qi.addColumn('landings', 'tipo_pagina', {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'inicio',
      }, { transaction: t });
      console.log('  ✓ "landings.tipo_pagina" agregada (default \'inicio\').');
    } else {
      console.log('  "landings.tipo_pagina" ya existe, se omite.');
    }

    // Backfill explícito por si hay filas con es_home=false que no deberían
    // quedar en 'inicio' — hoy no existen (MAX_LANDINGS_POR_TIENDA=1,
    // siempre es_home=true), pero no cuesta nada dejarlo correcto.
    await sequelize.query(
      `UPDATE landings SET tipo_pagina = 'inicio' WHERE es_home = true AND tipo_pagina IS DISTINCT FROM 'inicio'`,
      { transaction: t }
    );

    console.log('  Consultando índices existentes...');
    const indices = await qi.showIndex('landings', { transaction: t });
    const yaExisteIndice = indices.some(idx => idx.fields?.length === 2
      && idx.fields.some(f => f.attribute === 'tienda_id')
      && idx.fields.some(f => f.attribute === 'tipo_pagina'));

    if (!yaExisteIndice) {
      await qi.addIndex('landings', ['tienda_id', 'tipo_pagina'], {
        unique: true,
        name: 'landings_tienda_id_tipo_pagina',
        transaction: t,
      });
      console.log('  ✓ índice único (tienda_id, tipo_pagina) creado.');
    } else {
      console.log('  índice (tienda_id, tipo_pagina) ya existe, se omite.');
    }

    await t.commit();
    console.log('\nMigración completada.');
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error durante la migración:', err.message);
    process.exit(1);
  });
