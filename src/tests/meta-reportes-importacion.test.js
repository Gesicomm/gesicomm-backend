/**
 * Meta Ads — importación de reportes y consultas de la sección.
 *
 * Los modelos se simulan, como en el resto de los tests del proyecto: lo
 * que hay que verificar acá es la LÓGICA (reconocimiento de columnas,
 * agrupado por campaña de Meta, vínculo por código vs. relación manual,
 * paginación, filtros y orden), no si Sequelize escribe en Postgres.
 * Además evita abrir un pool contra la base, que vive detrás de un túnel y
 * es la de producción.
 */

const mockCampanas = [
  { id: 7, codigo: 'ABC123', nombre_display: 'Promo Enero' },
  { id: 9, codigo: 'ZZZ999', nombre_display: 'Otra campaña' },
];

jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn() },
  MetaCampanaInterna: { findAll: jest.fn(async () => mockCampanas) },
  MetaReporteImport: {
    create: jest.fn(),
    findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
  },
  MetaReporteFila: {
    findAll: jest.fn(),
    findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })),
    bulkCreate: jest.fn(),
    count: jest.fn(),
  },
  MetaIntegration: { findOne: jest.fn() },
  Landing: { findOne: jest.fn() },
  LandingTemplate: { findOne: jest.fn() },
  Producto: { findAll: jest.fn(), findAndCountAll: jest.fn() },
  Envio: { findAll: jest.fn() },
  EnvioItem: {},
}));

const { Op } = require('sequelize');
const MetaReportesService = require('../services/metaReportes.service');
const { MetaReporteImport, MetaReporteFila } = require('../models');

const INQUILINO = 1;

// Export "Rendimiento de campaña" recortado: 3 filas, 2 campañas de Meta,
// una con código [GSC-…] y otra sin, más una columna que el sistema no usa.
const CSV = [
  '"Inicio del informe","Fin del informe","Nombre de la campaña","Importe gastado (PYG)","Compras","Valor de conversión de compras","Impresiones","Clics en el enlace","Columna Rara"',
  '"1/1/2026","1/31/2026","[GSC-ABC123] Promo Enero","100000","5","500000","10000","200","x"',
  '"2/1/2026","2/28/2026","Campaña sin código","50000","2","150000","5000","100","y"',
  '"2/1/2026","2/28/2026","Campaña sin código","25000","1","75000","2500","50","z"',
].join('\n');

const buffer = (texto) => Buffer.from(texto, 'utf8');

// ===================================================================
// Importación
// ===================================================================

describe('analizarCSV — análisis previo, sin escribir nada', () => {
  let analisis;

  beforeAll(async () => {
    analisis = await MetaReportesService.analizarCSV(buffer(CSV), {
      inquilino_id: INQUILINO,
      nombre_archivo: 'reporte.csv',
    });
  });

  it('no toca la base', () => {
    const { sequelize } = require('../models');
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(MetaReporteImport.create).not.toHaveBeenCalled();
    expect(MetaReporteFila.bulkCreate).not.toHaveBeenCalled();
  });

  it('lee las filas y el período que abarca el informe', () => {
    expect(analisis.archivo).toEqual({ nombre_archivo: 'reporte.csv', filas_totales: 3 });
    expect(analisis.periodo).toEqual({ fecha_inicio: '2026-01-01', fecha_fin: '2026-02-28' });
  });

  it('separa las columnas que usa de las que ignora', () => {
    expect(analisis.columnas.reconocidas).toHaveLength(8);
    expect(analisis.columnas.no_reconocidas).toEqual(['Columna Rara']);
    expect(analisis.columnas.faltantes).toEqual([]);
  });

  it('agrupa por campaña de Meta y ordena por gasto', () => {
    expect(analisis.campanas_detectadas).toHaveLength(2);
    const [primera, segunda] = analisis.campanas_detectadas;
    expect(primera.nombre_campana_meta).toBe('[GSC-ABC123] Promo Enero');
    // El gasto agrupado ya viene con IVA, igual que en el resto del módulo.
    expect(Math.round(primera.gasto)).toBe(110000);
    expect(segunda.filas).toBe(2);
    expect(Math.round(segunda.gasto)).toBe(82500);
    expect(segunda.compras).toBe(3);
  });

  it('vincula por código y deja el resto a revisar', () => {
    const [conCodigo, sinCodigo] = analisis.campanas_detectadas;
    expect(conCodigo.campana_id).toBe(7);
    expect(conCodigo.origen).toBe('codigo');
    expect(sinCodigo.campana_id).toBeNull();
    expect(sinCodigo.origen).toBeNull();

    expect(analisis.resumen).toMatchObject({
      total: 3, matcheadas: 1, sin_match: 2, campanas: 2, campanas_sin_match: 1,
    });
  });
});

