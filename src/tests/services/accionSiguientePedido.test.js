'use strict';

/**
 * El abastecimiento Gesicom por pedido ya no existe (2026-10-11): la tienda
 * no paga ni espera mercadería para poder vender. Un pedido confirmado se
 * prepara directo, y eso vale también para los pedidos viejos que quedaron
 * con un estado de abastecimiento a medio camino.
 */

const { accionSiguientePedido } = require('../../services/pedidos/accionSiguientePedido');

const ESTADOS_VIEJOS_DE_ABASTECIMIENTO = [
  'pendiente_pago', 'pago_enviado', 'pago_rechazado', 'pago_validado', 'proveedor_contactado',
  'enviado_por_proveedor', 'en_transito_a_gesicomm', 'recibido_en_gesicomm',
  'en_transito_a_deposito_cliente', 'recibido_en_deposito_cliente', 'no_requiere', null,
];

test('un pedido confirmado se prepara directo, tenga el estado de abastecimiento que tenga', () => {
  for (const abastecimiento_estado of ESTADOS_VIEJOS_DE_ABASTECIMIENTO) {
    const accion = accionSiguientePedido({ estado: 'Confirmado', abastecimiento_estado, abastecimiento_costo: 150000 });

    expect(accion).toMatchObject({ tipo: 'preparar', cta: 'Preparar', siguiente_estado: 'Preparado' });
  }
});

test('ninguna acción del circuito pide pagar ni menciona abastecimiento', () => {
  const estados = ['Pendiente', 'EnSeguimiento', 'Confirmado', 'Preparado', 'Despachado', 'Reprogramado', 'Entregado', 'Cancelado'];
  for (const estado of estados) {
    const accion = accionSiguientePedido({ estado, abastecimiento_estado: 'pendiente_pago', estado_financiero: 'pendiente_liquidacion' });

    expect(JSON.stringify(accion).toLowerCase()).not.toMatch(/abastecimiento|pagar/);
    expect(accion.requiere_pago).toBeUndefined();
  }
});

test('el circuito sigue en orden: confirmar, preparar, despachar, resultado, rendir', () => {
  const tipo = (estado, extra = {}) => accionSiguientePedido({ estado, ...extra }).tipo;

  expect(tipo('Pendiente')).toBe('confirmar');
  // Ya se le escribió por WhatsApp, pero sigue sin confirmar.
  expect(tipo('EnSeguimiento')).toBe('confirmar');
  expect(accionSiguientePedido({ estado: 'EnSeguimiento' }).siguiente_estado).toBe('Confirmado');
  expect(tipo('Confirmado')).toBe('preparar');
  expect(tipo('Preparado')).toBe('despachar');
  expect(tipo('Despachado')).toBe('resultado_entrega');
  expect(tipo('Entregado', { estado_financiero: 'pendiente_liquidacion' })).toBe('rendir');
  expect(tipo('Cancelado')).toBe('cerrado');
});
