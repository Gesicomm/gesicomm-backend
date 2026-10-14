jest.mock('../../models', () => ({
  sequelize: {
    query: jest.fn(),
  },
}));

const { sequelize } = require('../../models');
const PedidoNumeracion = require('../../services/pedidoNumeracion.service');

describe('PedidoNumeracion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reserva el siguiente numero de pedido por usuario de forma atomica', async () => {
    const transaction = { id: 'tx-test' };
    sequelize.query
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([[{ ultimo_numero_pedido: 7 }], undefined]);

    const numero = await PedidoNumeracion.reservarNumeroPedido(12, transaction);

    expect(numero).toBe(7);
    expect(sequelize.query).toHaveBeenCalledTimes(2);
    expect(sequelize.query.mock.calls[0][0]).toContain('ON CONFLICT (usuario_id) DO NOTHING');
    expect(sequelize.query.mock.calls[1][0]).toContain('RETURNING ultimo_numero_pedido');
    expect(sequelize.query.mock.calls[1][1]).toMatchObject({
      replacements: { usuario_id: 12 },
      transaction,
    });
  });

  it('rechaza usuarios invalidos', async () => {
    await expect(PedidoNumeracion.reservarNumeroPedido(null)).rejects.toThrow('Usuario inválido');
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('reserva un correlativo independiente por tienda en la transacción del pedido', async () => {
    const transaction = { id: 'tx-tienda' };
    sequelize.query.mockResolvedValueOnce([[{ ultimo_numero_pedido: 1 }], undefined]);
    expect(await PedidoNumeracion.reservarNumeroPedidoTienda(5, transaction)).toBe(1);
    expect(sequelize.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (tienda_id) DO UPDATE'), {
      replacements: { tienda_id: 5 }, transaction,
    });
  });

  it('no numera pedidos sin tienda y rechaza tiendas o transacciones inválidas', async () => {
    expect(await PedidoNumeracion.reservarNumeroPedidoTienda(null)).toBeNull();
    await expect(PedidoNumeracion.reservarNumeroPedidoTienda(0, {})).rejects.toThrow('Tienda inválida');
    await expect(PedidoNumeracion.reservarNumeroPedidoTienda(5)).rejects.toThrow('transacción');
    expect(sequelize.query).not.toHaveBeenCalled();
  });
});
