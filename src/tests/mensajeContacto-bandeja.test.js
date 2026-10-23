jest.mock('../models', () => ({ MensajeContacto: { create: jest.fn(), findAndCountAll: jest.fn() } }));
const { Op } = require('sequelize');
const { MensajeContacto } = require('../models');
const Service = require('../services/mensajeContacto.service');

beforeEach(() => jest.clearAllMocks());

test.each([
  ['prueba', 'Gesicom · Cupón de prueba gratuita de 7 días'],
  ['vendedor', 'Gesicom · Contratar un plan'],
  ['proveedor', 'Gesicom · Postulación de proveedor · Envíos y logística'],
  ['demo', 'Gesicom · Una demostración'],
])('una solicitud %s se guarda y se expone en la bandeja administrativa', async (tipo, asunto) => {
  MensajeContacto.create.mockImplementation(async datos => ({ ...datos, id: 23, created_at: '2026-10-23T10:00:00Z' }));
  await Service.crear({ area: 'comercial', nombre: 'Ana Pérez', email: 'ANA@example.com', asunto, mensaje: 'Documento: 123456\nWhatsApp: +595981123456' });
  const registro = await MensajeContacto.create.mock.results[0].value;
  MensajeContacto.findAndCountAll.mockResolvedValue({ rows: [registro], count: 1 });
  const resultado = await Service.listar({ area: 'comercial', tipo });
  expect(resultado.mensajes[0]).toMatchObject({ id: 23, tipo, nombre: 'Ana Pérez', email: 'ana@example.com', asunto, mensaje: registro.mensaje });
  expect(MensajeContacto.findAndCountAll.mock.calls[0][0].where.area).toBe('comercial');
  const filtro = MensajeContacto.findAndCountAll.mock.calls[0][0].where.asunto;
  expect(tipo === 'prueba' ? filtro[Op.or] : filtro[Op.startsWith]).toBeTruthy();
});

test('limita la paginación y mantiene consultas comerciales anteriores', async () => {
  MensajeContacto.findAndCountAll.mockResolvedValue({ rows: [{ id: 4, asunto: 'Consulta sobre un plan' }], count: 1 });
  const resultado = await Service.listar({ page: -3, limit: 10000, area: 'comercial' });
  expect(MensajeContacto.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, offset: 0 }));
  expect(resultado.mensajes[0].tipo).toBe('consulta');
});
