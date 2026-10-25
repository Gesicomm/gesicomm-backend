// Saldos pendientes de rendición por courier: mismo cálculo que
// previsualizar (calcularDesglose), agrupado y sin elegir fechas.
jest.mock('../models', () => ({
  Envio: { findAll: jest.fn() }, EnvioItem: {}, MetodoPago: {}, Liquidacion: {}, LiquidacionEnvio: {}, Courier: {}, sequelize: {},
}));
jest.mock('../services/pedidoIdentificador.service', () => ({ adjuntarIdentificadores: async (x) => x }));

const { Envio } = require('../models');
const { saldosPendientes } = require('../services/liquidacion.service');

const envio = (extra) => ({
  monto: 100000, costo_envio: 15000, cargo_perdida_courier: null, estado: 'Entregado',
  MetodoPago: { custodia_cobro: 'courier' }, items: [], dispatchedAt: '2026-10-05T12:00:00Z', ...extra,
});

test('agrupa por courier, calcula el saldo y filtra por la tienda activa', async () => {
  Envio.findAll.mockResolvedValue([
    envio({ id: 1, courier_id: 4, Courier: { nombre: 'Moto Luque' } }),
    envio({ id: 2, courier_id: 4, Courier: { nombre: 'Moto Luque' }, dispatchedAt: '2026-10-02T12:00:00Z' }),
    envio({ id: 3, courier_id: 9, Courier: { nombre: 'Propio' }, MetodoPago: { custodia_cobro: 'negocio' } }),
  ]);
  const r = await saldosPendientes({ usuario_id: 20, tienda_id: 7 });

  const [opciones] = Envio.findAll.mock.calls[0];
  expect(opciones.where).toMatchObject({ usuario_id: 20, tienda_id: 7, estado_financiero: 'pendiente_liquidacion' });

  const moto = r.find(s => s.courier_id === 4);
  // Sin líneas, el flete va por fuera del monto (desgloseDelivery): cobró
  // 2 × (100.000 + 15.000) y se le deben 2 × 15.000 de envío.
  expect(moto).toMatchObject({ nombre: 'Moto Luque', cantidad_pedidos: 2, saldo_final: 200000, desde: '2026-10-02', hasta: '2026-10-05' });
  const propio = r.find(s => s.courier_id === 9);
  // No cobró nada (custodia del negocio): solo se le debe el envío.
  expect(propio.saldo_final).toBe(-15000);
  // Primero el saldo más grande.
  expect(r[0].courier_id).toBe(4);
});
