'use strict';
const { seleccionarProductosMensaje } = require('../../services/seguimiento/contextoProductosMensaje');
const { resolverMensaje } = require('../../services/seguimiento/plantillaResolver.service');

const lead = () => ({ id: 7, es_lead: true, origen: 'WHATSAPP', items: [
  { producto_id: 10, nombre_producto: 'Silla', cantidad: 1, precio_unitario: 100, Producto: { id: 10, descripcion_corta: 'Silla plegable', beneficios: ['Fácil de guardar'] } },
  { producto_id: 20, nombre_producto: 'Mesa', cantidad: 2, precio_unitario: 200, Producto: { id: 20, descripcion_corta: 'Mesa para jardín', beneficios: ['Superficie amplia'] } },
] });

test('puede hablar del segundo producto sin borrar los demás ni cambiar el lead', () => {
  const original = lead();
  const contexto = seleccionarProductosMensaje(original, [20]);
  expect(resolverMensaje('{productos}: {producto_descripcion}. {producto_beneficios}', contexto)).toBe('Mesa: Mesa para jardín. • Superficie amplia');
  expect(contexto.monto).toBe(400);
  expect(original.items).toHaveLength(2);
  expect(contexto.es_lead).toBe(true);
});

test('admite varios productos para el mismo mensaje y el mismo flujo', () => {
  expect(seleccionarProductosMensaje(lead(), '10,20').items).toHaveLength(2);
});

test.each([[], [999], [0], ['10x'], null].map(ids => ({ ids })))('rechaza una selección inválida o ajena: $ids', ({ ids }) => {
  expect(() => seleccionarProductosMensaje(lead(), ids)).toThrow();
});

test('el filtro de mensaje no altera resúmenes de pedidos reales', () => {
  expect(() => seleccionarProductosMensaje({ ...lead(), es_lead: false }, [10])).toThrow();
});
