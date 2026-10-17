jest.mock('../models', () => ({
  Afiliado: { findOne: jest.fn(), create: jest.fn(), findByPk: jest.fn() },
  AfiliadoClick: { count: jest.fn() },
  AfiliadoComision: { findAll: jest.fn(), findByPk: jest.fn() },
  Suscripcion: { findOne: jest.fn(), findAll: jest.fn() },
  PagoSuscripcion: {}, Plan: {},
  Usuario: { findByPk: jest.fn(), count: jest.fn() },
}));
jest.mock('../services/brevo.service', () => ({}));
jest.mock('../services/parametros.service', () => ({ obtener: jest.fn().mockResolvedValue(null) }));
jest.mock('../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
const m = require('../models');
const service = require('../services/afiliados.service');

beforeEach(() => {
  jest.clearAllMocks();
  m.Suscripcion.findOne.mockResolvedValue({ id: 1 });
  m.Usuario.findByPk.mockResolvedValue({ id: 7, nombre: 'Ana', correo_electronico: 'ana@test.com' });
  m.Afiliado.findOne.mockResolvedValue(null);
  m.Afiliado.create.mockImplementation(async data => ({ id: 3, ...data }));
});

test.each([{}, { acepta_terminos: 'true', terminos_version: '1.0' }, { acepta_terminos: true, terminos_version: '0.9' }])('no crea afiliado sin aceptacion explicita y vigente: %j', async payload => {
  await expect(service.solicitarParaUsuario(7, payload)).rejects.toMatchObject({ status: 422 });
  expect(m.Afiliado.create).not.toHaveBeenCalled();
});

test('guarda version y hora del servidor e ignora porcentaje enviado por el cliente', async () => {
  const result = await service.solicitarParaUsuario(7, { acepta_terminos: true, terminos_version: '1.0', comision_pct: 100, terminos_aceptados_en: '2000-01-01' });
  expect(m.Afiliado.create).toHaveBeenCalledWith(expect.objectContaining({
    usuario_id: 7, comision_pct: 10, terminos_version: '1.0', terminos_aceptados_en: expect.any(Date),
  }));
  expect(result.requiere_aceptacion).toBe(false);
});

test('el panel filtra por afiliado y separa saldos sin exponer correos ni notas', async () => {
  m.Afiliado.findOne.mockResolvedValue({ id: 3, codigo: 'ana', comisiones: [] });
  m.AfiliadoClick.count.mockResolvedValueOnce(12).mockResolvedValueOnce(8);
  m.Usuario.count.mockResolvedValue(4);
  m.Suscripcion.findAll.mockResolvedValue([
    { email: 'cliente@test.com', estado: 'activa', periodo_fin: null },
    { email: 'CLIENTE@test.com', estado: 'activa', periodo_fin: null },
    { email: 'vencido@test.com', estado: 'vencida' },
  ]);
  m.AfiliadoComision.findAll.mockResolvedValue([
    { id: 1, estado: 'pendiente', monto_comision: 1000, suscripcion: { email: 'secreto@test.com' }, notas: 'privado' },
    { id: 2, estado: 'aprobada', monto_comision: 2000 },
    { id: 3, estado: 'pagada', monto_comision: 3000 },
    { id: 4, estado: 'anulada', monto_comision: 9000 },
  ]);
  const panel = await service.obtenerPanel(7);
  expect(m.AfiliadoComision.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { afiliado_id: 3 } }));
  expect(panel.metricas).toMatchObject({ visitas: 12, visitantes_estimados: 8, registros: 4, clientes_pagados: 2, clientes_activos: 1 });
  expect(panel.afiliado.resumen_comisiones).toMatchObject({ total_a_liquidar: 3000, total_generado: 6000, pagada: 3000 });
  expect(panel.condiciones_pago).toMatchObject({ moneda: 'PYG', dias_deposito: null, minimo_liquidacion: null });
  expect(JSON.stringify(panel.movimientos)).not.toMatch(/secreto|privado/);
});

test('editar datos de cobro no sustituye la aceptacion registrada', async () => {
  const existente = { id: 3, usuario_id: 7, terminos_version: '1.0', terminos_aceptados_en: new Date(), update: jest.fn() };
  m.Afiliado.findOne.mockResolvedValue(existente);
  await service.solicitarParaUsuario(7, { cuenta_pago: '123', terminos_version: 'falsa', comision_pct: 99 });
  expect(existente.update).toHaveBeenCalledWith({ usuario_id: 7, cuenta_pago: '123' });
});

test('marca la fecha del deposito solo al pasar a pagada', async () => {
  const row = { id: 1, estado: 'aprobada', update: jest.fn() };
  m.AfiliadoComision.findByPk.mockResolvedValue(row);
  await service.actualizarComision(1, { estado: 'pagada' });
  expect(row.update).toHaveBeenCalledWith({ estado: 'pagada', pagada_en: expect.any(Date) });
});
