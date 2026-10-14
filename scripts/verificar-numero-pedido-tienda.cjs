'use strict';

// Ejecuta el SQL real en un esquema aislado y revierte todo al terminar.
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const db = require('../src/config/database');
db.options.logging = false;
const { migrarNumeroPedidoTienda } = require('./migrar-numero-pedido-tienda');
const { reservarNumeroPedidoTienda } = require('../src/services/pedidoNumeracion.service');
const { filtroNumeroPedidoVisible } = require('../src/services/pedidoIdentificador.service');

async function verificar() {
  const transaction = await db.transaction();
  try {
    const schema = `test_numeracion_${Date.now()}`;
    const query = sql => db.query(sql, { transaction });
    await query(`CREATE SCHEMA "${schema}"`);
    await query(`SET LOCAL search_path TO "${schema}"`);
    await query(`CREATE TABLE tiendas (id INTEGER PRIMARY KEY, usuario_id INTEGER, nombre TEXT)`);
    await query(`CREATE TABLE envios (id INTEGER PRIMARY KEY, usuario_id INTEGER, tienda_id INTEGER,
      numero_pedido INTEGER, created_at TIMESTAMPTZ)`);
    await query(`INSERT INTO tiendas VALUES (1, 7, 'Otra tienda'), (2, 7, 'Alibaguay')`);
    await query(`INSERT INTO envios VALUES
      (1, 7, 1, 1, '2026-10-10'), (2, 7, 1, 2, '2026-10-11'),
      (3, 7, 2, 3, '2026-10-12'), (4, 7, 2, 4, '2026-10-14')`);
    const facade = { transaction: fn => fn(transaction), query: db.query.bind(db) };
    await migrarNumeroPedidoTienda(facade);
    const [rows] = await query(`SELECT id, numero_pedido_tienda FROM envios ORDER BY id`);
    assert.deepEqual(rows.map(r => r.numero_pedido_tienda), [1, 2, 1, 2]);
    await migrarNumeroPedidoTienda(facade);
    const sql = db.getQueryInterface().queryGenerator.selectQuery('envios', {
      where: filtroNumeroPedidoVisible('ALI-1001'),
    }, { name: 'Envio' });
    const [encontrados] = await query(sql);
    assert.deepEqual(encontrados.map(r => r.id), [3]);
    assert.equal(await reservarNumeroPedidoTienda(2, transaction), 3);
    assert.equal(await reservarNumeroPedidoTienda(1, transaction), 3);
    await query('DELETE FROM envios WHERE id = 4');
    await migrarNumeroPedidoTienda(facade);
    assert.equal(await reservarNumeroPedidoTienda(2, transaction), 4);
    console.log('OK: secuencia por tienda, backfill, búsqueda, reejecución y eliminación sin reutilizar números.');
  } finally {
    await transaction.rollback();
  }
}

verificar().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close());
