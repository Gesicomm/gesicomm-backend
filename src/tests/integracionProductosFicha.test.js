/**
 * integracionProductos.service — la API de proveedores tiene que poder
 * cargar la FICHA de producto del lienzo en blanco, no solo nombre/precio/
 * stock: si la ficha no entra por acá, el producto aparece en el catálogo
 * pero su página queda sin propuesta de valor, sin beneficios, sin
 * confianza, sin opiniones y sin preguntas (los bloques se ocultan solos).
 *
 * Lo que se verifica es el mapeo a los TRES destinos que tiene la ficha en
 * el producto, que es donde los lee `presentacionComercial` en el frontend:
 * columnas propias, `ficha_datos` (insignia/opiniones) y
 * `ficha_datos.presentacion` (textos de bloque), más `producto_faqs`.
 */

jest.mock('../models', () => {
  const transaction = {};
  return {
    sequelize: { transaction: jest.fn(async (cb) => cb(transaction)) },
    Tienda: { findOne: jest.fn() },
    Categoria: { findOne: jest.fn(async () => null), create: jest.fn(async () => ({ id: 5 })) },
    Marca: { findOne: jest.fn(async () => null), create: jest.fn(async () => ({ id: 6 })) },
    Producto: { findOne: jest.fn(async () => ({ ficha_datos: {} })) },
    ProductoImagen: { destroy: jest.fn(async () => 0), bulkCreate: jest.fn(async () => []) },
    IntegracionCredencial: { findOne: jest.fn(async () => null) },
    IntegracionProducto: { findOne: jest.fn(async () => null), create: jest.fn(async () => ({ id: 1 })) },
    IntegracionEvento: { create: jest.fn(async () => ({ id: 1 })), findOne: jest.fn(async () => null) },
    __transaction: transaction,
  };
});

jest.mock('../services/producto.service', () => ({
  crear: jest.fn(async () => ({ id: 99, slug: 'producto-99', activo: true })),
  actualizar: jest.fn(async () => ({ id: 99, slug: 'producto-99', activo: true })),
  validarSku: jest.fn(async (sku) => sku),
  sincronizarFaq: jest.fn(async () => null),
}));

const { Producto, IntegracionProducto } = require('../models');
const ProductoService = require('../services/producto.service');
const Service = require('../services/integracionProductos.service');

const INTEGRACION = { id: 3, inquilinoId: 1, tiendaId: 4, usuarioId: 7, codigo: 'erp-propio' };

const BASE = { sku: 'ABC-1', nombre: 'Proteína Whey', precio: 250000, stock: 10 };

