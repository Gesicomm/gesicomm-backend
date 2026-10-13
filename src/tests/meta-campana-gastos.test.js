/**
 * Ads & Campañas — gasto de campaña cargado a mano por rango de fechas.
 *
 * Los modelos se simulan, como en meta-reportes-importacion.test.js: lo que
 * se verifica es la lógica (validación, rangos que no se pisan, prorrateo
 * por días, totales por campaña), sin abrir un pool contra la base.
 */

jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn() },
  MetaCampanaInterna: { findOne: jest.fn(), findAll: jest.fn() },
  MetaCampanaGasto: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  MetaReporteImport: {},
  MetaReporteFila: { count: jest.fn() },
  MetaIntegration: {},
  Landing: {},
  LandingTemplate: {},
  Producto: { findAll: jest.fn() },
  Envio: {},
  EnvioItem: {},
}));

const { Op } = require('sequelize');
const GastosService = require('../services/metaCampanaGastos.service');
const MetaReportesService = require('../services/metaReportes.service');
const { MetaCampanaInterna, MetaCampanaGasto, MetaReporteFila, Producto } = require('../models');

const INQUILINO = 1;
const USUARIO = 42;
const CAMPANA = { id: 7, nombre_display: 'P0003 | TERMO | WEB | CONVERSION | CBO', nombre_interno: 'P0003 | TERMO | WEB | CONVERSION | CBO' };

beforeEach(() => {
  jest.resetAllMocks();
  MetaCampanaInterna.findOne.mockResolvedValue(CAMPANA);
  MetaCampanaGasto.findOne.mockResolvedValue(null);
  MetaCampanaGasto.create.mockImplementation(async (datos) => ({ id: 1, ...datos }));
});

