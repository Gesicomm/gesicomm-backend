'use strict';

const { resolverMensaje, listarVariablesDisponibles } = require('../../services/seguimiento/plantillaResolver.service');

test.each([
  [{ nombre_cliente: 'María', apellido_cliente: 'González' }, 'María'],
  [{ nombre_cliente: 'María José', apellido_cliente: 'González' }, 'María'],
  [{ nombre_cliente: '  Juan\tCarlos  ', apellido_cliente: 'Pérez' }, 'Juan'],
  [{ cliente: 'María González' }, 'María'],
  [{ nombre_cliente: '  ', cliente: '  Ana\nLópez  ' }, 'Ana'],
  [{ nombre_cliente: 'Pedro', cliente: 'Ana López' }, 'Pedro'],
  [{ apellido_cliente: 'González' }, 'Cliente'],
  [{}, 'Cliente'],
])('WhatsApp usa solamente el primer nombre: %j', (pedido, nombre) => {
  expect(resolverMensaje('Hola {cliente_nombre} / {{cliente_nombre}} / {nombre}', pedido))
    .toBe(`Hola ${nombre} / ${nombre} / ${nombre}`);
});

test('la vista previa del nombre coincide con el mensaje real y conserva los datos del pedido', () => {
  const pedido = { nombre_cliente: 'María José', apellido_cliente: 'González' };
  const variable = listarVariablesDisponibles().find(v => v.key === 'cliente_nombre');
  expect(variable).toMatchObject({ desc: 'Primer nombre del cliente', ejemplo: 'María' });
  expect(resolverMensaje('Te cuento algo, {cliente_nombre}', pedido)).toBe(`Te cuento algo, ${variable.ejemplo}`);
  expect(pedido).toEqual({ nombre_cliente: 'María José', apellido_cliente: 'González' });
});
