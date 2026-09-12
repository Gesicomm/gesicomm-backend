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
});
