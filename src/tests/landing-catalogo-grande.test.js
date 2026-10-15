const { Op } = require('sequelize');

jest.mock('../models', () => {
  const modelos = {};
  for (const nombre of ['Landing', 'LandingItem', 'LandingTemplate', 'LandingSeccion', 'Producto', 'ProductoCombo', 'ProductoImagen', 'ProductoVariante', 'ProductoFaq', 'ProductoOpcion', 'PrecioUsuario', 'Oferta', 'Tienda', 'Usuario']) {
    modelos[nombre] = { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn().mockResolvedValue([]), destroy: jest.fn(), bulkCreate: jest.fn() };
  }
  return modelos;
});
jest.mock('../services/pricing.service', () => ({
  aplicarDescuentoFecha: precio => precio,
  calcularPrecioBase: precio => ({ base: precio, efectivo: precio }),
}));
jest.mock('../services/stockPorTienda.service', () => ({ ajustarStockALaTienda: jest.fn().mockResolvedValue() }));
jest.mock('../services/typography.service', () => ({ resolver: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/paymentLogo.service', () => ({ resolverParaLanding: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/payments/paymentService', () => ({ getPublicGateways: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/imagen.service', () => ({ serializar: imagen => imagen }));

const { Landing, LandingItem, Producto, ProductoImagen, ProductoVariante, Tienda } = require('../models');
const Service = require('../services/landing.service');
const Simple = require('../services/landingSimple.service');

const productos = Array.from({ length: 4000 }, (_, i) => ({
  id: i + 1, slug: `prod-${i + 1}`, nombre: `Producto ${i + 1}`, precio_base: 10000,
  cantidad_disponible: 10, categoria: { nombre: i < 3900 ? 'General' : 'Final' },
}));
const items = productos.map(p => ({ tipo: 'producto', referencia_id: p.id, orden: p.id - 1, mostrar_en_inicio: true }));
const tienda = { id: 69, nombre: 'Llevalofacil', inquilino_id: 1, usuario_id: 171, activo: true, Usuario: { activo: true, correo_electronico: 'andre@gmail.com' } };
const landing = { id: 9, tienda_id: 69, tipo_pagina: 'inicio', activo: true, template: { kind: 'codigo' }, items, content: { venta: { configurado: true, seleccion: 'manual' } }, secciones: [] };

beforeEach(() => {
  jest.clearAllMocks();
  Tienda.findByPk.mockResolvedValue(tienda);
  Landing.findOne.mockResolvedValue(landing);
  Producto.findAll.mockImplementation(async ({ where }) => {
    const ids = where.id?.[Op.in];
    return ids ? productos.filter(p => ids.includes(p.id)) : [];
  });
  jest.spyOn(Service, 'whereVisibleEnTienda').mockResolvedValue({});
});

afterEach(() => jest.restoreAllMocks());

test('la portada anuncia 4000 y solo carga 100 fichas completas; la ficha 4000 sigue accesible', async () => {
  const res = await Service.obtenerPublica(tienda, null);
  expect(res.catalogo_items).toHaveLength(100);
  expect(res.content.catalogo).toEqual({ total: 4000, paginado: true });
  expect(res.categorias_catalogo.find(c => c.nombre === 'Final').cantidad).toBe(100);
  expect(ProductoVariante.findAll.mock.calls[0][0].where.producto_id[Op.in]).toHaveLength(100);

  const ficha = await Service.obtenerPublica(tienda, null, false, { asegurarContentId: 'prod-4000' });
  expect(ficha.catalogo_items).toHaveLength(101);
  expect(ficha.catalogo_items.at(-1).content_id).toBe('prod-4000');
});

test('la última página muestra el producto 4000 y consulta imágenes solo para sus 20 productos', async () => {
  const res = await Service.obtenerCatalogoPublico(tienda, null, false, { pagina: 200, porPagina: 20 });
  expect(res.paginacion).toMatchObject({ total: 4000, totalPaginas: 200 });
  expect(res.catalogo_items).toHaveLength(20);
  expect(res.catalogo_items.at(-1).content_id).toBe('prod-4000');
  expect(ProductoImagen.findAll.mock.calls[0][0].where.producto_id[Op.in]).toEqual(Array.from({ length: 20 }, (_, i) => 3981 + i));
});

test('guarda los 4000 por el servicio real y reconstruye orden y valores por defecto', async () => {
  const editable = { ...landing, save: jest.fn(), changed: jest.fn() };
  jest.spyOn(Simple, 'obtener').mockResolvedValue({ id: 9, limites: { items_manual: 5000 } });
  const compactos = items.map(({ tipo, referencia_id }) => ({ tipo, referencia_id }));
  await Simple.actualizarCodigo(editable, 69, 1, { items: compactos });
  const guardados = LandingItem.bulkCreate.mock.calls[0][0];
  expect(guardados).toHaveLength(4000);
  expect(guardados.at(-1)).toMatchObject({ referencia_id: 4000, orden: 3999, precio_ancla: null, mostrar_en_inicio: true, envio_incluido: false });
});

test('otra tienda no puede elevar el límite enviando limites en el payload', async () => {
  Tienda.findByPk.mockResolvedValue({ ...tienda, Usuario: { correo_electronico: 'otra@gmail.com' } });
  const editable = { ...landing, save: jest.fn() };
  await expect(Simple.actualizarCodigo(editable, 69, 1, { items, limites: { items_manual: 5000 } }))
    .rejects.toMatchObject({ errores: [expect.stringContaining('500 productos')] });
  expect(editable.save).not.toHaveBeenCalled();
  expect(LandingItem.destroy).not.toHaveBeenCalled();
});

test('el editor recibe el límite autorizado y consulta las colecciones sin multiplicar content', async () => {
  Landing.findOne.mockResolvedValue({ ...landing, toJSON: () => ({ ...landing }) });
  const res = await Simple.obtener(9, 69);
  expect(res.limites).toEqual({ items_manual: 5000 });
  const consulta = Landing.findOne.mock.calls[0][0];
  expect(consulta.where).toEqual({ id: 9, tienda_id: 69 });
  for (const as of ['items', 'faq', 'beneficios']) {
    expect(consulta.include.find(i => i.as === as)).toMatchObject({ separate: true, order: [['orden', 'ASC']] });
  }
  Tienda.findByPk.mockResolvedValue({ ...tienda, id: 80, nombre: 'Otra tienda' });
  expect((await Simple.obtener(9, 80)).limites.items_manual).toBe(500);
});

test('crear un lienzo también exige la excepción antes de reemplazar la página existente', async () => {
  jest.spyOn(Simple, 'obtenerTemplateLienzoBlanco').mockResolvedValue({ id: 3 });
  const crear = jest.spyOn(Simple, '_crearFila').mockResolvedValue({ id: 9 });
  jest.spyOn(Simple, 'obtener').mockResolvedValue({ id: 9 });
  Tienda.findByPk.mockResolvedValue({ ...tienda, id: 80, nombre: 'Otra tienda' });
  await expect(Simple.crearLienzoBlanco(80, 1, 'Nombre del payload', items)).rejects.toMatchObject({ errores: [expect.stringContaining('500 productos')] });
  expect(crear).not.toHaveBeenCalled();
  Tienda.findByPk.mockResolvedValue(tienda);
  await expect(Simple.crearLienzoBlanco(69, 1, tienda.nombre, items)).resolves.toEqual({ id: 9 });
  expect(LandingItem.bulkCreate.mock.calls[0][0]).toHaveLength(4000);
});
