const { PassThrough } = require('stream');
const ExcelJS = require('exceljs');

jest.mock('../models', () => ({
  sequelize: {
    query: jest.fn(),
    transaction: jest.fn(async (fn) => fn('tx')),
    QueryTypes: { SELECT: 'SELECT' },
  },
  PrecioUsuario: { bulkCreate: jest.fn() },
}));
jest.mock('../services/precioUsuario.service', () => ({
  visibilidadCatalogoSql: () => '',
  visibilidadComboSql: () => '',
}));

const { sequelize, PrecioUsuario } = require('../models');
const Svc = require('../services/precioUsuarioExcel.service');

function filaDb(over = {}) {
  return {
    tipo: 'producto', id: 1, sku: 'WS-1', nombre: 'Air Fryer', categoria: 'Freidoras', proveedor: 'Winningstar',
    costo: '100000', precio_base: '100000', precio_minimo: '90000', precio_usuario_id: null, precio_usuario: null,
    ...over,
  };
}

async function exportarABuffer(filas) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', c => chunks.push(c));
  const fin = new Promise(r => stream.on('end', r));
  await Svc.escribirExcel(filas, stream);
  await fin;
  return Buffer.concat(chunks);
}

/** Carga el export, aplica `editar(hoja)` y devuelve el nuevo buffer. */
async function editar(buffer, editarFn) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  editarFn(wb.getWorksheet('Precios'));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function xlsxSimple(filas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  filas.forEach(f => ws.addRow(f));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parsearPrecio', () => {
  const { parsearPrecio } = Svc._internals;
  test.each([
    [169000, 169000], ['169000', 169000], ['169.000', 169000], ['1.169.000', 1169000],
    ['169,000', 169000], ['Gs 169.000', 169000], [169000.4, 169000],
    [{ formula: 'A1*2', result: 200000 }, 200000],
  ])('%p → %p', (entrada, esperado) => {
    expect(parsearPrecio(entrada).valor).toBe(esperado);
  });
  test.each(['169.5', '1.69.00', 'abc'])('rechaza %p', (entrada) => {
    expect(parsearPrecio(entrada).error).toBeTruthy();
  });
  test('vacío', () => {
    expect(parsearPrecio(null).vacio).toBe(true);
    expect(parsearPrecio('  ').vacio).toBe(true);
  });
});

