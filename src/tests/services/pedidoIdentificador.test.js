jest.mock('../../models', () => ({ Tienda: { findAll: jest.fn() } }));

const { Sequelize } = require('sequelize');
const { Tienda } = require('../../models');
const { numeroPedidoVisible, adjuntarIdentificadores, filtroNumeroPedidoVisible } = require('../../services/pedidoIdentificador.service');

beforeEach(() => jest.clearAllMocks());

test('la referencia usa tres letras y comienza en 1001 sin usar el id global', () => {
  expect(numeroPedidoVisible({ id: 900, tienda_id: 4, numero_pedido: 3, numero_pedido_tienda: 1 }, 'Casa López')).toBe('CAS-1001');
  expect(numeroPedidoVisible({ id: 901, tienda_id: 4, numero_pedido: 4, numero_pedido_tienda: 2 }, 'Casa López')).toBe('CAS-1002');
  expect(numeroPedidoVisible({ id: 901, tienda_id: 4, numero_pedido: 4 }, 'Casa López')).toBe('—');
  expect(numeroPedidoVisible({ id: 900 }, 'Casa López')).toBe('—');
  expect(numeroPedidoVisible({ numero_pedido_tienda: 1 }, 'AB')).toBe('AB-1001');
  expect(numeroPedidoVisible({ numero_pedido_tienda: 1 }, 'X')).toBe('X-1001');
  expect(numeroPedidoVisible({ numero_pedido_visible: 'Alibaguay-1002' })).toBe('ALI-1002');
});

test('cada pedido usa su tienda, incluso en cuentas con varias tiendas', async () => {
  Tienda.findAll.mockResolvedValue([
    { id: 4, usuario_id: 7, nombre: 'Casa López' },
    { id: 5, usuario_id: 7, nombre: 'Mi otra tienda' },
  ]);
  const resultado = await adjuntarIdentificadores([
    { id: 81, usuario_id: 7, tienda_id: 5, numero_pedido: 3, numero_pedido_tienda: 1 },
    { id: 82, usuario_id: 7, tienda_id: 4, numero_pedido: 4, numero_pedido_tienda: 1 },
    { id: 83, usuario_id: 7, tienda_id: null, numero_pedido: 5 },
  ]);
  expect(resultado.map(e => e.numero_pedido_visible)).toEqual([
    'MIO-1001', 'CAS-1001', 'SIN-1005',
  ]);
  expect(resultado[0].id).toBe(81);
  expect(resultado[0].numero_pedido).toBe(3);
  expect(Tienda.findAll).toHaveBeenCalledTimes(1);
});

test('un pedido histórico solo hereda el nombre si la cuenta tiene una única tienda', async () => {
  Tienda.findAll.mockResolvedValue([{ id: 4, usuario_id: 7, nombre: 'Casa López' }]);
  const [pedido] = await adjuntarIdentificadores([{ usuario_id: 7, numero_pedido: 1 }]);
  expect(pedido.numero_pedido_visible).toBe('CAS-1001');
});

test('la búsqueda numérica usa el correlativo público exacto y el texto se escapa', () => {
  const db = new Sequelize('postgres://test:test@localhost/test', { logging: false });
  const generar = filtro => db.getQueryInterface().queryGenerator.selectQuery('envios', { where: filtro }, { name: 'Envio' });
  expect(generar(filtroNumeroPedidoVisible('#1001'))).toContain('"Envio".numero_pedido_tienda END + 1000 = 1001');
  const sql = generar(filtroNumeroPedidoVisible("Casa O'Connor-1001"));
  expect(sql).toContain("ILIKE '%Casa O''Connor-1001%'");
  expect(sql).toContain('LEFT(REGEXP_REPLACE(UPPER(TRIM(');
  expect(sql).toContain('t.id = "Envio".tienda_id');
});


test('los leads tienen referencia de contacto sin número de pedido', () => {
  expect(numeroPedidoVisible({ id: 88, es_lead: true, numero_pedido: null, numero_pedido_tienda: null })).toBe('LEAD-88');
  expect(numeroPedidoVisible({ id: 88, es_lead: true, numero_pedido_visible: 'ALI-1001' })).toBe('LEAD-88');
});
