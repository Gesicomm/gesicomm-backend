jest.mock('../../config/database', () => {
  const { Sequelize } = require('sequelize');
  return new Sequelize('speedbox_test', 'test', 'test', { dialect: 'postgres', logging: false });
});
const S = require('sequelize');
const migration = require('../../../migrations/20261002150000-speedbox-integration');
const models = [require('../../models/SpeedboxTienda'), require('../../models/SpeedboxPedido'), require('../../models/SpeedboxEvento')];
let qi, tables, indexes, transaction;
beforeEach(() => {
  tables = new Map(); indexes = new Map(); transaction = { commit: jest.fn(), rollback: jest.fn() };
  qi = {
    sequelize: { transaction: jest.fn(async () => transaction), query: jest.fn() },
    showAllTables: jest.fn(async () => [...tables.keys()]),
    createTable: jest.fn(async (name, columns) => { tables.set(name, columns); indexes.set(name, []); }),
    showIndex: jest.fn(async name => indexes.get(name) || []),
    addIndex: jest.fn(async (name, fields, options) => { indexes.get(name).push({ ...options, fields }); }),
  };
});
it('creates every model column with the correct storage type', async () => {
  await migration.up(qi, S);
  for (const model of models) {
    const columns = tables.get(model.tableName);
    expect(Object.keys(columns).sort()).toEqual(Object.keys(model.rawAttributes).sort());
    for (const [key, attribute] of Object.entries(model.rawAttributes)) {
      expect(columns[key].type.key).toBe(attribute.type.key);
      if (attribute.type.key === 'STRING') expect(columns[key].type.options.length).toBe(attribute.type.options.length);
    }
  }
  expect(transaction.commit).toHaveBeenCalledTimes(1);
});
it('can be run repeatedly during startup without recreating tables or indexes', async () => {
  await migration.up(qi, S);
  const originalIndexes = qi.addIndex.mock.calls.length;
  await migration.up(qi, S);
  expect(qi.createTable).toHaveBeenCalledTimes(3);
  expect(qi.addIndex).toHaveBeenCalledTimes(originalIndexes);
  expect(qi.sequelize.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
});
it('rolls back the schema change if an index fails', async () => {
  qi.addIndex.mockRejectedValueOnce(new Error('Index failed'));
  await expect(migration.up(qi, S)).rejects.toThrow('Index failed');
  expect(transaction.rollback).toHaveBeenCalledTimes(1);
  expect(transaction.commit).not.toHaveBeenCalled();
});
