'use strict';

const { execFileSync, spawnSync } = require('child_process');
const { Client } = require('pg');
const {
  CONTAINER_NAME, HOST, PORT, DB_NAME, DB_USER, DB_PASSWORD,
} = require('./config');

function docker(args) {
  return execFileSync('docker', args, { stdio: 'pipe' }).toString();
}

async function esperarPostgres() {
  const limite = Date.now() + 30000;
  let ultimoError;
  while (Date.now() < limite) {
    // Un Client de pg no admite reintentar connect() tras un fallo — se
    // crea uno nuevo en cada vuelta.
    const cliente = new Client({
      host: HOST, port: Number(PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    });
    try {
      await cliente.connect();
      await cliente.end();
      return;
    } catch (err) {
      ultimoError = err;
      await cliente.end().catch(() => {});
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres de test no arrancó a tiempo: ${ultimoError?.message}`);
}

module.exports = async function globalSetup() {
  // Limpieza de un contenedor colgado de una corrida anterior que no cerró bien.
  try { docker(['rm', '-f', CONTAINER_NAME]); } catch { /* no existía, ok */ }

  console.log(`[integration] Levantando Postgres efímero (${CONTAINER_NAME}) en :${PORT}...`);
  docker([
    'run', '-d', '--name', CONTAINER_NAME,
    '-e', `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-e', `POSTGRES_DB=${DB_NAME}`,
    '-p', `${PORT}:5432`,
    'postgres:16-alpine',
  ]);

  // Estas variables las heredan los procesos worker de Jest (se fork-ean
  // DESPUÉS de que este globalSetup termina) y también los `node scripts/…`
  // que se spawnean más abajo con `env` explícito.
  process.env.DB_HOST = HOST;
  process.env.DB_PORT = PORT;
  process.env.DB_NAME = DB_NAME;
  process.env.DB_USER = DB_USER;
  process.env.DB_PASSWORD = DB_PASSWORD;
  process.env.NODE_ENV = 'test';

  await esperarPostgres();
  console.log('[integration] Postgres de test aceptando conexiones.');

  // --- Bootstrap de esquema, en tres capas de fidelidad distinta --------
  //
  // 1) Tablas base (inquilinos, roles, usuarios) que NO tienen origen en
  //    migrations/ ni en scripts/*.js de este repo — son anteriores a la
  //    convención de migraciones versionadas del proyecto. No hay un DDL
  //    "canónico" para reproducirlas fuera de los modelos Sequelize, así
  //    que se crean desde ahí — pero requiriendo los archivos de modelo
  //    DIRECTAMENTE (nunca `../src/models`, el agregador), porque las
  //    asociaciones entre modelos (ej: Usuario.belongsTo(Afiliado)) están
  //    centralizadas en ese agregador, no en los archivos de cada modelo.
  //    Si se cargara primero, `Usuario.sync()` intentaría crear FKs hacia
  //    tablas que todavía no existen (afiliados, etc.) y que no vamos a
  //    crear acá — no son parte de lo que estos tests necesitan.
  const sequelize = require('../src/config/database');
  const Inquilino = require('../src/models/Inquilino');
  const Rol = require('../src/models/Rol');
  const Usuario = require('../src/models/Usuario'); // ya requiere Inquilino y Rol internamente
  await Inquilino.sync();
  await Rol.sync();
  await Usuario.sync();

  // 2) auth_events / auth_notifications / user_sessions: SQL crudo real,
  //    tal cual lo que corre en producción (scripts/migrar-auth-tracking.js).
  //    Recién ACÁ se carga el agregador completo (con todas las
  //    asociaciones) — ya no importa, porque de acá en más solo se corre
  //    `sequelize.query()` con SQL crudo, nunca `Model.sync()`.
  const { migrarAuthTracking } = require('../scripts/migrar-auth-tracking');
  await migrarAuthTracking();

  // 3) planes / suscripciones / pagos_suscripcion: el script real de
  //    producción (scripts/migrate-planes-suscripciones.js), sin modificar
  //    y sin reimplementar su DDL — es la fuente de verdad de los UNIQUE y
  //    FKs que estos tests necesitan demostrar que existen de verdad. Corre
  //    en un proceso aparte porque el script hace `sequelize.close()` al
  //    terminar, y no queremos que cierre la conexión de este proceso.
  const resultado = spawnSync(process.execPath, ['scripts/migrate-planes-suscripciones.js'], {
    cwd: require('path').resolve(__dirname, '..'),
    env: { ...process.env },
    stdio: 'inherit',
  });
  if (resultado.status !== 0) {
    throw new Error('No se pudo crear el esquema de planes/suscripciones en la BD de test.');
  }

  // Drift real detectado por este mismo harness: el modelo Plan tiene una
  // columna `moneda` que NO está en migrate-planes-suscripciones.js — la
  // agrega scripts/migrate-checkout-intents.js (línea ~83), junto con
  // columnas de `afiliados`/`afiliado_comisiones` que exigen tablas de ese
  // módulo (scripts/migrate-afiliados.js) totalmente ajenas a lo que estos
  // tests verifican. Correr ese script entero para una sola columna
  // arrastraría esa cascada sin necesidad; se replica ACÁ solo esa columna,
  // con el mismo DDL exacto que usa el script real.
  await sequelize.query(
    "ALTER TABLE planes ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) NOT NULL DEFAULT 'PYG'",
  );

  // Mismo drift, mismo origen: el modelo Suscripcion tiene checkout_intent_id
  // y subscription_purchase_id (de migrate-checkout-intents.js) y afiliado_id
  // / afiliado_codigo (de scripts/migrate-afiliados.js) — ninguno está en
  // migrate-planes-suscripciones.js. Ahí SÍ llevan FK real (hacia
  // checkout_intents, subscription_purchases y afiliados), pero esas tres
  // tablas pertenecen a features enteras (page builder de checkout,
  // programa de afiliados) que no tienen relación con lo que este harness
  // verifica. Se agregan las columnas SIN esa FK — no cambia ninguna de las
  // garantías bajo prueba (UNIQUE de referencia/token, el UPDATE
  // condicional, el advisory lock), y evita arrastrar dos features enteras
  // solo para poder hacer `Suscripcion.create(...)`.
  await sequelize.query(`
    ALTER TABLE suscripciones
      ADD COLUMN IF NOT EXISTS checkout_intent_id INTEGER,
      ADD COLUMN IF NOT EXISTS subscription_purchase_id INTEGER,
      ADD COLUMN IF NOT EXISTS afiliado_id INTEGER,
      ADD COLUMN IF NOT EXISTS afiliado_codigo VARCHAR(80)
  `);
  await sequelize.query(
    'ALTER TABLE pagos_suscripcion ADD COLUMN IF NOT EXISTS subscription_purchase_id INTEGER',
  );

  // Semilla mínima: un Inquilino (Usuario.inquilino_id es NOT NULL).
  const inquilino = await Inquilino.create({ nombre: 'Test' });
  process.env.GESICOMM_TEST_INQUILINO_ID = String(inquilino.id);

  await sequelize.close();
  console.log('[integration] Esquema de test listo.');
};
