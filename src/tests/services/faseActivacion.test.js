'use strict';

const { faseDisponibleParaPedido, estadoActivadorDeFase } = require('../../services/seguimiento/faseActivacion');
const { resolverMensaje, listarVariablesDisponibles } = require('../../services/seguimiento/plantillaResolver.service');
const { etapaDelPedido } = require('../../services/seguimiento/flujosBase');
const { estadoParaSeguimiento } = require('../../services/seguimiento/estadoPedido');

test.each([
  ['pendiente_confirmacion', 'Preparado', 'SEGUIMIENTO_ENVIO'],
  ['creado', 'Preparado', 'SEGUIMIENTO_ENVIO'],
  ['cargado', 'Despachado', 'SEGUIMIENTO_ENVIO'],
  ['en_camino', 'Despachado', 'SEGUIMIENTO_ENVIO'],
  ['entregado', 'Entregado', 'ESCALAMIENTO_VENTAS'],
  ['devuelto', 'Devuelto', 'RECUPERACION_CLIENTES'],
])('RAHA %s habilita su aviso y etapa aunque el pedido local siga Confirmado', (status, estado, tipo) => {
  const pedido = { estado: 'Confirmado', stock_descontado: false, raha_logistica: { gestionado: true, status } };
  expect(estadoParaSeguimiento(pedido)).toBe(estado);
  expect(etapaDelPedido(pedido)).toBe(tipo);
  expect(faseDisponibleParaPedido({ estado_activador: estado }, pedido, tipo)).toBe(true);
  expect(faseDisponibleParaPedido({ estado_activador: estado === 'Preparado' ? 'Despachado' : 'Preparado' }, pedido, 'SEGUIMIENTO_ENVIO')).toBe(false);
  expect(pedido.estado).toBe('Confirmado');
});

test.each(['Pendiente', 'EnSeguimiento', 'Cancelado', 'Perdido', 'Entregado', 'Devuelto'])('RAHA no reabre un pedido local %s', estado => {
  expect(estadoParaSeguimiento({ estado, raha_logistica: { gestionado: true, status: 'cargado' } })).toBe(estado);
});

test('una integración fallida o un status desconocido conserva el estado local', () => {
  expect(estadoParaSeguimiento({ estado: 'Confirmado', raha_logistica: { gestionado: false, status: 'cargado' } })).toBe('Confirmado');
  expect(estadoParaSeguimiento({ estado: 'Confirmado', raha_logistica: { gestionado: true, status: 'otro' } })).toBe('Confirmado');
});

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
