'use strict';

const { faseDisponibleParaPedido } = require('../../services/seguimiento/faseActivacion');
const { resolverMensaje, listarVariablesDisponibles } = require('../../services/seguimiento/plantillaResolver.service');

// 2026-10-14: en Seguimiento de envío el operador elige y envía cualquier
// fase cuando quiere; el estado logístico ya no bloquea nada acá.
test.each([
  'Confirmado', 'Preparado', 'Despachado', 'Reprogramado', 'Devuelto', 'Perdido', 'Pendiente', 'Cancelado', 'Entregado',
])('seguimiento de envío siempre está disponible, sea cual sea el estado del pedido (%s)', (estado) => {
  expect(faseDisponibleParaPedido({ estado_activador: 'Preparado' }, { estado }, 'SEGUIMIENTO_ENVIO')).toBe(true);
  expect(faseDisponibleParaPedido({ estado_activador: 'Despachado' }, { estado }, 'SEGUIMIENTO_ENVIO')).toBe(true);
});

test.each(['Devuelto', 'Perdido'])('la recuperación sigue disponible en %s', (estado) => {
  expect(faseDisponibleParaPedido({}, { estado }, 'RECUPERACION_CLIENTES')).toBe(true);
});

test.each(['Pendiente', 'Confirmado', 'Preparado', 'Despachado', 'Reprogramado', 'Entregado', 'Cancelado'])('Recuperación no se activa en un pedido %s', (estado) => {
  expect(faseDisponibleParaPedido({}, { estado }, 'RECUPERACION_CLIENTES')).toBe(false);
});

test.each(['Pendiente', 'Confirmado', 'Preparado', 'Despachado', 'Reprogramado', 'Devuelto', 'Perdido', 'Cancelado', 'Entregado'])('Recompra solo está disponible en Entregado: pedido %s', (estado) => {
  expect(faseDisponibleParaPedido({}, { estado }, 'ESCALAMIENTO_VENTAS')).toBe(estado === 'Entregado');
});

test('las variables del courier usan sus datos reales y distinguen su teléfono del cliente', () => {
  const mensaje = resolverMensaje('{courier_nombre} · {{courier_telefono}} · {telefono}', {
    telefono: '0981 111 222', Courier: { nombre: 'Delivery Luque', telefono: '0982 333 444' },
  });
  expect(mensaje).toBe('Delivery Luque · 0982 333 444 · 0981 111 222');
  expect(listarVariablesDisponibles().map((v) => v.key)).toEqual(expect.arrayContaining(['courier_nombre', 'courier_telefono']));
});

test('las variables admiten datos planos y no inventan contactos cuando falta courier', () => {
  expect(resolverMensaje('{courier_nombre} {courier_telefono}', { courier_nombre: 'Express', courier_telefono: '0985 555 555' })).toBe('Express 0985 555 555');
  expect(resolverMensaje('{courier_nombre}/{courier_telefono}', {})).toBe('/');
});
