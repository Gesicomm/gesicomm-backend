'use strict';

jest.mock('../../services/r2/r2.service', () => ({ R2Service: { getObject: jest.fn() } }));
jest.mock('../../utils/descargarImagenExterna', () => ({ descargarImagenExterna: jest.fn() }));
const sharp = require('sharp');
const { R2Service } = require('../../services/r2/r2.service');
const { imagenesDelPedido, imagenParaCopiar } = require('../../services/seguimiento/imagenesPedido.service');
const { descargarImagenExterna } = require('../../utils/descargarImagenExterna');

test('la foto corresponde a la oferta comprada o a su variante, sin elegir otra variante', () => {
  const imagenes = [
    { id: 1, url: '/general.webp', es_principal: true },
    { id: 2, url: '/azul.webp', variante_id: 7 },
    { id: 3, url: '/roja.webp', variante_id: 8, es_principal: true },
  ];
  const Producto = { imagenes };
  const resultado = imagenesDelPedido({ items: [
    { id: 10, nombre_producto: 'Camisa azul', variante_id: 7, Producto },
    { id: 11, nombre_producto: 'Camisa verde', variante_id: 9, Producto },
    { id: 12, oferta_nombre: 'Pack de camisas', Producto, Oferta: { imagen_url: '/pack.webp' } },
  ] });
  expect(resultado.map(i => [i.item_id, i.nombre, i.url])).toEqual([
    [10, 'Camisa azul', '/azul.webp'], [11, 'Camisa verde', '/general.webp'], [12, 'Pack de camisas', '/pack.webp'],
  ]);
});

test('omite productos sin foto y no repite la imagen de varias líneas del mismo producto', () => {
  expect(imagenesDelPedido({ items: [
    { id: 1, Producto: { imagenes: [{ url: '/foto.webp', es_principal: true }, { url: '/otra.webp' }] } },
    { id: 2, Producto: { imagenes: [{ url: '/foto.webp' }] } },
    { id: 3, Producto: { imagenes: [{ url: '/otra-variante.webp', variante_id: 9 }] } },
    { id: 4 },
  ] }).map(i => i.url)).toEqual(['/foto.webp']);
  expect(imagenesDelPedido({})).toEqual([]);
});

test('convierte la imagen almacenada a PNG para el portapapeles', async () => {
  const jpg = await sharp({ create: { width: 2, height: 1, channels: 3, background: '#159957' } }).jpeg().toBuffer();
  R2Service.getObject.mockResolvedValue({ Body: { transformToByteArray: async () => jpg } });
  const png = await imagenParaCopiar({ url: 'https://imagenes.example/foto.jpg', storage_key: 'products/9/foto.jpg' });
  expect(R2Service.getObject).toHaveBeenCalledWith('products/9/foto.jpg');
  expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 2, height: 1 });
});

test('convierte la imagen externa a PNG en el servidor, sin depender del navegador', async () => {
  const jpg = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#159957' } }).jpeg().toBuffer();
  descargarImagenExterna.mockResolvedValue(jpg);
  const png = await imagenParaCopiar({ url: 'https://externo.example/foto.jpg' });
  expect(descargarImagenExterna).toHaveBeenCalledWith('https://externo.example/foto.jpg');
  expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 3, height: 2 });
});

test('no lee rutas fuera de uploads', async () => {
  await expect(imagenParaCopiar({ url: '/uploads/../../.env' })).rejects.toThrow('Ruta de imagen inválida');
  await expect(imagenParaCopiar({ url: '/uploads/%2e%2e/%2e%2e/.env' })).rejects.toThrow('Ruta de imagen inválida');
});