describe('_prepararFilas — relaciones elegidas en la revisión', () => {
  let headers;
  let filas;

  beforeAll(() => {
    ({ headers, filas } = MetaReportesService._leerCSV(buffer(CSV)));
  });

  it('aplica la relación manual a las filas sin código', async () => {
    const res = await MetaReportesService._prepararFilas(INQUILINO, headers, filas, { 'Campaña sin código': 9 });

    expect(res.matcheadas).toBe(3);
    expect(res.porRelacionManual).toBe(2);
    expect(res.sinMatch).toBe(0);
    expect(res.filasParaInsertar[1].meta_campana_interna_id).toBe(9);
  });

  it('nunca pisa un vínculo por código con una relación manual', async () => {
    const res = await MetaReportesService._prepararFilas(INQUILINO, headers, filas, { '[GSC-ABC123] Promo Enero': 9 });
    expect(res.filasParaInsertar[0].meta_campana_interna_id).toBe(7);
  });

  it('descarta ids de campaña que no son del tenant', async () => {
    // `relaciones` viene del cliente: un id ajeno no puede vincular nada.
    const res = await MetaReportesService._prepararFilas(INQUILINO, headers, filas, { 'Campaña sin código': 4242 });
    expect(res.sinMatch).toBe(2);
    expect(res.porRelacionManual).toBe(0);
  });

  it('sin relaciones, solo vincula lo que matchea por código', async () => {
    const res = await MetaReportesService._prepararFilas(INQUILINO, headers, filas);
    expect(res.matcheadas).toBe(1);
    expect(res.sinMatch).toBe(2);
    expect(res.porRelacionManual).toBe(0);
  });
});

describe('_leerCSV — validación del archivo', () => {
  it('rechaza un CSV que no sea un export de Meta', () => {
    const sinColumnaClave = '"Inicio del informe","Importe gastado (PYG)"\n"1/1/2026","100"';
    expect(() => MetaReportesService._leerCSV(buffer(sinColumnaClave)))
      .toThrow(/Nombre de la campaña/);
  });

  it('rechaza un archivo vacío', () => {
    expect(() => MetaReportesService._leerCSV(buffer(''))).toThrow(/vacío/);
  });

  it('avisa las columnas clave que faltan, pero deja importar', async () => {
    const flaco = '"Nombre de la campaña","Alcance"\n"Campaña X","500"';
    const analisis = await MetaReportesService.analizarCSV(buffer(flaco), {
      inquilino_id: INQUILINO, nombre_archivo: 'flaco.csv',
    });

    expect(analisis.columnas.faltantes).toHaveLength(MetaReportesService.COLUMNAS_CLAVE.length);
    expect(analisis.columnas.faltantes[0]).toHaveProperty('consecuencia');
    expect(analisis.archivo.filas_totales).toBe(1);
  });
});

// ===================================================================
// Consultas: paginación, filtros dinámicos y orden.
// Van por POST, así que los filtros llegan con sus tipos reales.
// ===================================================================