const FICHA = {
  insignia: 'MÁS VENDIDO',
  propuesta_valor: 'Recuperación muscular en 30 días',
  beneficios: [
    { titulo: '24 g de proteína', texto: 'Por porción' },
    'Sin azúcar agregada',
  ],
  confianza: [{ titulo: 'Envío en 24 h', texto: 'En todo Asunción' }],
  preguntas: [{ pregunta: '¿Cuántas porciones trae?', respuesta: '30 porciones.' }],
  preguntas_titulo: 'Dudas frecuentes',
  opiniones: [
    { nombre: 'Lucía G.', comentario: 'Se disuelve bien y rinde.', calificacion: 5, detalle: 'Google Reviews' },
    { nombre: 'Sin comentario' },
  ],
  textos: { beneficios_titulo: 'Por qué la eligen', opiniones_kicker: 'Opiniones reales' },
  incluye_pedido: ['1 pote de 900 g', { texto: 'Medidor incluido' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  IntegracionProducto.findOne.mockResolvedValue(null);
  Producto.findOne.mockResolvedValue({ ficha_datos: {} });
});

describe('alta de un producto con ficha', () => {
  it('manda la ficha a las columnas del producto, a ficha_datos y a producto_faqs', async () => {
    await Service.upsertProducto(INTEGRACION, { ...BASE, ficha: FICHA });

    const datos = ProductoService.crear.mock.calls[0][0];
    expect(datos.propuesta_valor).toBe('Recuperación muscular en 30 días');
    expect(datos.beneficios).toEqual([
      { titulo: '24 g de proteína', texto: 'Por porción', icono: null },
      { titulo: 'Sin azúcar agregada', texto: '', icono: null },
    ]);
    expect(datos.confianza).toEqual([{ icono: '', titulo: 'Envío en 24 h', texto: 'En todo Asunción' }]);
    expect(datos.faq_titulo).toBe('Dudas frecuentes');
    expect(datos.preguntas_frecuentes).toEqual([{ pregunta: '¿Cuántas porciones trae?', respuesta: '30 porciones.' }]);

    // La etiqueta de la tarjeta del catálogo es ficha_datos.insignia, NO la
    // descripción corta (ver el contrato de la ficha del lienzo).
    expect(datos.ficha_datos.insignia).toBe('MÁS VENDIDO');
    // Una opinión sin comentario no es una opinión: queda afuera.
    expect(datos.ficha_datos.product_page_opiniones).toEqual([
      { nombre: 'Lucía G.', comentario: 'Se disuelve bien y rinde.', detalle: 'Google Reviews', calificacion: 5, foto: '' },
    ]);
    expect(datos.ficha_datos.presentacion).toEqual({
      beneficios_titulo: 'Por qué la eligen',
      opiniones_kicker: 'Opiniones reales',
      incluye_pedido: [{ texto: '1 pote de 900 g' }, { texto: 'Medidor incluido' }],
    });

    expect(ProductoService.sincronizarFaq).toHaveBeenCalledWith(
      99, 1, [{ pregunta: '¿Cuántas porciones trae?', respuesta: '30 porciones.' }], expect.anything(),
    );
  });

  it('sin "ficha" no inventa nada: el producto entra sin contenido de ficha', async () => {
    await Service.upsertProducto(INTEGRACION, BASE);
    const datos = ProductoService.crear.mock.calls[0][0];
    expect(datos.propuesta_valor).toBeUndefined();
    expect(datos.beneficios).toBeUndefined();
    expect(datos.ficha_datos).toBeUndefined();
    expect(ProductoService.sincronizarFaq).not.toHaveBeenCalled();
  });

  it('rechaza una ficha mal armada en vez de guardarla a medias', async () => {
    await expect(Service.upsertProducto(INTEGRACION, { ...BASE, ficha: [] }))
      .rejects.toMatchObject({ codigo: 'FICHA_INVALIDA' });
    await expect(Service.upsertProducto(INTEGRACION, { ...BASE, ficha: { beneficios: 'uno, dos' } }))
      .rejects.toMatchObject({ codigo: 'FICHA_BENEFICIOS_INVALIDOS' });
    await expect(Service.upsertProducto(INTEGRACION, { ...BASE, ficha: { textos: { titulo_inventado: 'x' } } }))
      .rejects.toMatchObject({ codigo: 'FICHA_TEXTOS_INVALIDOS' });
    expect(ProductoService.crear).not.toHaveBeenCalled();
  });
});

describe('actualización de un producto ya sincronizado', () => {
  beforeEach(() => {
    IntegracionProducto.findOne.mockResolvedValue({ producto_id: 99, sku_externo: 'ABC-1' });
  });

  it('un upsert de solo precio no borra la ficha que ya estaba cargada', async () => {
    await Service.upsertProducto(INTEGRACION, BASE);
    const campos = ProductoService.actualizar.mock.calls[0][1];
    expect(campos).not.toHaveProperty('propuesta_valor');
    expect(campos).not.toHaveProperty('ficha_datos');
    expect(ProductoService.sincronizarFaq).not.toHaveBeenCalled();
  });

  it('conserva los textos de presentación que el comercio ya tenía', async () => {
    Producto.findOne.mockResolvedValue({
      ficha_datos: { presentacion: { beneficios_titulo: 'Lo que el comercio escribió', preguntas_titulo: 'FAQ' } },
    });

    await Service.upsertProducto(INTEGRACION, { ...BASE, ficha: { textos: { beneficios_titulo: 'Nuevo título' } } });

    const campos = ProductoService.actualizar.mock.calls[0][1];
    expect(campos.ficha_datos.presentacion).toEqual({
      beneficios_titulo: 'Nuevo título',
      preguntas_titulo: 'FAQ',
    });
  });

  it('una lista vacía explícita borra el bloque', async () => {
    await Service.upsertProducto(INTEGRACION, { ...BASE, ficha: { beneficios: [], preguntas: [] } });
    const campos = ProductoService.actualizar.mock.calls[0][1];
    expect(campos.beneficios).toEqual([]);
    expect(ProductoService.sincronizarFaq).toHaveBeenCalledWith(99, 1, [], expect.anything());
  });
});

// Una key de proveedor escribe en el catálogo global: el producto no tiene
// dueño (creado_por null) ni tienda, que es la condición para que lo vea
// TODO comercio en Mi catálogo, y queda atado a su Proveedor para poder
// filtrarlo y mostrar su logo en la tarjeta.
describe('credencial de proveedor', () => {
  const PROVEEDOR = { id: 3, inquilinoId: 1, proveedorId: 12, codigo: 'quanta' };

  it('crea el producto en el catálogo global, con su proveedor', async () => {
    await Service.upsertProducto(PROVEEDOR, BASE);

    const [datos, inquilinoId, usuarioId, esAdmin, , tiendaId] = ProductoService.crear.mock.calls[0];
    expect(datos.proveedor_id).toBe(12);
    expect(inquilinoId).toBe(1);
    expect(usuarioId).toBeNull();   // creado_por null = lo ve todo comercio
    expect(esAdmin).toBe(true);
    expect(tiendaId).toBeNull();
  });

  it('actualiza sin chocar con el chequeo de "producto que no creaste"', async () => {
    IntegracionProducto.findOne.mockResolvedValue({ producto_id: 99, sku_externo: 'ABC-1' });
    await Service.upsertProducto(PROVEEDOR, BASE);

    const [, , , usuarioId, esAdmin, , tiendaId] = ProductoService.actualizar.mock.calls[0];
    expect(usuarioId).toBeNull();
    expect(esAdmin).toBe(true);
    expect(tiendaId).toBeNull();
  });

  it('una key de tienda sigue escribiendo solo en su tienda', async () => {
    await Service.upsertProducto(INTEGRACION, BASE);

    const [datos, , usuarioId, esAdmin, , tiendaId] = ProductoService.crear.mock.calls[0];
    expect(datos.proveedor_id).toBeUndefined();
    expect(usuarioId).toBe(7);
    expect(esAdmin).toBe(false);
    expect(tiendaId).toBe(4);
  });
});

// El socio manda UN stock y listo: el desglose salón/depósito es asunto
// interno del comercio, un proveedor no tiene por qué saber que existe.
describe('stock', () => {
  it('el stock que manda el socio es el stock del producto', async () => {
    await Service.upsertProducto(INTEGRACION, { ...BASE, stock: 25 });
    const datos = ProductoService.crear.mock.calls[0][0];
    expect(datos.stock_salon).toBe(25);
    expect(datos.stock_deposito).toBe(0);
    expect(datos.estado_venta).toBe('en_venta');
  });

  it('stock 0 deja el producto fuera de stock', async () => {
    await Service.upsertProducto(INTEGRACION, { ...BASE, stock: 0 });
    expect(ProductoService.crear.mock.calls[0][0].estado_venta).toBe('fuera_de_stock');
  });

  it('sin stock no se da por válido', async () => {
    const { stock, ...sinStock } = BASE;
    await expect(Service.upsertProducto(INTEGRACION, sinStock))
      .rejects.toMatchObject({ codigo: 'STOCK_REQUERIDO' });
    await expect(Service.upsertProducto(INTEGRACION, { ...BASE, stock: -3 }))
      .rejects.toMatchObject({ codigo: 'STOCK_INVALIDO' });
  });

  it('el PATCH de stock responde un solo número', async () => {
    IntegracionProducto.findOne.mockResolvedValue({ producto_id: 99, sku_externo: 'ABC-1' });
    ProductoService.actualizar.mockResolvedValue({ id: 99, slug: 'p-99', activo: true, cantidad_disponible: 18 });

    const res = await Service.actualizarStock(INTEGRACION, 'ABC-1', { stock: 18 });

    expect(ProductoService.actualizar.mock.calls[0][1]).toMatchObject({ stock_salon: 18, stock_deposito: 0, estado_venta: 'en_venta' });
    expect(res).toEqual({ producto_id: 99, sku: 'ABC-1', stock: 18 });
  });
});

// Sin id de evento: el sku identifica al producto y toda operación fija un
// valor absoluto, así que repetir el request deja el mismo estado.
describe('reintentos', () => {
  it('mandar dos veces lo mismo deja el mismo estado, sin pedir event_id', async () => {
    await Service.upsertProducto(INTEGRACION, BASE);
    IntegracionProducto.findOne.mockResolvedValue({ producto_id: 99, sku_externo: 'ABC-1' });
    const segundo = await Service.upsertProducto(INTEGRACION, BASE);

    expect(segundo.accion).toBe('actualizado');
    expect(segundo).not.toHaveProperty('duplicado');
    expect(ProductoService.actualizar.mock.calls[0][1]).toMatchObject({ nombre: BASE.nombre, precio_base: BASE.precio });
  });
});

describe('logística', () => {
  it('peso y dimensiones llegan al alta', async () => {
    await Service.upsertProducto(INTEGRACION, { ...BASE, peso_kg: 1.2, dimensiones: '30x20x10 cm' });
    const datos = ProductoService.crear.mock.calls[0][0];
    expect(datos.peso).toBe(1.2);
    expect(datos.dimensiones).toBe('30x20x10 cm');
  });
});
