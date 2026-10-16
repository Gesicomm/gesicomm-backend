'use strict';

jest.mock('../models', () => ({
  Landing: { findByPk: jest.fn(), findOne: jest.fn() },
  LandingItem: {}, LandingTemplate: {}, Tienda: {},
  Producto: { findAll: jest.fn() }, ProductoCombo: { findAll: jest.fn() },
  ProductoVariante: { findAll: jest.fn() },
}));
for (const modulo of [
  '../services/pricing.service', '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/imagen.service',
  '../services/payments/pagoParService', '../services/payments/confirmacionPago',
  '../services/redFulfillment.service', '../services/builderPublicPage.service',
  '../utils/rangoFechas', '../utils/historial',
]) jest.mock(modulo, () => ({}));
jest.mock('../services/metaCapi.service', () => ({ enviarEvento: jest.fn().mockResolvedValue({ enviado: false }) }));

const { Landing, Producto, ProductoVariante } = require('../models');
const Service = require('../services/landing.service');
const ctrl = require('../controllers/landingPublica.controller');
const MetaCapi = require('../services/metaCapi.service');

beforeEach(() => {
  jest.clearAllMocks();
  Landing.findOne.mockResolvedValue({ id: 140, activo: true });
});
afterEach(() => jest.restoreAllMocks());

function resFake() {
  return { status(codigo) { this.codigo = codigo; return this; }, json(body) { this.body = body; return this; } };
}

test('recargar la página conserva PageView y no consulta el catálogo', async () => {
  const catalogo = jest.spyOn(Service, 'obtenerCatalogoParaEvento');
  const res = resFake();
  await ctrl.registrarEvento({
    tienda: { id: 69, usuario_id: 171 }, params: {}, headers: {}, cookies: {},
    body: { event_name: 'PageView', event_id: 'recarga-publicada', event_source_url: 'https://tienda.test/' },
  }, res);
  expect(res.codigo).toBe(202);
  expect(catalogo).not.toHaveBeenCalled();
  expect(Landing.findByPk).not.toHaveBeenCalled();
  expect(MetaCapi.enviarEvento).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    event_name: 'PageView', event_id: 'recarga-publicada', landing_id: 140,
  }));
});

test('el servicio tampoco lee content para un evento sin productos', async () => {
  expect(await Service.obtenerCatalogoParaEvento(140, [])).toEqual(new Map());
  expect(Landing.findByPk).not.toHaveBeenCalled();
});

test('el SQL real de Sequelize elimina el JOIN que repetía content por cada item', async () => {
  const { Sequelize, DataTypes } = require('sequelize');
  const db = new Sequelize({ dialect: 'postgres', database: 'memoria_test', username: 'test', logging: false });
  const LandingSql = db.define('LandingSql', { content: DataTypes.JSONB }, { tableName: 'landings_test', timestamps: false });
  const ItemSql = db.define('ItemSql', { landing_id: DataTypes.INTEGER }, { tableName: 'landing_items_test', timestamps: false });
  LandingSql.hasMany(ItemSql, { as: 'items', foreignKey: 'landing_id' });
  // Interceptar antes de llegar a PostgreSQL: se prueba el generador real
  // sin abrir conexiones ni asignar gigabytes para reproducir la caída.
  const consultar = jest.spyOn(db, 'query').mockResolvedValue(null);
  try {
    await LandingSql.findByPk(140, { attributes: ['id', 'content'], include: [{ model: ItemSql, as: 'items' }] });
    const sqlAnterior = consultar.mock.calls[0][0];
    consultar.mockClear();
    await LandingSql.findByPk(140, { attributes: ['id', 'content'], include: [{ model: ItemSql, as: 'items', separate: true }] });
    const sqlCorregido = consultar.mock.calls[0][0];
    expect(sqlAnterior).toContain('JOIN "landing_items_test"');
    expect(sqlAnterior).toContain('"content"');
    expect(sqlCorregido).not.toContain('JOIN');
    expect(sqlCorregido).toContain('"content"');
  } finally {
    await db.close();
  }
});

test('la validación de productos separa los items del content grande y mantiene nombre y variantes', async () => {
  Landing.findByPk.mockResolvedValue({
    id: 140, content: { codigo: { html: 'x'.repeat(1024 * 1024) } },
    items: Array.from({ length: 3630 }, (_, i) => ({ tipo: 'producto', referencia_id: i + 1, orden: i })),
    template: { kind: 'codigo' }, Tienda: { usuario_id: 171, inquilino_id: 7 },
  });
  jest.spyOn(Service, 'itemsDelLienzo').mockResolvedValue([{ tipo: 'producto', referencia_id: 1770 }]);
  Producto.findAll.mockResolvedValue([{ id: 1770, slug: 'air-fryer', nombre: 'Air Fryer' }]);
  ProductoVariante.findAll.mockResolvedValue([{ producto_id: 1770, nombre: 'Negro' }]);
  const catalogo = await Service.obtenerCatalogoParaEvento(140, ['air-fryer']);
  expect(Landing.findByPk.mock.calls[0][1].include.find(i => i.as === 'items'))
    .toMatchObject({ separate: true, order: [['orden', 'ASC']] });
  expect(Service.itemsDelLienzo).toHaveBeenCalledWith(expect.anything(), expect.anything(), { contentIds: ['air-fryer'] });
  expect(catalogo.get('air-fryer')).toEqual({ nombre: 'Air Fryer', variantes: new Set(['Negro']) });
});

test('ViewContent sigue validando la identidad del producto antes de registrar el evento', async () => {
  const catalogo = jest.spyOn(Service, 'obtenerCatalogoParaEvento').mockResolvedValue(new Map([
    ['air-fryer', { nombre: 'Air Fryer', variantes: new Set() }],
  ]));
  const res = resFake();
  await ctrl.registrarEvento({
    tienda: { id: 69 }, params: {}, headers: {}, cookies: {},
    body: { event_name: 'ViewContent', event_id: 'ficha-publicada',
      custom_data: { content_ids: ['air-fryer'], content_name: 'Nombre inventado' } },
  }, res);
  expect(catalogo).toHaveBeenCalledWith(140, ['air-fryer']);
  expect(MetaCapi.enviarEvento).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    custom_data: { content_ids: ['air-fryer'], content_name: 'Air Fryer' },
  }));
  expect(res.codigo).toBe(202);
});