describe('importar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sequelize.query.mockImplementation(async (sql) => {
      if (/UPDATE precios_usuario/.test(sql)) return [[], 0];
      return [
        filaDb(),
        filaDb({ id: 2, sku: ' ws-2 ', nombre: 'Air Fryer 2', precio_usuario_id: 77, precio_usuario: '150000' }),
        filaDb({ id: 3, sku: 'DUP', nombre: 'Dup A' }),
        filaDb({ id: 4, sku: 'dup', nombre: 'Dup B' }),
        filaDb({ id: 5, sku: null, nombre: 'Sin SKU' }),
        filaDb({ tipo: 'combo', id: 1, sku: null, nombre: 'Combo 1', costo: '300000', precio_base: '300000', precio_minimo: null }),
      ];
    });
  });

  test('clasifica cada fila y no escribe en vista previa', async () => {
    const buffer = await xlsxSimple([
      ['SKU', 'Precio nuevo'],
      ['WS-1', '169.000'],          // ok, alta
      ['ws-2', 150000],             // igual al actual → sin cambios
      ['DUP', 200000],              // SKU repetido
      ['NOEXISTE', 200000],         // no encontrado
      ['WS-1', 169000],             // duplicado con mismo precio → ignorado
      [null, 200000],               // sin identificador
      ['WS-2', 95000],              // menor al costo
      ['WS-2', 80000],              // menor al mínimo
      ['WS-2', ''],                 // vacío → ignorado
    ]);
    const r = await Svc.importar(9, 1, false, buffer);
    expect(r.a_actualizar).toBe(1);
    expect(r.cambios[0]).toMatchObject({ id: 1, precio_nuevo: 169000, precio_actual: 100000 });
    expect(r.sin_cambios).toBe(1);
    expect(r.filas_sin_precio).toBe(1);
    expect(r.errores.map(e => e.fila)).toEqual([4, 5, 7, 8, 9]);
    expect(r.errores[0].motivo).toMatch(/repetido/);
    expect(r.errores[3].motivo).toMatch(/te cuesta/);
    expect(r.errores[4].motivo).toMatch(/mínimo/);
    expect(PrecioUsuario.bulkCreate).not.toHaveBeenCalled();
  });

  test('mismo producto dos veces con precios distintos → ninguno se aplica', async () => {
    const buffer = await xlsxSimple([['SKU', 'Precio nuevo'], ['WS-1', 150000], ['WS-1', 160000]]);
    const r = await Svc.importar(9, 1, false, buffer);
    expect(r.a_actualizar).toBe(0);
    expect(r.errores[0].motivo).toMatch(/fila 2/);
  });

  test('Tipo+ID identifica combos y productos sin SKU; SKU que no coincide con el ID es error', async () => {
    const buffer = await xlsxSimple([
      ['Tipo', 'ID', 'SKU', 'Precio nuevo'],
      ['Combo', 1, null, 350000],
      ['Producto', 5, null, 120000],
      ['Producto', 1, 'WS-2', 120000],
    ]);
    const r = await Svc.importar(9, 1, false, buffer);
    expect(r.cambios.map(c => `${c.tipo}:${c.id}`)).toEqual(['combo:1', 'producto:5']);
    expect(r.errores[0].motivo).toMatch(/no corresponde/);
  });

  test('aplicar: UPDATE para existentes, bulkCreate para nuevos, en transacción', async () => {
    const buffer = await xlsxSimple([['SKU', 'Precio nuevo'], ['WS-1', 169000], ['WS-2', 180000]]);
    const r = await Svc.importar(9, 1, false, buffer, { aplicar: true });
    expect(r.actualizados).toBe(2);
    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    const update = sequelize.query.mock.calls.find(([sql]) => /UPDATE precios_usuario/.test(sql));
    expect(update[1].replacements).toMatchObject({ usuario_id: 9, id0: 77, p0: 180000 });
    expect(PrecioUsuario.bulkCreate).toHaveBeenCalledWith(
      [{ usuario_id: 9, inquilino_id: 1, tipo: 'producto', referencia_id: 1, precio: 169000 }],
      expect.objectContaining({ transaction: 'tx' }),
    );
  });

  test('archivo sin columnas reconocibles', async () => {
    const buffer = await xlsxSimple([['Nombre', 'Precio']]);
    await expect(Svc.importar(9, 1, false, buffer)).rejects.toThrow(/Precio nuevo/);
  });

  test('archivo que no es xlsx', async () => {
    await expect(Svc.importar(9, 1, false, Buffer.from('hola'))).rejects.toThrow(/xlsx/);
  });
});

describe('ida y vuelta con 10.000 ítems', () => {
  test('exporta, se edita el Excel y se importa', async () => {
    const N = 10000;
    const filas = Array.from({ length: N }, (_, i) => ({
      tipo: 'producto', id: i + 1, sku: `SKU-${i + 1}`, nombre: `Producto ${i + 1}`, categoria: 'Cat', proveedor: 'Prov',
      costo: 100000, precio_minimo: 90000, precio_usuario_id: i % 2 ? i + 1 : null, precio_actual: 150000,
    }));

    let t = Date.now();
    const exportado = await exportarABuffer(filas);
    const msExport = Date.now() - t;

    const editado = await editar(exportado, (ws) => {
      for (let r = 2; r <= N + 1; r += 2) ws.getRow(r).getCell(10).value = 175000; // la mitad
    });

    sequelize.query.mockResolvedValue(filas.map(f => ({
      ...f, costo: String(f.costo), precio_base: '150000', precio_minimo: '90000',
      precio_usuario: f.precio_usuario_id ? '150000' : null,
    })));
    t = Date.now();
    const r = await Svc.importar(9, 1, false, editado);
    const msImport = Date.now() - t;

    console.log(`export ${N}: ${msExport}ms, ${(exportado.length / 1024).toFixed(0)}KB · import: ${msImport}ms`);
    expect(r.total_errores).toBe(0);
    expect(r.a_actualizar).toBe(N / 2);
    expect(r.filas_sin_precio).toBe(N / 2);
  }, 60000);
});
