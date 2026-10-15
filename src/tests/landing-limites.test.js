jest.mock('../models', () => ({
  Tienda: { findByPk: jest.fn() }, Usuario: {},
}));
const { Tienda } = require('../models');
const Limites = require('../services/landingLimites.service');

const prueba = { id: 69, nombre: 'Llevalofacil', usuario_id: 171, Usuario: { correo_electronico: 'andre@gmail.com' } };
const items = cantidad => Array.from({ length: cantidad }, (_, i) => ({ tipo: 'producto', referencia_id: i + 1 }));

beforeEach(() => Tienda.findByPk.mockReset().mockResolvedValue(prueba));

test('permite 4000 y hasta 5000 solo en Llévatelo Fácil del dueño autorizado', async () => {
  await expect(Limites.validarItemsLienzo(items(4000), 69)).resolves.toBe(5000);
  await expect(Limites.validarItemsLienzo(items(5000), 69)).resolves.toBe(5000);
  await expect(Limites.validarItemsLienzo(items(5001), 69)).rejects.toMatchObject({ errores: [expect.stringContaining('5000')] });
  expect(Tienda.findByPk).toHaveBeenCalledWith(69, expect.objectContaining({ include: [expect.objectContaining({ attributes: ['correo_electronico'] })] }));
});

test.each([
  { ...prueba, Usuario: { correo_electronico: 'otro@gmail.com' } },
  { ...prueba, id: 80, nombre: 'Otra tienda de Andre' },
  { ...prueba, id: 81, nombre: 'Llévatelo Fácil' },
  { ...prueba, Usuario: null },
  null,
])('mantiene el tope de 500 fuera de la tienda y dueño autorizados: %j', async tienda => {
  Tienda.findByPk.mockResolvedValue(tienda);
  const tiendaId = tienda?.id ?? 69;
  await expect(Limites.validarItemsLienzo(items(500), tiendaId)).resolves.toBe(500);
  await expect(Limites.validarItemsLienzo(items(501), tiendaId)).rejects.toMatchObject({ errores: [expect.stringContaining('500 productos')] });
});

test('el cambio de nombre de la misma tienda no revoca la ampliación', async () => {
  Tienda.findByPk.mockResolvedValue({ ...prueba, nombre: 'Nuevo nombre comercial' });
  await expect(Limites.validarItemsLienzo(items(4000), 69)).resolves.toBe(5000);
});

test('rechaza una lista inválida', async () => {
  await expect(Limites.validarItemsLienzo({}, 69)).rejects.toMatchObject({ errores: ['Los productos deben enviarse como una lista.'] });
});

test('los atributos consultados existen en los modelos reales de Sequelize', async () => {
  const UsuarioReal = jest.requireActual('../models/Usuario');
  const TiendaReal = jest.requireActual('../models/Tienda');
  await Limites.obtenerLimiteManual(69);
  const consulta = Tienda.findByPk.mock.calls[0][1];
  for (const atributo of consulta.attributes) {
    expect(TiendaReal.getAttributes()).toHaveProperty(atributo);
  }
  for (const atributo of consulta.include[0].attributes) {
    expect(UsuarioReal.getAttributes()).toHaveProperty(atributo);
  }
});
