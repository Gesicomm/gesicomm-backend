/**
 * Reglas contables de un pedido (utils/contabilidadPedido) — auditoría del
 * 2026-10-23. Las usan el Dashboard General, Control Financiero y los
 * reportes, así que acá se fija lo que tiene que dar cada caso.
 */
jest.mock('../../models', () => ({}));

const {
  cobroTotalCliente,
  deliveryCobradoAlCliente,
  costoEnvioNeto,
  comisionDelPedido,
  costoPedidoFallido,
} = require('../../utils/contabilidadPedido');
const { calcularDesglose } = require('../../services/liquidacion.service');

const linea = (subtotal, extra = {}) => ({ cantidad: 1, precio_unitario: subtotal, subtotal, ...extra });

describe('envío y comisión', () => {
  test('carga manual con el delivery adentro del monto: el envío no le cuesta al negocio', () => {
    const e = { monto: 230000, costo_envio: 30000, delivery_a_cargo: 'cliente', items: [linea(200000)] };
    expect(deliveryCobradoAlCliente(e)).toBe(30000);
    expect(costoEnvioNeto(e)).toBe(0);
    expect(cobroTotalCliente(e)).toBe(230000);
  });

  test('checkout de la landing: delivery fuera del monto, la comisión va sobre todo lo cobrado', () => {
    const e = { monto: 200000, costo_envio: 25000, delivery_a_cargo: 'cliente', comision_pct_aplicada: 4, items: [linea(200000)] };
    expect(cobroTotalCliente(e)).toBe(225000);
    expect(comisionDelPedido(e)).toBe(9000);
    expect(costoEnvioNeto(e)).toBe(0);
  });

  test('delivery a cargo del negocio: el envío completo es costo', () => {
    const e = { monto: 200000, costo_envio: 30000, delivery_a_cargo: 'negocio', items: [linea(200000)] };
    expect(costoEnvioNeto(e)).toBe(30000);
  });
});

describe('pedidos fallidos', () => {
  const comp = (extra) => ({ cantidad: 1, costo_unitario: 80000, cantidad_perdida: 0, cantidad_devuelta_danada: 0, ...extra });

  test('devuelto en buen estado: solo cuesta el viaje', () => {
    const e = { estado: 'Devuelto', costo_envio: 20000, items: [linea(150000, { componentes_vendidos: [comp()] })] };
    expect(costoPedidoFallido(e)).toMatchObject({ envio: 20000, mercaderia: 0, total: 20000 });
  });

  test('devuelto dañado: viaje + mercadería a costo', () => {
    const e = { estado: 'Devuelto', costo_envio: 20000, items: [linea(150000, { componentes_vendidos: [comp({ cantidad_devuelta_danada: 1 })] })] };
    expect(costoPedidoFallido(e).total).toBe(100000);
  });

  test('perdido con cargo al courier: el cargo ya descuenta el servicio', () => {
    // cargo = valor de venta 150.000 − envío 20.000
    const e = { estado: 'Perdido', costo_envio: 20000, cargo_perdida_courier: 130000, items: [linea(150000, { componentes_vendidos: [comp({ cantidad_perdida: 1 })] })] };
    // mercadería 80.000 − recupero 130.000 = ganancia de 50.000 (vendido al courier)
    expect(costoPedidoFallido(e)).toMatchObject({ envio: 0, mercaderia: 80000, recupero: 130000, total: -50000 });
  });

  test('cancelado no cuesta: su costo_envio es la tarifa estimada, no un viaje', () => {
    expect(costoPedidoFallido({ estado: 'Cancelado', costo_envio: 20000, items: [] }).total).toBe(0);
  });
});

describe('rendición con el courier', () => {
  test('un Perdido con cargo no descuenta el servicio dos veces', () => {
    const desglose = calcularDesglose([{
      id: 1, estado: 'Perdido', monto: 150000, costo_envio: 20000, cargo_perdida_courier: 130000,
      MetodoPago: { custodia_cobro: 'courier' }, items: [linea(150000)],
    }]);
    // El courier perdió 150.000 de mercadería y su servicio era 20.000: debe 130.000.
    expect(desglose.saldo_final).toBe(130000);
  });

  test('un Entregado sigue descontando el servicio', () => {
    const desglose = calcularDesglose([{
      id: 2, estado: 'Entregado', monto: 150000, costo_envio: 20000,
      MetodoPago: { custodia_cobro: 'courier' }, items: [linea(150000)],
    }]);
    // Cobró 150.000 + 20.000 de delivery (va fuera del monto) y se queda su servicio.
    expect(desglose.saldo_final).toBe(150000);
  });
});
