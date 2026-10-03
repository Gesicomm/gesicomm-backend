'use strict';
jest.mock('../models', () => ({
  Oferta: { create: jest.fn(), findOne: jest.fn() }, OfertaComponente: { bulkCreate: jest.fn() },
  Producto: { findAll: jest.fn() }, ProductoImagen: {},
  ProductoVariante: { count: jest.fn(), findOne: jest.fn() },
}));
const { Producto, ProductoVariante, Oferta, OfertaComponente } = require('../models');
const OfertaService = require('../services/oferta.service');
const t = { name: 'transacción de alta' };
const pack = { codigo: 'PACK-2', nombre: 'Pack x2', tipo_contenido: 'pack', estrategia: 'normal', precio_normal: 18000,
  componentes: [{ es_producto_actual: true, producto_id: null, cantidad: 2, permite_elegir_variante: true }] };

describe('Ofertas preparadas antes de crear el producto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Producto.findAll.mockResolvedValue([{ id: 42 }, { id: 7 }]);
    ProductoVariante.count.mockResolvedValue(0);
    Oferta.create.mockResolvedValue({ id: 61 });
    Oferta.findOne.mockResolvedValue({ id: 61 });
  });
  test('resuelve el producto nuevo y guarda todos los componentes dentro de la transacción', async () => {
    await expect(OfertaService.crearBorradores(42, [pack], 1, t)).resolves.toEqual([{ id: 61 }]);
    expect(Oferta.create).toHaveBeenCalledWith(expect.objectContaining({ producto_ancla_id: 42, inquilino_id: 1 }), { transaction: t });
    expect(OfertaComponente.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ producto_id: 42, cantidad: 2, oferta_id: 61 })], { transaction: t });
  });
  test('no acepta componentes de otro inquilino y atribuye el error a Venta', async () => {
    Producto.findAll.mockResolvedValue([{ id: 42 }]);
    const bump = { ...pack, tipo_contenido: 'combo', estrategia: 'order_bump', componentes: [{ producto_id: 7, cantidad: 1 }] };
    await expect(OfertaService.crearBorradores(42, [bump], 1, t)).rejects.toMatchObject({ seccion: 'venta', message: 'Uno de los productos de la oferta no está disponible.' });
    expect(Producto.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: [7], inquilino_id: 1, activo: true }, transaction: t }));
    expect(Oferta.create).not.toHaveBeenCalled();
  });
  test('valida las variantes creadas en la misma transacción', async () => {
    ProductoVariante.count.mockResolvedValue(1);
    const sinEleccion = { ...pack, componentes: [{ es_producto_actual: true, cantidad: 2 }] };
    await expect(OfertaService.crearBorradores(42, [sinEleccion], 1, t)).rejects.toMatchObject({ seccion: 'venta' });
    expect(ProductoVariante.count).toHaveBeenCalledWith({ where: { producto_id: 42, activo: true }, transaction: t });
    expect(Oferta.create).not.toHaveBeenCalled();
  });
  test('rechaza precios inválidos y permite guardar un pack de un producto inactivo', async () => {
    Producto.findAll.mockResolvedValue([]);
    await expect(OfertaService.crearBorradores(42, [{ ...pack, precio_normal: 0 }], 1, t)).rejects.toMatchObject({ seccion: 'venta' });
    await expect(OfertaService.crearBorradores(42, [pack], 1, t)).resolves.toEqual([{ id: 61 }]);
  });
});