describe('_paginacion', () => {
  it('pagina de 10 en 10 por defecto', () => {
    expect(MetaReportesService._paginacion({})).toEqual({ pagina: 1, limite: 10, offset: 0 });
    expect(MetaReportesService._paginacion({ pagina: 3 })).toEqual({ pagina: 3, limite: 10, offset: 20 });
  });

  it('respeta un límite pedido pero lo topea', () => {
    expect(MetaReportesService._paginacion({ limite: 25 }).limite).toBe(25);
    expect(MetaReportesService._paginacion({ limite: 5000 }).limite).toBe(100);
    expect(MetaReportesService._paginacion({ limite: 0 }).limite).toBe(10);
  });

  it('tolera valores basura y strings de query params', () => {
    expect(MetaReportesService._paginacion({ pagina: 'abc' }).pagina).toBe(1);
    expect(MetaReportesService._paginacion({ pagina: -4 }).pagina).toBe(1);
    expect(MetaReportesService._paginacion({ pagina: '2', limite: '20' }))
      .toEqual({ pagina: 2, limite: 20, offset: 20 });
  });
});

describe('_orden', () => {
  const permitidos = ['fecha_inicio', 'importe_gastado'];
  const porDefecto = { campo: 'fecha_inicio', direccion: 'DESC' };

  it('acepta un campo de la lista blanca', () => {
    expect(MetaReportesService._orden({ orden: { campo: 'importe_gastado', direccion: 'asc' } }, permitidos, porDefecto))
      .toEqual({ campo: 'importe_gastado', direccion: 'ASC' });
  });

  it('ignora un campo que no está en la lista blanca', () => {
    // El campo lo elige el cliente: si no está permitido, no puede llegar
    // al ORDER BY.
    expect(MetaReportesService._orden({ orden: { campo: 'password' } }, permitidos, porDefecto))
      .toEqual(porDefecto);
    expect(MetaReportesService._orden({ orden: { campo: 'id; DROP TABLE x' } }, permitidos, porDefecto))
      .toEqual(porDefecto);
  });

  it('ignora una dirección inválida', () => {
    expect(MetaReportesService._orden({ orden: { campo: 'importe_gastado', direccion: 'RANDOM()' } }, permitidos, porDefecto).direccion)
      .toBe('DESC');
  });

  it('usa el orden por defecto si no se pide nada', () => {
    expect(MetaReportesService._orden({}, permitidos, porDefecto)).toEqual(porDefecto);
  });
});

