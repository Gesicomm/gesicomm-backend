'use strict';

jest.mock('../config/database', () => ({ query: jest.fn(), transaction: jest.fn() }));
const sequelize = require('../config/database');
const { migrarStockSalonDeposito } = require('../../scripts/migrar-stock-salon-deposito');

describe('Migración de stock al arrancar', () => {
  beforeEach(() => jest.resetAllMocks());

  test('un esquema completo no toma locks DDL ni repite el backfill', async () => {
    sequelize.query.mockResolvedValueOnce([[{ attname: 'stock_salon' }, { attname: 'stock_deposito' }, { attname: 'stock_minimo_salon' }]]);
    expect(await migrarStockSalonDeposito()).toBe(0);
    expect(sequelize.query).toHaveBeenCalledTimes(1);
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  test('crea solo las columnas faltantes con tiempo de bloqueo acotado', async () => {
    const transaction = {};
    sequelize.transaction.mockImplementation(fn => fn(transaction));
    sequelize.query.mockResolvedValueOnce([[{ attname: 'stock_salon' }, { attname: 'stock_deposito' }]]).mockResolvedValue([[], {}]);
    await migrarStockSalonDeposito();
    expect(sequelize.query).toHaveBeenCalledWith("SET LOCAL lock_timeout = '3s'", { transaction });
    const sql = sequelize.query.mock.calls.map(c => c[0]);
    expect(sql.filter(q => q.startsWith('ALTER TABLE'))).toEqual(['ALTER TABLE "productos" ADD COLUMN IF NOT EXISTS "stock_minimo_salon" INTEGER']);
    expect(sql.some(q => q.includes('UPDATE "productos"'))).toBe(false);
  });

  test('un esquema antiguo inicializa el stock dentro de la misma transacción', async () => {
    const transaction = {};
    sequelize.transaction.mockImplementation(fn => fn(transaction));
    sequelize.query.mockResolvedValueOnce([[]]).mockResolvedValue([[], { rowCount: 7 }]);
    expect(await migrarStockSalonDeposito()).toBe(7);
    expect(sequelize.query.mock.calls.slice(1).every(c => c[1].transaction === transaction)).toBe(true);
  });
});
