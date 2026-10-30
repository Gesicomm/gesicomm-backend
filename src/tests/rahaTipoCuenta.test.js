'use strict';
jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(fn => fn({ LOCK: { UPDATE: 'UPDATE' } })) },
  Usuario: { findByPk: jest.fn() }, Tienda: { findOne: jest.fn() },
  RahaSolicitud: { findOrCreate: jest.fn(), findOne: jest.fn() },
  RahaDocumento: { findAll: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../services/raha/storage', () => ({ read: jest.fn() }));
jest.mock('../services/notificaciones/pedidosNotificaciones.service', () => ({
  idsDeAdministradores: jest.fn(async () => []), notificarEnApp: jest.fn(async () => {}),
}));
const service = require('../services/raha/service');
const { Usuario, Tienda, RahaSolicitud, RahaDocumento } = require('../models');
const storage = require('../services/raha/storage');
const actor = { id: 2, actorId: 3, tiendaId: 9, rol: 'usuario' };
let row;
beforeEach(() => {
  jest.clearAllMocks();
  row = { id: 5, tienda_id: 9, usuario_id: 2, inquilino_id: 1, estado: 'aprobada', version: 4,
    datos: { razon_social: 'Comercio', banco: 'Banco', numero_cuenta: '123' }, historial: [],
    reload: jest.fn(async () => row), update: jest.fn(async data => Object.assign(row, data)),
    toJSON: () => ({ id: row.id, datos: row.datos, estado: row.estado, version: row.version, historial: row.historial }),
  };
  Usuario.findByPk.mockResolvedValue({ id: 2, inquilino_id: 1 });
  Tienda.findOne.mockResolvedValue({ id: 9 });
  RahaSolicitud.findOrCreate.mockResolvedValue([row]);
  RahaSolicitud.findOne.mockResolvedValue(row);
  RahaDocumento.findAll.mockResolvedValue([]);
});

test.each(['en_revision', 'enviada_raha', 'aprobada'])('completa un dato pendiente conservando estado %s y demás datos', async estado => {
  row.estado = estado;
  const result = await service.completarTipoCuenta(actor, { tipo_cuenta: 'Caja de ahorro', version: 4 });
  expect(result).toMatchObject({ estado, version: 5, datos: { razon_social: 'Comercio', banco: 'Banco', numero_cuenta: '123', tipo_cuenta: 'Caja de ahorro' } });
  expect(result.historial).toEqual([expect.objectContaining({ evento: 'tipo_cuenta_completado', estado, usuario_id: 3, version: 5 })]);
  expect(Tienda.findOne.mock.calls[0][0]).toMatchObject({ where: { id: 9, usuario_id: 2, inquilino_id: 1 }, lock: 'UPDATE' });
});
test.each(['borrador', 'observada', 'rechazada'])('no abre esta excepción para %s', async estado => {
  row.estado = estado;
  await expect(service.completarTipoCuenta(actor, { tipo_cuenta: 'Caja de ahorro', version: 4 })).rejects.toMatchObject({ status: 409 });
  expect(row.update).not.toHaveBeenCalled();
});
test('rechaza versiones viejas y no sobrescribe un tipo de cuenta ya guardado', async () => {
  await expect(service.completarTipoCuenta(actor, { tipo_cuenta: 'Caja de ahorro', version: 3 })).rejects.toMatchObject({ status: 409 });
  row.datos.tipo_cuenta = 'Cuenta corriente';
  await expect(service.completarTipoCuenta(actor, { tipo_cuenta: 'Caja de ahorro', version: 4 })).rejects.toMatchObject({ status: 409 });
  expect(row.update).not.toHaveBeenCalled();
});
test.each([
  { tipo_cuenta: '', version: 4 }, { tipo_cuenta: 'Otra', version: 4 },
  { tipo_cuenta: 'Caja de ahorro', version: 4, numero_cuenta: '456' },
])('rechaza valores inválidos o cambios a otros campos: %j', async input => {
  await expect(service.completarTipoCuenta(actor, input)).rejects.toMatchObject({ status: 400 });
  expect(row.update).not.toHaveBeenCalled();
});
test('no completa datos de otra tienda o inquilino', async () => {
  Tienda.findOne.mockResolvedValue(null);
  await expect(service.completarTipoCuenta(actor, { tipo_cuenta: 'Caja de ahorro', version: 4 })).rejects.toMatchObject({ status: 404 });
  expect(row.update).not.toHaveBeenCalled();
});
test('descarga el PDF firmado aunque falten datos para generar un contrato nuevo', async () => {
  const doc = { id: 8, solicitud_id: 5, tipo: 'contrato', nombre: 'firmado.pdf' };
  RahaDocumento.findByPk.mockResolvedValue(doc);
  storage.read.mockResolvedValue(Buffer.from('%PDF-firmado'));
  await expect(service.document(actor, 8)).resolves.toEqual({ doc, buffer: Buffer.from('%PDF-firmado') });
  expect(row.update).not.toHaveBeenCalled();
});
