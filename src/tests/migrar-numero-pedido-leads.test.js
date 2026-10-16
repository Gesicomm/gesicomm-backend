'use strict';
jest.mock('../models', () => ({ sequelize: {
  query: jest.fn(async () => []),
  transaction: async callback => callback('TX'),
} }));
const { sequelize } = require('../models');
const { migrarNumeroPedido } = require('../../scripts/migrar-numero-pedido');

test('el arranque conserva la numeración opcional de los leads en cuenta y tienda', async () => {
  await migrarNumeroPedido();
  const queries = sequelize.query.mock.calls.map(([sql]) => sql);
  expect(queries.some(sql => /numero_pedido"\s+SET NOT NULL/.test(sql))).toBe(false);
  expect(queries.some(sql => /numero_pedido"\s+DROP NOT NULL/.test(sql))).toBe(true);
  const backfills = queries.filter(sql => /UPDATE\s+"?envios"?\s+e\s+SET\s+"?numero_pedido/.test(sql));
  expect(backfills).toHaveLength(2);
  expect(backfills.every(sql => /(?:e\.)?es_lead = false/.test(sql))).toBe(true);
});
