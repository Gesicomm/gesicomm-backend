'use strict';

/**
 * Scenario 8: los UNIQUE/FK que las pruebas mockeadas asumen tienen que
 * existir de verdad en Postgres — no solo en `indexes:` del modelo
 * Sequelize, que puede desincronizarse de lo que efectivamente corrió en
 * producción (son dos archivos distintos: el modelo y
 * scripts/migrate-planes-suscripciones.js).
 */
const { sequelize, crearSuscripcionPagada, PagoSuscripcion } = require('./helpers');

afterAll(async () => { await sequelize.close(); });

async function columnasDeConstraintsUnicos(tabla) {
  const [rows] = await sequelize.query(`
    SELECT tc.constraint_name, array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS columnas
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.table_name = :tabla AND tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
    GROUP BY tc.constraint_name
  `, { replacements: { tabla } });
  return rows.map(r => (Array.isArray(r.columnas) ? r.columnas : String(r.columnas).replace(/[{}]/g, '').split(',')).slice().sort());
}

function tieneColumnas(listas, columnas) {
  const esperado = [...columnas].sort();
  return listas.some(l => JSON.stringify(l) === JSON.stringify(esperado));
}

describe('8) Constraints reales en Postgres (no solo en el modelo Sequelize)', () => {
  it('pagos_suscripcion.referencia es UNIQUE en la base real', async () => {
    const listas = await columnasDeConstraintsUnicos('pagos_suscripcion');
    expect(tieneColumnas(listas, ['referencia'])).toBe(true);
  });

  it('suscripciones.token_registro es UNIQUE en la base real', async () => {
    const listas = await columnasDeConstraintsUnicos('suscripciones');
    expect(tieneColumnas(listas, ['token_registro'])).toBe(true);
  });

  it('usuarios.correo_electronico es UNIQUE en la base real', async () => {
    const listas = await columnasDeConstraintsUnicos('usuarios');
    expect(tieneColumnas(listas, ['correo_electronico'])).toBe(true);
  });

  it('suscripciones.usuario_id tiene una FK real hacia usuarios(id)', async () => {
    const [rows] = await sequelize.query(`
      SELECT ccu.table_name AS tabla_referenciada
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'suscripciones' AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'usuario_id'
    `);
    expect(rows.some(r => r.tabla_referenciada === 'usuarios')).toBe(true);
  });

  it('pagos_suscripcion.suscripcion_id tiene una FK real hacia suscripciones(id)', async () => {
    const [rows] = await sequelize.query(`
      SELECT ccu.table_name AS tabla_referenciada
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'pagos_suscripcion' AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'suscripcion_id'
    `);
    expect(rows.some(r => r.tabla_referenciada === 'suscripciones')).toBe(true);
  });

  it('intentar duplicar una referencia de pago falla contra la BD real, no solo en el modelo', async () => {
    const { pago, suscripcion } = await crearSuscripcionPagada({ email: `constraint.${Date.now()}@integracion.test` });

    let error;
    try {
      await PagoSuscripcion.create({
        suscripcion_id: suscripcion.id,
        referencia: pago.referencia, // misma referencia, a propósito
        estado: 'PENDING',
        monto: 1,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(error.name).toBe('SequelizeUniqueConstraintError');
    // origin: 'DB' es la prueba de que el rechazo vino de Postgres (la
    // constraint real), no de una validación en memoria de Sequelize.
    expect(error.errors[0].origin).toBe('DB');
    expect(error.errors[0].path).toBe('referencia');
  });
});
