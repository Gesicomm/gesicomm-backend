jest.mock('../models/PartnerSolicitud', () => ({
  findOne: jest.fn(), findOrCreate: jest.fn(),
}));
jest.mock('../models', () => ({ Usuario: { findByPk: jest.fn() } }));
jest.mock('../services/notificaciones/pedidosNotificaciones.service', () => ({
  idsDeAdministradores: jest.fn().mockResolvedValue([2]), notificarEnApp: jest.fn().mockResolvedValue(),
}));
jest.mock('../utils/logger', () => ({ logger: { error: jest.fn() } }));
const PartnerSolicitud = require('../models/PartnerSolicitud');
const { Usuario } = require('../models');
const avisos = require('../services/notificaciones/pedidosNotificaciones.service');
const service = require('../services/partner.service');
const payload = { nombre: 'Ana', telefono: '+595981123456', acepta_terminos: true, terminos_version: '1.0' };

beforeEach(() => {
  jest.clearAllMocks();
  Usuario.findByPk.mockResolvedValue({ id: 7, nombre: 'Ana', correo_electronico: 'ana@example.com', inquilino_id: 4 });
  PartnerSolicitud.findOne.mockResolvedValue(null);
  PartnerSolicitud.findOrCreate.mockImplementation(async ({ defaults }) => [{ id: 9, ...defaults }, true]);
});

test.each([
  { ...payload, acepta_terminos: false },
  { ...payload, acepta_terminos: 'true' },
  { ...payload, terminos_version: '0.9' },
  { ...payload, telefono: '' },
  { ...payload, usuario_id: 999 },
  { ...payload, estado: 'certificado' },
])('rechaza datos invalidos o cambios de estado desde el navegador', async datos => {
  await expect(service.solicitar(7, datos)).rejects.toMatchObject({ status: 422 });
  expect(PartnerSolicitud.findOrCreate).not.toHaveBeenCalled();
});

test('identidad, estado pendiente y aceptacion se fijan en el servidor', async () => {
  const result = await service.solicitar(7, payload);
  expect(PartnerSolicitud.findOrCreate).toHaveBeenCalledWith({
    where: { usuario_id: 7 },
    defaults: expect.objectContaining({
      usuario_id: 7, email: 'ana@example.com', estado: 'pendiente', terminos_version: '1.0', terminos_aceptados_en: expect.any(Date),
    }),
  });
  expect(result.solicitud.estado).toBe('pendiente');
  expect(avisos.idsDeAdministradores).toHaveBeenCalledWith(4);
  expect(avisos.notificarEnApp).toHaveBeenCalledWith([2], expect.objectContaining({ entidad_id: 9 }));
});

test('el reintento devuelve la solicitud original sin otra notificacion', async () => {
  const original = { id: 9, estado: 'pendiente', terminos_aceptados_en: new Date('2026-10-19') };
  PartnerSolicitud.findOrCreate.mockResolvedValue([original, false]);
  const result = await service.solicitar(7, payload);
  expect(result.solicitud.terminos_aceptados_en).toEqual(original.terminos_aceptados_en);
  expect(result.creada).toBe(false);
  expect(avisos.notificarEnApp).not.toHaveBeenCalled();
});

test('entrega el documento completo y la solicitud del usuario autenticado', async () => {
  const data = await service.obtener(7);
  expect(PartnerSolicitud.findOne).toHaveBeenCalledWith({ where: { usuario_id: 7 } });
  expect(data.terminos.texto).toContain('### 23. Aceptación');
  expect(data.terminos.texto).toContain('USD 997');
  expect(data.terminos.texto).toContain('USD 247');
  expect(data.solicitud).toBeNull();
});
