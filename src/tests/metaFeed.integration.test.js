'use strict';
const habilitado = Boolean(process.env.META_FEED_TEST_DATABASE_URL);
// Run separately with explicit local PostgreSQL; normal npm test stays self-contained.
const suite = habilitado ? describe : describe.skip;
jest.mock('../models', () => process.env.META_FEED_TEST_DATABASE_URL ? require('./fixtures/metaFeedDb') : {});
jest.mock('../config/database', () => process.env.META_FEED_TEST_DATABASE_URL ? require('./fixtures/metaFeedDb').sequelize : {});
jest.mock('../services/landing.service', () => process.env.META_FEED_TEST_DATABASE_URL ? require('./fixtures/metaFeedDb') : {});
jest.mock('../services/metaFeedProjection.service', () => ({ leerLote: async (tienda, fuente, items) => {
  const db = require('./fixtures/metaFeedDb');
  return (await db.obtenerProductosPublicos(tienda, fuente.slug, items.map(i => i.content_id))).items;
} }));
jest.mock('../models/MetaFeed', () => {
  if (!process.env.META_FEED_TEST_DATABASE_URL) return {};
  return jest.requireActual('../models/MetaFeed');
});

suite('Feed URL — PostgreSQL aislado, selección por landing y archivos completos', () => {
  let db, Feed, Config, directorio;
  const fs = require('fs/promises');
  const os = require('os');
  const path = require('path');
  beforeAll(async () => {
    directorio = await fs.mkdtemp(path.join(os.tmpdir(), 'gesicomm-meta-feed-test-'));
    process.env.META_FEED_DIR = directorio;
    db = require('./fixtures/metaFeedDb');
    Config = require('../models/MetaFeed');
    Feed = require('../services/metaFeed.service');
    await db.sequelize.sync({ force: true });
    await require('../../migrations/20261016200000-meta-feed-url').up(db.sequelize.getQueryInterface());
  });
  afterAll(async () => {
    if (db) await db.sequelize.close();
    // Only test-created files in our fresh OS temp directory.
    if (directorio) { for (const name of await fs.readdir(directorio)) await fs.unlink(path.join(directorio, name)); await fs.rmdir(directorio); }
    delete process.env.META_FEED_DIR;
  });
  beforeEach(async () => {
    await db.sequelize.query('TRUNCATE meta_feeds, landing_items, landings, landing_templates, productos, tiendas, usuarios RESTART IDENTITY CASCADE');
    await require('../../migrations/20261016210000-repair-meta-feed-landing').up(db.sequelize.getQueryInterface());
    db.ajustes.clear(); db.llamadas.length = 0; db.setFalla(false);
    await db.Usuario.bulkCreate([{ id: 1, activo: true }, { id: 2, activo: true }]);
    await db.Tienda.bulkCreate([{ id: 1, usuario_id: 1, inquilino_id: 1, activo: true, nombre: 'Uno', subdominio: 'uno' }, { id: 2, usuario_id: 2, inquilino_id: 1, activo: true, nombre: 'Dos', subdominio: 'dos' }]);
    await db.LandingTemplate.create({ id: 1, kind: 'codigo' });
    await db.Landing.bulkCreate([{ id: 11, tienda_id: 1, activo: true, es_home: true, slug: 'uno', template_id: 1 }, { id: 22, tienda_id: 2, activo: true, es_home: true, slug: 'dos', template_id: 1 }]);
    await db.Producto.bulkCreate([1,2,3].map(id => ({ id, slug: `p-${id}`, nombre: `Producto ${id}`, inquilino_id: 1, activo: true, estado_venta: 'en_venta' })));
    await db.LandingItem.bulkCreate([{ landing_id: 11, tipo: 'producto', referencia_id: 1 }, { landing_id: 22, tipo: 'producto', referencia_id: 1 }, { landing_id: 22, tipo: 'producto', referencia_id: 2 }]);
    await Config.bulkCreate([{ tienda_id: 1, landing_id: 11, activo: true }, { tienda_id: 2, landing_id: 22, activo: true }]);
  });
  async function csv(id) { return fs.readFile(path.join(directorio, `${id}.csv`), 'utf8'); }
  test('dos tiendas comparten un artículo con precio y enlace propios; ningún producto general se filtra', async () => {
    await Feed.generar(11); await Feed.generar(22);
    const uno = await csv(11), dos = await csv(22);
    expect(uno).toContain('100000 PYG'); expect(uno).toContain('https://uno.gesicomm.com/p-1');
    expect(dos).toContain('150000 PYG'); expect(dos).toContain('https://dos.gesicomm.com/p-1');
    expect(uno).not.toContain('p-2'); expect(uno + dos).not.toContain('p-3');
    expect(db.llamadas.every(c => c.tienda === 1 ? c.slug === 'uno' : c.slug === 'dos')).toBe(true);
  });
  test('no permite administrar la tienda de otro propietario', async () => {
    await expect(Feed.tiendaPrivada({ tiendaId: 2, id: 1, tenantId: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(Feed.tiendaPrivada({ tiendaId: 1, id: 1, tenantId: 2 })).rejects.toMatchObject({ status: 404 });
  });
  test('el enlace usa el dominio de cada tienda y refleja un cambio de dominio propio', async () => {
    const t = await db.Tienda.findByPk(1, { include: db.Usuario }); t.feed_landing_id = 11;
    expect((await Feed.estado(t)).url).toBe('https://uno.gesicomm.com/api/l/feed-productos.csv?landing=11');
    t.dominio_propio_verificado = true; t.dominio_propio_habilitado = true; t.dominio_propio = 'dominio-propio.example';
    expect((await Feed.estado(t)).url).toBe('https://dominio-propio.example/api/l/feed-productos.csv?landing=11');
    const otra = await db.Tienda.findByPk(2, { include: db.Usuario }); otra.feed_landing_id = 22;
    expect((await Feed.estado(otra)).url).toBe('https://dos.gesicomm.com/api/l/feed-productos.csv?landing=22');
  });
  test('nuevos productos generales no entran; añadir o quitar en la landing cambia solo su exportación', async () => {
    await db.Producto.create({ id: 4, slug: 'nuevo', nombre: 'Nuevo', inquilino_id: 1, activo: true, estado_venta: 'en_venta' });
    await Feed.generar(11); expect(await csv(11)).not.toContain('nuevo');
    await db.LandingItem.create({ landing_id: 11, tipo: 'producto', referencia_id: 4 });
    await Feed.generar(11); expect(await csv(11)).toContain('nuevo');
    await db.LandingItem.destroy({ where: { landing_id: 11, referencia_id: 1 } });
    await Feed.generar(11); expect(await csv(11)).not.toContain('p-1');
    await Feed.generar(22); expect(await csv(22)).toContain('p-1'); expect(await csv(22)).not.toContain('nuevo');
  });
  test('un cambio de slug conserva el ID de eventos y feed', async () => {
    await db.Producto.update({ slug: 'nombre-nuevo', meta_content_id: 'no-cambiar' }, { where: { id: 1 } });
    expect((await db.Producto.findByPk(1)).meta_content_id).toBe('p-1');
    await Feed.generar(11); expect(await csv(11)).toContain('https://uno.gesicomm.com/p-1');
  });
  test('stock general y reposición se reflejan en ambas; precio particular afecta únicamente una', async () => {
    db.ajustes.set('1:1', { stock: 0, precio: 90000 }); db.ajustes.set('2:1', { stock: 0 });
    await Feed.generar(11); await Feed.generar(22);
    expect(await csv(11)).toContain('out of stock,new,90000 PYG');
    expect(await csv(22)).toContain('out of stock,new,150000 PYG');
    db.ajustes.set('1:1', { stock: 8, precio: 100000 }); db.ajustes.set('2:1', { stock: 8 });
    await Feed.generar(11); expect(await csv(11)).toContain('in stock,new,100000 PYG');
  });
  test('interrupción o lectura incompleta conserva el archivo anterior; reintentos no duplican artículos', async () => {
    await Feed.generar(11); const anterior = await csv(11);
    db.setFalla(true); await expect(Feed.generar(11)).rejects.toThrow('Interrupción'); expect(await csv(11)).toBe(anterior);
    db.setFalla(false); await Feed.generar(11); await Feed.generar(11);
    expect((await csv(11)).split('\r\n').filter(Boolean)).toHaveLength(2);
    expect((await Config.findOne({ where: { landing_id: 11 } })).revision_generada).toBe(1);
  });
  test('pausar no emite un CSV vacío y no destruye el archivo ya generado', async () => {
    await Feed.generar(11); const anterior = await csv(11);
    const t = await db.Tienda.findByPk(1, { include: db.Usuario }); t.feed_landing_id = 11;
    await Feed.activar(t, false);
    await expect(Feed.archivoPublico(t)).rejects.toMatchObject({ status: 503 }); expect(await csv(11)).toBe(anterior);
  });
  test('repara el esquema anterior, conserva filas y permite varias landings de una tienda', async () => {
    await Config.destroy({ where: {} });
    await db.Tienda.create({ id: 3, usuario_id: 2, inquilino_id: 1, activo: true });
    await db.sequelize.query('ALTER TABLE meta_feeds DROP COLUMN landing_id CASCADE; ALTER TABLE meta_feeds ADD CONSTRAINT meta_feeds_tienda_id_key UNIQUE(tienda_id)');
    await db.sequelize.query('INSERT INTO meta_feeds (tienda_id,activo,created_at,updated_at) VALUES (1,TRUE,NOW(),NOW()),(3,TRUE,NOW(),NOW())');
    const repair = require('../../migrations/20261016210000-repair-meta-feed-landing');
    await repair.up(db.sequelize.getQueryInterface());
    await repair.up(db.sequelize.getQueryInterface());
    const [rows] = await db.sequelize.query('SELECT tienda_id, landing_id, activo FROM meta_feeds ORDER BY tienda_id');
    expect(rows).toEqual([{ tienda_id: 1, landing_id: 11, activo: true }, { tienda_id: 3, landing_id: null, activo: false }]);
    await db.Landing.create({ id: 33, tienda_id: 1, activo: true, slug: 'otra' });
    await Config.create({ tienda_id: 1, landing_id: 33 });
    expect(await Config.count({ where: { tienda_id: 1 } })).toBe(2);
  });
  test.each([500,1000,2000])('exporta %i artículos en lotes comerciales acotados, sin duplicados', async cantidad => {
    await db.Producto.bulkCreate(Array.from({ length: cantidad-3 }, (_,n) => ({ id: n+4, slug: `p-${n+4}`, nombre: `Producto ${n+4}`, inquilino_id: 1, activo: true, estado_venta: 'en_venta' })));
    await db.LandingItem.destroy({ where: { landing_id: 11 } });
    await db.LandingItem.bulkCreate(Array.from({ length: cantidad }, (_,n) => ({ landing_id: 11, tipo: 'producto', referencia_id: n+1 })));
    const inicio = Date.now(); await Feed.generar(11);
    const lineas = (await csv(11)).trim().split('\r\n').slice(1);
    expect(lineas).toHaveLength(cantidad); expect(new Set(lineas.map(l=>l.split(',')[0])).size).toBe(cantidad);
    expect(db.llamadas.every(c => c.ids.length <= 500)).toBe(true);
    console.log(`META_FEED_${cantidad}: ${Date.now()-inicio} ms, ${db.llamadas.length} lotes`);
  }, 30000);
});
