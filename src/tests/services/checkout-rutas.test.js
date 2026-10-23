jest.mock('../../models', () => {
  const model = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn() });
  return { sequelize: { transaction: jest.fn(fn => fn({})) }, Plan: model(), CheckoutIntent: model(), SubscriptionPurchase: model(), Suscripcion: model(), PagoSuscripcion: model(), Usuario: model() };
});
jest.mock('../../services/parametros.service', () => ({ obtenerVarios: jest.fn(async () => ({ PAGOPAR_PUBLIC_KEY: 'public', PAGOPAR_PRIVATE_KEY: 'private' })) }));
jest.mock('../../services/afiliados.service', () => ({ resolverActivo: jest.fn(async () => null) }));
jest.mock('../../services/payments/pagoParService', () => ({ createTransaction: jest.fn(async () => ({ payment_url: 'https://www.pagopar.com/pagos/test', hash_pedido: 'test' })) }));
const Service = require('../../services/suscripcion.service');
const { Plan, Usuario, CheckoutIntent, Suscripcion, SubscriptionPurchase, PagoSuscripcion } = require('../../models');
const PagoPar = require('../../services/payments/pagoParService');
const instance = data => ({ ...data, update: jest.fn(async function (changes) { Object.assign(this, changes); }) });
beforeEach(() => {
  jest.clearAllMocks();
  Usuario.findOne.mockResolvedValue(null);
  CheckoutIntent.create.mockImplementation(async data => instance({ ...data, id: 10, token: 'intent-servidor' }));
  Suscripcion.create.mockImplementation(async data => instance({ ...data, id: 20 }));
  SubscriptionPurchase.create.mockImplementation(async data => instance({ ...data, id: 30 }));
  PagoSuscripcion.create.mockImplementation(async data => instance({ ...data, id: 40 }));
});

test.each([
  ['una-ruta-mensual', 297000, 'personal'], ['una-ruta-anual', 2970000, 'fisico'],
  ['ambas-rutas-mensual', 397000, 'ambas'], ['ambas-rutas-anual', 3970000, 'ambas'],
])('%s conserva la ruta y cobra el importe del servidor (%s Gs.)', async (codigo, precio, ruta) => {
  Plan.findOne.mockResolvedValue({ id: 7, codigo, nombre: codigo, precio, moneda: 'PYG', periodicidad: codigo.endsWith('anual') ? 'anual' : 'mensual', activo: true });
  const intent = await Service.crearCheckoutIntent({ plan_codigo: codigo, ruta });
  const creado = await CheckoutIntent.create.mock.results[0].value;
  CheckoutIntent.findOne.mockResolvedValue(creado);
  const resultado = await Service.iniciarCheckout({ plan_codigo: 'manipulado', precio: 1, email: 'ana@example.test', nombre: 'Ana Prueba', telefono: '0981123456', documento: '1234567', checkout_intent_token: intent.checkout_intent_token });
  expect(PagoPar.createTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ monto: precio }), null);
  expect(SubscriptionPurchase.create).toHaveBeenCalledWith(expect.objectContaining({ monto: precio, moneda: 'PYG', metadata: { ruta } }), expect.anything());
  expect(resultado.payment_url).toBe('https://www.pagopar.com/pagos/test');
});
test('una ruta no admite solicitar ambas rutas por metadata', async () => {
  Plan.findOne.mockResolvedValue({ codigo: 'una-ruta-mensual' });
  await expect(Service.crearCheckoutIntent({ plan_codigo: 'una-ruta-mensual', ruta: 'ambas' })).rejects.toMatchObject({ status: 400 });
});
