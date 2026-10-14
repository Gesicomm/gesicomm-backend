'use strict';

const { faseDisponibleParaPedido, estadoActivadorDeFase } = require('../../services/seguimiento/faseActivacion');
const { resolverMensaje, listarVariablesDisponibles } = require('../../services/seguimiento/plantillaResolver.service');

test.each([
  ['Confirmado', 'Preparado', false],
  ['Preparado', 'Preparado', true],
  ['Preparado', 'Despachado', false],
  ['Despachado', 'Despachado', true],
  ['Despachado', 'Preparado', false],
  ['Reprogramado', 'Despachado', true],
  ['Devuelto', 'Despachado', false],
  ['Perdido', 'Preparado', false],
])('pedido %s con aviso de %s: disponible=%s', (estado, requerido, disponible) => {
  expect(faseDisponibleParaPedido({ estado_activador: requerido }, { estado }, 'SEGUIMIENTO_ENVIO')).toBe(disponible);
});

test('los avisos base antiguos recuperan su activador y respetan el estado actual', () => {
  expect(estadoActivadorDeFase({ nombre: 'Pedido confirmado' }, 'SEGUIMIENTO_ENVIO')).toBe('Preparado');
  expect(estadoActivadorDeFase({ nombre: 'Pedido despachado' }, 'SEGUIMIENTO_ENVIO')).toBe('Despachado');
  expect(faseDisponibleParaPedido({ nombre: 'Pedido confirmado' }, { estado: 'Despachado' }, 'SEGUIMIENTO_ENVIO')).toBe(false);
  expect(faseDisponibleParaPedido({ nombre: 'Pedido despachado' }, { estado: 'Despachado' }, 'SEGUIMIENTO_ENVIO')).toBe(true);
  expect(estadoActivadorDeFase({ nombre: 'Pedido confirmado' }, 'CONFIRMACION_PEDIDO_WEB')).toBeNull();
  expect(estadoActivadorDeFase({ nombre: 'Pedido confirmado', estado_activador: 'Reprogramado' }, 'SEGUIMIENTO_ENVIO')).toBe('Reprogramado');
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