describe('listarImportaciones — historial filtrable', () => {
  const argumentos = () => MetaReporteImport.findAndCountAll.mock.calls[0][0];

  beforeEach(() => {
    MetaReporteImport.findAndCountAll.mockClear();
    MetaReporteImport.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
  });

  it('pagina de 10 y ordena por importación más reciente', async () => {
    const res = await MetaReportesService.listarImportaciones(INQUILINO);

    expect(argumentos().limit).toBe(10);
    expect(argumentos().offset).toBe(0);
    expect(argumentos().order[0]).toEqual(['created_at', 'DESC']);
    expect(res).toMatchObject({ total: 0, pagina: 1, limite: 10, total_paginas: 1 });
  });

  it('busca por nombre de archivo sin dejar pasar comodines', async () => {
    await MetaReportesService.listarImportaciones(INQUILINO, { busqueda: '100%_meta' });

    // El % y el _ del texto se escapan: si no, "100%" traería todo.
    expect(argumentos().where.nombre_archivo[Op.iLike]).toBe('%100\\%\\_meta%');
  });

  it('filtra por estado de relación', async () => {
    await MetaReportesService.listarImportaciones(INQUILINO, { estado: 'con_pendientes' });
    expect(argumentos().where.filas_sin_match).toEqual({ [Op.gt]: 0 });

    MetaReporteImport.findAndCountAll.mockClear();
    await MetaReportesService.listarImportaciones(INQUILINO, { estado: 'completo' });
    expect(argumentos().where.filas_sin_match).toBe(0);
  });

  it('acota por período con el mismo criterio de solapamiento que las filas', async () => {
    await MetaReportesService.listarImportaciones(INQUILINO, { fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31' });

    expect(argumentos().where.fecha_fin_reporte).toEqual({ [Op.gte]: '2026-08-01' });
    expect(argumentos().where.fecha_inicio_reporte).toEqual({ [Op.lte]: '2026-08-31' });
  });

  it('siempre acota al tenant', async () => {
    await MetaReportesService.listarImportaciones(INQUILINO, { busqueda: 'x', estado: 'completo' });
    expect(argumentos().where.inquilino_id).toBe(INQUILINO);
  });
});

describe('listarFilas — filas filtrables', () => {
  const argumentos = () => MetaReporteFila.findAndCountAll.mock.calls[0][0];

  beforeEach(() => {
    MetaReporteFila.findAndCountAll.mockClear();
    MetaReporteFila.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
  });

  it('pagina de 10 y ordena por fecha descendente', async () => {
    const res = await MetaReportesService.listarFilas(INQUILINO);

    expect(argumentos().limit).toBe(10);
    expect(argumentos().order[0]).toEqual(['fecha_inicio', 'DESC NULLS LAST']);
    expect(res).toMatchObject({ pagina: 1, limite: 10, estado_vinculo: 'todas' });
  });

  it('separa pendientes de relacionadas en la consulta, no en el cliente', async () => {
    await MetaReportesService.listarFilas(INQUILINO, { estado_vinculo: 'sin_vincular' });
    expect(argumentos().where.meta_campana_interna_id).toBeNull();

    MetaReporteFila.findAndCountAll.mockClear();
    await MetaReportesService.listarFilas(INQUILINO, { estado_vinculo: 'vinculadas' });
    expect(argumentos().where.meta_campana_interna_id).toEqual({ [Op.ne]: null });
  });

  it('sigue aceptando el filtro viejo sin_vincular', async () => {
    await MetaReportesService.listarFilas(INQUILINO, { sin_vincular: 'true' });
    expect(argumentos().where.meta_campana_interna_id).toBeNull();
  });

  it('busca por nombre de campaña de Meta', async () => {
    await MetaReportesService.listarFilas(INQUILINO, { busqueda: 'promo' });
    expect(argumentos().where.nombre_campana_meta[Op.iLike]).toBe('%promo%');
  });

  it('ordena por una métrica dejando los nulos al final', async () => {
    // Ordenar por una métrica que muchas filas no traen pondría los
    // huecos arriba y taparía justo lo que se quiere ver.
    await MetaReportesService.listarFilas(INQUILINO, { orden: { campo: 'roas', direccion: 'DESC' } });
    expect(argumentos().order[0]).toEqual(['roas', 'DESC NULLS LAST']);
  });

  it('no deja pasar un campo de orden arbitrario', async () => {
    await MetaReportesService.listarFilas(INQUILINO, { orden: { campo: 'datos_crudos' } });
    expect(argumentos().order[0]).toEqual(['fecha_inicio', 'DESC NULLS LAST']);
  });
});

describe('_periodoAnterior — comparación contra el período previo', () => {
  it('devuelve el tramo inmediatamente anterior, de igual largo', () => {
    expect(MetaReportesService._periodoAnterior('2026-09-01', '2026-09-10'))
      .toEqual({ fecha_desde: '2026-08-22', fecha_hasta: '2026-08-31' });
    expect(MetaReportesService._periodoAnterior('2026-09-10', '2026-09-10'))
      .toEqual({ fecha_desde: '2026-09-09', fecha_hasta: '2026-09-09' });
  });

  it('no compara si el rango es abierto o está invertido', () => {
    expect(MetaReportesService._periodoAnterior('2026-09-01', null)).toBeNull();
    expect(MetaReportesService._periodoAnterior(null, null)).toBeNull();
    expect(MetaReportesService._periodoAnterior('2026-09-10', '2026-09-01')).toBeNull();
  });
});
