'use strict';

/**
 * Scenario 6: seguridad del cron con múltiples instancias del backend.
 * Dos conexiones Postgres REALES (no la misma que usa Sequelize por
 * dentro) compitiendo por el mismo `pg_try_advisory_xact_lock`.
 */
const { Client } = require('pg');
const { HOST, PORT, DB_NAME, DB_USER, DB_PASSWORD } = require('./config');

// Mismo valor que src/services/cron/reconciliacionSuscripciones.job.js —
// si cambia ahí, este test detecta el desacople.
const { LOCK_KEY } = require('../src/services/cron/reconciliacionSuscripciones.job');
const { sequelize } = require('../src/models');

afterAll(async () => { await sequelize.close(); });

async function nuevoCliente() {
  const cliente = new Client({
    host: HOST, port: Number(PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
  });
  await cliente.connect();
  return cliente;
}

describe('6) pg_try_advisory_xact_lock — seguro con múltiples instancias', () => {
  it('si una conexión ya tiene el lock dentro de su transacción, otra conexión no lo consigue — y se libera solo al COMMIT', async () => {
    const c1 = await nuevoCliente();
    const c2 = await nuevoCliente();
    try {
      await c1.query('BEGIN');
      const r1 = await c1.query('SELECT pg_try_advisory_xact_lock($1) AS obtenido', [LOCK_KEY]);
      expect(r1.rows[0].obtenido).toBe(true);

      await c2.query('BEGIN');
      const r2 = await c2.query('SELECT pg_try_advisory_xact_lock($1) AS obtenido', [LOCK_KEY]);
      expect(r2.rows[0].obtenido).toBe(false); // la "otra instancia" se queda afuera, no espera ni rompe

      await c1.query('COMMIT'); // libera el advisory lock automáticamente, sin unlock manual

      const r3 = await c2.query('SELECT pg_try_advisory_xact_lock($1) AS obtenido', [LOCK_KEY]);
      expect(r3.rows[0].obtenido).toBe(true); // liberado: ahora sí lo consigue
      await c2.query('COMMIT');
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it('un ROLLBACK también libera el lock (no solo el COMMIT)', async () => {
    const c1 = await nuevoCliente();
    const c2 = await nuevoCliente();
    try {
      await c1.query('BEGIN');
      await c1.query('SELECT pg_try_advisory_xact_lock($1)', [LOCK_KEY]);
      await c1.query('ROLLBACK');

      await c2.query('BEGIN');
      const r2 = await c2.query('SELECT pg_try_advisory_xact_lock($1) AS obtenido', [LOCK_KEY]);
      expect(r2.rows[0].obtenido).toBe(true);
      await c2.query('COMMIT');
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it('el job real: si otra instancia ya tiene el lock, reconciliarPagosPendientes no hace nada (no tira, no se cuelga)', async () => {
    const bloqueadora = await nuevoCliente();
    try {
      await bloqueadora.query('BEGIN');
      await bloqueadora.query('SELECT pg_try_advisory_xact_lock($1)', [LOCK_KEY]);

      const { reconciliarPagosPendientes } = require('../src/services/cron/reconciliacionSuscripciones.job');
      await expect(reconciliarPagosPendientes()).resolves.toBeUndefined();
    } finally {
      await bloqueadora.query('COMMIT');
      await bloqueadora.end();
    }
  });
});
