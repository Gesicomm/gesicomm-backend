const { Op } = require('sequelize');

// "Vender todo el catálogo" (content.venta.seleccion='todos'): no hay
// LandingItem, los productos salen de itemsSegunReglaCodigo() sin límite
// (ver landing.service.js). Con un catálogo chico esto no importa, pero
// con miles de productos (caso real: Llevalofacil, tienda 69, ~3630
// productos) el código tumbó el backend por OOM el 2026-10-16: la
// paginación de "primera página completa" (primeraPaginaLienzo /
// PRIMERA_PAGINA_LIENZO) se saltaba a propósito cuando los items venían
// de una regla (itemsFallbackCodigo truthy), así que CADA vista de la
// landing (pública o el preview del editor) hidrataba en Sequelize el
// catálogo ENTERO (galería, variantes, opciones, FAQ, ofertas anidadas).
jest.mock('../models', () => {
  const modelos = {};
  for (const nombre of ['Landing', 'LandingItem', 'LandingTemplate', 'LandingSeccion', 'Producto', 'ProductoCombo', 'ProductoImagen', 'ProductoVariante', 'ProductoFaq', 'ProductoOpcion', 'PrecioUsuario', 'Oferta', 'Tienda', 'Usuario']) {
    modelos[nombre] = { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn().mockResolvedValue([]), destroy: jest.fn(), bulkCreate: jest.fn() };
  }
  return modelos;
});
jest.mock('../services/pricing.service', () => ({
  aplicarDescuentoFecha: precio => precio,
  precioConDescuentoVigente: (precioLista, precioUsuario) => (precioUsuario ?? precioLista),
  calcularPrecioBase: precio => ({ base: precio, efectivo: precio }),
}));
jest.mock('../services/stockPorTienda.service', () => ({ ajustarStockALaTienda: jest.fn().mockResolvedValue() }));
jest.mock('../services/typography.service', () => ({ resolver: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/paymentLogo.service', () => ({ resolverParaLanding: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/payments/paymentService', () => ({ getPublicGateways: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/imagen.service', () => ({ serializar: imagen => imagen }));

const { Landing, Producto, ProductoImagen, ProductoVariante, ProductoFaq, ProductoOpcion, Tienda } = require('../models');
const Service = require('../services/landing.service');

const TOTAL_PRODUCTOS = 3630;
const productos = Array.from({ length: TOTAL_PRODUCTOS }, (_, i) => ({
  id: i + 1, slug: `prod-${i + 1}`, nombre: `Producto ${i + 1}`, precio_base: 10000,
  cantidad_disponible: 10, created_at: new Date(2026, 0, (i % 28) + 1),
  categoria: { nombre: i < TOTAL_PRODUCTOS - 100 ? 'General' : 'Final' },
}));

const tienda = { id: 69, nombre: 'Llevalofacil', inquilino_id: 1, usuario_id: 171, activo: true, Usuario: { activo: true, correo_electronico: 'andre@gmail.com' } };
const landing = {
  id: 140, tienda_id: 69, tipo_pagina: 'inicio', activo: true, template: { kind: 'codigo' },
  items: [], content: { venta: { configurado: true, seleccion: 'todos' } }, secciones: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  Tienda.findByPk.mockResolvedValue(tienda);
  Landing.findOne.mockResolvedValue(landing);
  // Sin `where.id`: es itemsSegunReglaCodigo evaluando la regla contra TODO
  // el catálogo de la tienda (no tiene (ni debe tener) límite). Con
  // `where.id`: es una consulta acotada a un lote de ids puntual.
  Producto.findAll.mockImplementation(async ({ where }) => {
    const ids = where?.id?.[Op.in];
    return ids ? productos.filter(p => ids.includes(p.id)) : productos;
  });
  jest.spyOn(Service, 'whereVisibleEnTienda').mockResolvedValue({});
});

afterEach(() => jest.restoreAllMocks());

test('"vender todo el catálogo" con miles de productos no hidrata el catálogo entero', async () => {
  const res = await Service.obtenerPublica(tienda, null);

  expect(res.content.catalogo).toEqual({ total: TOTAL_PRODUCTOS, paginado: true });
  expect(res.categorias_catalogo.find(c => c.nombre === 'Final').cantidad).toBe(100);

  // La consulta PESADA (galería/variantes/opciones/FAQ/ofertas) tiene que
  // pedir solo la primera página, nunca los 3630 productos.
  const idsPedidosVariantes = ProductoVariante.findAll.mock.calls[0][0].where.producto_id[Op.in];
  expect(idsPedidosVariantes.length).toBeLessThan(TOTAL_PRODUCTOS / 10);
  expect(ProductoFaq.findAll.mock.calls[0][0].where.producto_id[Op.in]).toEqual(idsPedidosVariantes);
  expect(ProductoOpcion.findAll.mock.calls[0][0].where.producto_id[Op.in]).toEqual(idsPedidosVariantes);
  // primeraPaginaLienzo también pide ProductoImagen (una foto por categoría,
  // liviano); ninguna llamada —ni esa ni la del enriquecimiento— pide fotos
  // de los 3630 productos.
  ProductoImagen.findAll.mock.calls.forEach((llamada) => {
    expect(llamada[0].where.producto_id[Op.in].length).toBeLessThan(TOTAL_PRODUCTOS / 10);
  });
});

test('la ficha de un producto fuera de la primera página sigue completa', async () => {
  const res = await Service.obtenerPublica(tienda, null, false, { asegurarContentId: 'prod-3630' });
  expect(res.catalogo_items.some(i => i.content_id === 'prod-3630')).toBe(true);
});