describe('crear — validación de lo que carga el usuario', () => {
  const crear = (datos) => GastosService.crear(CAMPANA.id, INQUILINO, USUARIO, datos);

  it('guarda el gasto del rango en la campaña del usuario', async () => {
    const gasto = await crear({ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: '350000', nota: '  semana 1 ' });

    expect(MetaCampanaInterna.findOne).toHaveBeenCalledWith({ where: { id: CAMPANA.id, inquilino_id: INQUILINO, usuario_id: USUARIO } });
    expect(MetaCampanaGasto.create).toHaveBeenCalledWith({
      inquilino_id: INQUILINO,
      usuario_id: USUARIO,
      meta_campana_interna_id: CAMPANA.id,
      fecha_desde: '2026-10-01',
      fecha_hasta: '2026-10-07',
      monto: 350000,
      nota: 'semana 1',
    });
    expect(gasto).toMatchObject({ dias: 7, monto: 350000, promedio_diario: 50000 });
  });

  it('acepta un solo día y redondea al guaraní', async () => {
    const gasto = await crear({ fecha_desde: '2026-10-05', fecha_hasta: '2026-10-05', monto: 1000.6 });
    expect(gasto).toMatchObject({ dias: 1, monto: 1001, nota: null });
  });

  it.each([
    [{ fecha_hasta: '2026-10-07', monto: 1000 }, /rango de fechas/],
    [{ fecha_desde: '2026-02-31', fecha_hasta: '2026-03-05', monto: 1000 }, /rango de fechas/],
    [{ fecha_desde: '07/10/2026', fecha_hasta: '2026-10-08', monto: 1000 }, /rango de fechas/],
    [{ fecha_desde: '2026-10-08', fecha_hasta: '2026-10-07', monto: 1000 }, /no puede ser anterior/],
    [{ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: 0 }, /mayor a cero/],
    [{ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: -5 }, /mayor a cero/],
    [{ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: '' }, /mayor a cero/],
    [{ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: 'abc' }, /mayor a cero/],
    [{ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07' }, /mayor a cero/],
  ])('rechaza %j', async (datos, mensaje) => {
    await expect(crear(datos)).rejects.toThrow(mensaje);
    expect(MetaCampanaGasto.create).not.toHaveBeenCalled();
  });

  it('no deja cargar gasto en la campaña de otro usuario', async () => {
    MetaCampanaInterna.findOne.mockResolvedValue(null);
    await expect(crear({ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: 1000 })).rejects.toThrow('Campaña no encontrada.');
    expect(MetaCampanaGasto.create).not.toHaveBeenCalled();
  });

  it('rechaza un rango que se pisa con otro ya cargado, y dice cuál', async () => {
    MetaCampanaGasto.findOne.mockResolvedValue({ id: 3, fecha_desde: '2026-10-05', fecha_hasta: '2026-10-12' });

    await expect(crear({ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: 1000 }))
      .rejects.toThrow('ya tiene gasto cargado del 05/10/2026 al 12/10/2026');

    const { where } = MetaCampanaGasto.findOne.mock.calls[0][0];
    expect(where.meta_campana_interna_id).toBe(CAMPANA.id);
    expect(where.fecha_desde).toEqual({ [Op.lte]: '2026-10-07' });
    expect(where.fecha_hasta).toEqual({ [Op.gte]: '2026-10-01' });
    expect(MetaCampanaGasto.create).not.toHaveBeenCalled();
  });
});

describe('actualizar / eliminar', () => {
  const registro = () => ({
    id: 3,
    meta_campana_interna_id: CAMPANA.id,
    fecha_desde: '2026-10-01',
    fecha_hasta: '2026-10-07',
    monto: '350000.00',
    nota: null,
    update: jest.fn(async function actualizar(datos) { Object.assign(this, datos); }),
    destroy: jest.fn(),
  });

  it('corrige solo el monto y no se choca consigo mismo', async () => {
    const gasto = registro();
    MetaCampanaGasto.findOne
      .mockResolvedValueOnce(gasto)   // el registro a editar
      .mockResolvedValueOnce(null);   // ningún otro rango pisado

    const actualizado = await GastosService.actualizar(3, INQUILINO, USUARIO, { monto: 420000 });

    expect(MetaCampanaGasto.findOne.mock.calls[0][0]).toEqual({ where: { id: 3, inquilino_id: INQUILINO, usuario_id: USUARIO } });
    expect(MetaCampanaGasto.findOne.mock.calls[1][0].where.id).toEqual({ [Op.ne]: 3 });
    expect(gasto.update).toHaveBeenCalledWith({ fecha_desde: '2026-10-01', fecha_hasta: '2026-10-07', monto: 420000, nota: null });
    expect(actualizado).toMatchObject({ id: 3, monto: 420000, dias: 7 });
  });

  it('no deja mover el rango encima de otro registro', async () => {
    const gasto = registro();
    MetaCampanaGasto.findOne
      .mockResolvedValueOnce(gasto)
      .mockResolvedValueOnce({ id: 4, fecha_desde: '2026-10-08', fecha_hasta: '2026-10-08' });

    await expect(GastosService.actualizar(3, INQUILINO, USUARIO, { fecha_hasta: '2026-10-10' }))
      .rejects.toThrow('ya tiene gasto cargado el 08/10/2026');
    expect(gasto.update).not.toHaveBeenCalled();
  });

  it('un registro ajeno no existe para este usuario', async () => {
    MetaCampanaGasto.findOne.mockResolvedValue(null);
    await expect(GastosService.actualizar(3, INQUILINO, USUARIO, { monto: 1 })).rejects.toThrow('Registro de gasto no encontrado.');
    await expect(GastosService.eliminar(3, INQUILINO, USUARIO)).rejects.toThrow('Registro de gasto no encontrado.');
  });

  it('elimina el registro propio', async () => {
    const gasto = registro();
    MetaCampanaGasto.findOne.mockResolvedValue(gasto);
    await GastosService.eliminar(3, INQUILINO, USUARIO);
    expect(gasto.destroy).toHaveBeenCalled();
  });
});

describe('listar — histórico de una campaña', () => {
  it('devuelve la página pedida y el resumen de toda la campaña', async () => {
    MetaCampanaGasto.findAndCountAll.mockResolvedValue({
      count: 12,
      rows: [{ id: 9, meta_campana_interna_id: 7, fecha_desde: '2026-10-08', fecha_hasta: '2026-10-14', monto: '700000.00', nota: null }],
    });
    MetaCampanaGasto.findOne.mockResolvedValue({ total: '4200000.00', primer_dia: '2026-08-01', ultimo_dia: '2026-10-14', dias: '60' });

    const res = await GastosService.listar(CAMPANA.id, INQUILINO, USUARIO, { pagina: 2, limite: 5, orden: { campo: 'monto', direccion: 'asc' } });

    const consulta = MetaCampanaGasto.findAndCountAll.mock.calls[0][0];
    expect(consulta.where).toEqual({ meta_campana_interna_id: 7 });
    expect(consulta.limit).toBe(5);
    expect(consulta.offset).toBe(5);
    expect(consulta.order[0]).toEqual(['monto', 'ASC']);

    expect(res.resumen).toEqual({
      total_gastado: 4200000,
      registros: 12,
      primer_dia: '2026-08-01',
      ultimo_dia: '2026-10-14',
      dias_cargados: 60,
      promedio_diario: 70000,
    });
    expect(res).toMatchObject({ total: 12, pagina: 2, limite: 5, total_paginas: 3 });
    expect(res.gastos[0]).toMatchObject({ id: 9, dias: 7, monto: 700000, promedio_diario: 100000 });
  });

  it('una campaña sin gasto devuelve todo en cero, y un orden inventado cae al de por defecto', async () => {
    MetaCampanaGasto.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    MetaCampanaGasto.findOne.mockResolvedValue({ total: null, primer_dia: null, ultimo_dia: null, dias: null });

    const res = await GastosService.listar(CAMPANA.id, INQUILINO, USUARIO, { orden: { campo: 'nota; DROP TABLE', direccion: 'x' } });

    expect(res.resumen).toMatchObject({ total_gastado: 0, registros: 0, dias_cargados: 0, promedio_diario: 0 });
    expect(res.orden).toEqual({ campo: 'fecha_desde', direccion: 'DESC' });
    expect(res.gastos).toEqual([]);
  });
});

describe('gastoEnPeriodo — lo que ve el dashboard', () => {
  it('prorratea por días la parte del rango que cae en el período', () => {
    // 10 días, 1.000.000: 100.000 por día.
    const p = (desde, hasta) => GastosService.prorratear(1000000, '2026-10-01', '2026-10-10', desde, hasta);
    expect(p('2026-10-01', '2026-10-31')).toBe(1000000);
    expect(p('2026-09-01', '2026-10-03')).toBe(300000);
    expect(p('2026-10-10', '2026-10-20')).toBe(100000);
    expect(p('2026-10-04', '2026-10-05')).toBe(200000);
    expect(p('2026-10-11', '2026-10-31')).toBe(0);
    expect(p('2026-09-01', '2026-09-30')).toBe(0);
  });

  it('suma el gasto del período y lo abre por producto de la campaña', async () => {
    MetaCampanaGasto.findAll.mockResolvedValue([
      { fecha_desde: '2026-10-01', fecha_hasta: '2026-10-10', monto: '1000000.00', 'campana.producto_ids': [3] },
      // Mitad adentro del período, mitad afuera.
      { fecha_desde: '2026-09-21', fecha_hasta: '2026-10-10', monto: '400000.00', 'campana.producto_ids': [3, 8] },
      { fecha_desde: '2026-10-15', fecha_hasta: '2026-10-15', monto: '50000.00', 'campana.producto_ids': [] },
    ]);

    const res = await GastosService.gastoEnPeriodo(USUARIO, INQUILINO, '2026-10-01', '2026-10-31');

    const { where } = MetaCampanaGasto.findAll.mock.calls[0][0];
    expect(where.usuario_id).toBe(USUARIO);
    expect(where.inquilino_id).toBe(INQUILINO);
    expect(where.fecha_desde).toEqual({ [Op.lte]: '2026-10-31' });
    expect(where.fecha_hasta).toEqual({ [Op.gte]: '2026-10-01' });

    expect(res.total).toBe(1250000);
    expect(res.directo_por_producto).toEqual({ 3: 1200000, 8: 200000 });
    expect(res.sin_atribuir).toBe(50000);
  });

  it('sin usuario o sin período no consulta nada', async () => {
    expect(await GastosService.gastoEnPeriodo(null, INQUILINO, '2026-10-01', '2026-10-31')).toEqual({ total: 0, sin_atribuir: 0, directo_por_producto: {} });
    expect(MetaCampanaGasto.findAll).not.toHaveBeenCalled();
  });
});

describe('campañas — total gastado y borrado', () => {
  it('listarCampanas trae el gasto total de cada campaña', async () => {
    const campana = (id) => ({ id, producto_ids: [3], toJSON: () => ({ id, producto_ids: [3] }) });
    MetaCampanaInterna.findAll.mockResolvedValue([campana(7), campana(9)]);
    Producto.findAll.mockResolvedValue([{ id: 3, toJSON: () => ({ id: 3, nombre: 'Termo', sku: 'T-1' }) }]);
    MetaCampanaGasto.findAll.mockResolvedValue([
      { meta_campana_interna_id: 7, total: '1750000.00', registros: '3', ultimo_dia: '2026-10-14' },
    ]);

    const campanas = await MetaReportesService.listarCampanas(INQUILINO, USUARIO);

    expect(MetaCampanaGasto.findAll.mock.calls[0][0].where).toEqual({ meta_campana_interna_id: { [Op.in]: [7, 9] } });
    expect(campanas[0]).toMatchObject({ id: 7, gasto_total: 1750000, gasto_registros: 3, gasto_ultimo_dia: '2026-10-14' });
    expect(campanas[1]).toMatchObject({ id: 9, gasto_total: 0, gasto_registros: 0, gasto_ultimo_dia: null });
  });

  it('una campaña con gasto cargado no se elimina: se archiva', async () => {
    const campana = { id: 7, destroy: jest.fn() };
    MetaCampanaInterna.findOne.mockResolvedValue(campana);
    MetaReporteFila.count.mockResolvedValue(0);
    MetaCampanaGasto.count.mockResolvedValue(2);

    await expect(MetaReportesService.eliminarCampana(7, INQUILINO, USUARIO)).rejects.toThrow('2 registro(s) de gasto');
    expect(campana.destroy).not.toHaveBeenCalled();

    MetaCampanaGasto.count.mockResolvedValue(0);
    await MetaReportesService.eliminarCampana(7, INQUILINO, USUARIO);
    expect(campana.destroy).toHaveBeenCalled();
  });
});
