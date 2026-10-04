const client = require('../../services/speedbox/client');
const { buildOrder } = require('../../services/speedbox/payload');

function order(overrides = {}) {
  return { id: 31, usuario_id: 7, numero_pedido: 4, created_at: '2026-10-02T12:00:00Z', monto: 85000, costo_envio: 15000,
    cliente: 'Cliente prueba', telefono: '0981000000', direccion: 'Direccion 123', ciudad: 'Asuncion', departamento: 'Central',
    items: [{ cantidad: 1, subtotal: 85000, componentes_vendidos: [{ producto_id: 9, cantidad: 1, producto: { nombre: 'Producto', sku: 'SKU-001' } }] }], ...overrides };
}
const store = { nombre: 'Tienda prueba' };
const connection = { environment: 'sandbox', tienda_id: '54' };

describe('Speedbox client and payload', () => {
  beforeEach(() => {
    process.env.SPEEDBOX_ENVIRONMENT = 'sandbox';
    process.env.SPEEDBOX_API_KEY = 'test-api-key';
    process.env.SPEEDBOX_API_SECRET = 'test-api-secret';
    delete process.env.SPEEDBOX_API_URL;
    global.fetch = jest.fn();
  });
  afterAll(() => { delete process.env.SPEEDBOX_API_KEY; delete process.env.SPEEDBOX_API_SECRET; });
  it('sends server-side authentication and encodes the cursor offset', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) });
    await client.request('updates', { sinceAt: '2026-10-02T11:26:32-03:00' });
    const [url, options] = fetch.mock.calls[0];
    expect(url.searchParams.get('since_at')).toBe('2026-10-02T11:26:32-03:00');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer test-api-key', 'X-API-Secret': 'test-api-secret' });
    expect(options.redirect).toBe('error');
  });
  it('preserves an HTTP 500 response without leaking credentials', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => JSON.stringify({ error: 'test-api-secret', token: 'private' }) });
    await expect(client.request('order', { method: 'POST', body: {} })).rejects.toMatchObject({ uncertain: true,
      remoteStatus: 500, remoteResponse: { error: '[REDACTED]', token: '[REDACTED]' } });
  });
  it('marks a timed-out POST as uncertain', async () => {
    fetch.mockRejectedValue(new Error('timeout test-api-secret'));
    await expect(client.request('order', { method: 'POST' })).rejects.toMatchObject({ uncertain: true });
  });
  it('rejects redirects or insecure endpoints before sending credentials', async () => {
    process.env.SPEEDBOX_API_URL = 'https://attacker.example/api';
    await expect(client.request('spec')).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires an explicit production endpoint', () => {
    process.env.SPEEDBOX_ENVIRONMENT = 'production';
    expect(() => client.configuration()).toThrow('SPEEDBOX_API_URL');
  });
  it('keeps remote IDs as strings and rejects already-rounded numbers', () => {
    expect(client.remoteId('9007199254740993123')).toBe('9007199254740993123');
    expect(() => client.remoteId(9007199254740993)).toThrow();
  });
  it('maps a confirmed order with a stable external ID and customer-paid delivery', () => {
    expect(buildOrder(order(), store, connection)).toMatchObject({ external_order_id: 'GESICOMM-sandbox-7-31',
      order_name: '#4', tienda_id: '54', total_price: 100000, payment_method: 'contra_entrega',
      items: [{ sku: 'SKU-001', title: 'Producto', quantity: 1, price: 85000 }] });
  });
  it('excludes merchant-paid delivery and distinguishes prepaid orders', () => {
    expect(buildOrder(order({ delivery_a_cargo: 'negocio', pago_anticipado: true }), store, connection)).toMatchObject({ total_price: 85000, financial_status: 'paid' });
  });
  it('flattens the immutable combo recipe with the variant SKU and preserves its total', () => {
    const result = buildOrder(order({ items: [{ subtotal: 85001, componentes_vendidos: [
      { cantidad: 2, variante_id: 3, producto: { nombre: 'Remera', sku: 'PARENT' } },
      { cantidad: 1, producto: { nombre: 'Gorra', sku: 'GORRA' } },
    ] }] }), store, connection, new Map([[3, { nombre: 'Rojo M', sku_variante: 'ROJO-M' }]]));
    expect(result.items.map(item => item.sku)).toEqual(['ROJO-M', 'GORRA']);
    expect(result.items.reduce((total, item) => total + item.price * item.quantity, 0)).toBe(85001);
  });
  it('rejects a missing variant SKU instead of submitting the parent product', () => {
    const value = order(); value.items[0].componentes_vendidos[0].variante_id = 3;
    expect(() => buildOrder(value, store, connection)).toThrow('SKU Speedbox');
  });
  it('rejects incomplete customer data and negative amounts', () => {
    expect(() => buildOrder(order({ telefono: '', monto: -100000 }), store, connection)).toThrow('datos del pedido');
  });
});
