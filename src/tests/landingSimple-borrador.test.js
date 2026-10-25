// Borrador del editor de la tienda: guardar sin publicar (sin purga de caché
// ni items), descartar, y limpiarlo solo cuando el editor publica.
jest.mock('../models', () => {
  const modelos = {};
  for (const nombre of ['Landing', 'LandingItem', 'LandingTemplate', 'LandingSeccion', 'Producto', 'ProductoCombo', 'ProductoImagen', 'ProductoVariante', 'ProductoFaq', 'ProductoOpcion', 'PrecioUsuario', 'Oferta', 'Tienda', 'Usuario']) {
    modelos[nombre] = { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn().mockResolvedValue([]), destroy: jest.fn(), bulkCreate: jest.fn() };
  }
  return modelos;
});
jest.mock('../services/stockPorTienda.service', () => ({ ajustarStockALaTienda: jest.fn().mockResolvedValue() }));
jest.mock('../services/typography.service', () => ({ resolver: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/paymentLogo.service', () => ({ guardarVisibilidadLanding: jest.fn().mockResolvedValue() }));
jest.mock('../services/cachePurge.service', () => ({ purgarLanding: jest.fn().mockResolvedValue() }));

const { Tienda } = require('../models');
const CachePurgeService = require('../services/cachePurge.service');
const LandingService = require('../services/landing.service');
const Simple = require('../services/landingSimple.service');

function landingCodigo(content = {}) {
  return {
    id: 240, tienda_id: 69, slug: 'tienda', activo: true,
    template: { kind: 'codigo' },
    content: { codigo: { html: 'publicado', css: '', js: '' }, venta: { tipo: 'catalogo' }, ...content },
    save: jest.fn().mockResolvedValue(),
    changed: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Tienda.findByPk.mockResolvedValue({ id: 69 });
  jest.spyOn(Simple, 'obtener').mockResolvedValue({ id: 240, content: {} });
  jest.spyOn(LandingService, 'sincronizarItems').mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

test('guardar borrador no toca lo publicado, ni items, ni caché', async () => {
  const landing = landingCodigo();
  jest.spyOn(Simple, 'buscarPropia').mockResolvedValue(landing);
  const datos = { codigo: { html: 'nuevo' }, venta: { tipo: 'producto' }, items: [{ tipo: 'producto', referencia_id: 1 }] };

  const r = await Simple.guardarBorrador(240, 69, datos);

  expect(r.guardado_at).toEqual(expect.any(String));
  expect(landing.content.codigo.html).toBe('publicado');
  expect(landing.content.venta.tipo).toBe('catalogo');
  expect(landing.content.borrador).toEqual({ datos, guardado_at: r.guardado_at });
  expect(landing.save).toHaveBeenCalledTimes(1);
  expect(LandingService.sincronizarItems).not.toHaveBeenCalled();
  expect(CachePurgeService.purgarLanding).not.toHaveBeenCalled();
});

test('rechaza un borrador vacío o con claves estructurales', async () => {
  jest.spyOn(Simple, 'buscarPropia').mockResolvedValue(landingCodigo());
  await expect(Simple.guardarBorrador(240, 69, null)).rejects.toThrow();
  await expect(Simple.guardarBorrador(240, 69, { template_id: 3 })).rejects.toThrow(/estructura/);
});

test('solo existe en el lienzo (template de código)', async () => {
  jest.spyOn(Simple, 'buscarPropia').mockResolvedValue({ ...landingCodigo(), template: { kind: 'rigido' } });
  await expect(Simple.guardarBorrador(240, 69, { venta: {} })).rejects.toMatchObject({ errores: [expect.stringMatching(/editor de la tienda/)] });
});

test('descartar quita el borrador y deja lo publicado', async () => {
  const landing = landingCodigo({ borrador: { datos: { venta: {} }, guardado_at: 'x' } });
  jest.spyOn(Simple, 'buscarPropia').mockResolvedValue(landing);
  expect(await Simple.descartarBorrador(240, 69)).toEqual({ descartado: true });
  expect(landing.content.borrador).toBeUndefined();
  expect(landing.content.codigo.html).toBe('publicado');
});

test('publicar desde el editor (limpiar_borrador) lo borra; un guardado sin la marca lo conserva', async () => {
  const conMarca = landingCodigo({ borrador: { datos: {}, guardado_at: 'x' } });
  await Simple.actualizarCodigo(conMarca, 69, 1, { venta: { tipo: 'producto' }, limpiar_borrador: true });
  expect(conMarca.content.borrador).toBeUndefined();
  expect(conMarca.content.venta).toBeTruthy();

  const sinMarca = landingCodigo({ borrador: { datos: {}, guardado_at: 'x' } });
  await Simple.actualizarCodigo(sinMarca, 69, 1, { codigo: { html: '<main>mcp</main>', css: '', js: '' } });
  expect(sinMarca.content.borrador).toEqual({ datos: {}, guardado_at: 'x' });
});
