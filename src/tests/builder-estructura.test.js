/**
 * Page Builder — FASE 2: estructura (proyectos, funnels, páginas, orden).
 *
 * Los modelos se simulan, como en el resto de los tests del proyecto: lo
 * que hay que verificar acá es la LÓGICA (ámbito de los slugs, secuencia
 * de operaciones, reindexado, entrada única), no si Sequelize escribe en
 * Postgres. Además evita abrir un pool contra la base, que vive detrás de
 * un túnel y es la de producción.
 */

const mockTX = Symbol('transaction');

jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(async (cb) => cb(mockTX)) },
  BuilderPage: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  BuilderFunnel: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  BuilderFunnelPage: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    max: jest.fn(),
  },
}));

const { sequelize, BuilderPage, BuilderFunnel, BuilderFunnelPage } = require('../models');

// Alias legible: jest exige que las variables usadas dentro de una factory
// de jest.mock se llamen mock* (se hoistea por encima de las const).
const TX = mockTX;
const BuilderPageService = require('../services/builderPage.service');
const BuilderFunnelService = require('../services/builderFunnel.service');

/** Página mínima con los campos que toca serializar(). */
function pagina(extra = {}) {
  return {
    id: 1, proyecto_id: 1, funnel_id: null, nombre: 'Landing', slug: 'landing-aaa111',
    estado: 'draft', draft_version_id: null, published_version_id: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sequelize.transaction.mockImplementation(async (cb) => cb(mockTX));
});

// ───────────────────────────────────────────────────────────────────────
describe('Slugs — ámbito y validación (T-22)', () => {

  test('rechaza los slugs reservados del sistema', async () => {
    for (const reservado of ['p', 'f', 'catalogo', 'api', 'login']) {
      BuilderPage.findOne.mockResolvedValue(null);
      await expect(BuilderPageService.asegurarSlugDisponible(reservado, {}))
        .rejects.toMatchObject({ status: 422 });
    }
  });

  test('rechaza un slug que no deja nada usable', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    for (const malo of ['', '  ', '---', '///', '!!!']) {
      await expect(BuilderPageService.asegurarSlugDisponible(malo, {}))
        .rejects.toMatchObject({ status: 422 });
    }
  });

  test('normaliza en vez de rechazar lo que slugify puede arreglar', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    // Los guiones de los extremos y los espacios se limpian: rechazar
    // esto sería hostil, el usuario quiso escribir un slug válido.
    await expect(BuilderPageService.asegurarSlugDisponible('-arranca-con-guion', {}))
      .resolves.toBe('arranca-con-guion');
    await expect(BuilderPageService.asegurarSlugDisponible('Mi Página Nueva', {}))
      .resolves.toBe('mi-pagina-nueva');
  });

  test('una página SUELTA busca el slug de forma global (funnel_id null)', async () => {
    BuilderPage.findOne.mockResolvedValue(null);

    await BuilderPageService.asegurarSlugDisponible('mi-pagina', { funnel_id: null });

    expect(BuilderPage.findOne).toHaveBeenCalledWith({
      where: { slug: 'mi-pagina', funnel_id: null },
    });
  });

  test('una página DE FUNNEL busca el slug solo dentro de su funnel', async () => {
    BuilderPage.findOne.mockResolvedValue(null);

    await BuilderPageService.asegurarSlugDisponible('landing', { funnel_id: 7 });

    // Sin tienda_id ni usuario_id en el where: el ámbito es el funnel.
    expect(BuilderPage.findOne).toHaveBeenCalledWith({
      where: { slug: 'landing', funnel_id: 7 },
    });
  });

  test('dos funnels distintos pueden tener cada uno su página "landing"', async () => {
    // El slug "landing" existe en el funnel 7 pero no en el 8.
    BuilderPage.findOne.mockImplementation(async ({ where }) =>
      where.funnel_id === 7 && where.slug === 'landing' ? pagina({ funnel_id: 7 }) : null);

    await expect(BuilderPageService.asegurarSlugDisponible('landing', { funnel_id: 7 }))
      .rejects.toMatchObject({ status: 409 });

    await expect(BuilderPageService.asegurarSlugDisponible('landing', { funnel_id: 8 }))
      .resolves.toBe('landing');
  });

  test('el slug autogenerado lleva sufijo aleatorio (no es enumerable)', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    const slug = await BuilderPageService.generarSlugUnico('Mi Página', {});
    expect(slug).toMatch(/^mi-pagina-[0-9a-f]{6}$/);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Crear página (T-1)', () => {

  test('crea una página suelta del usuario, en estado draft', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    BuilderPage.create.mockImplementation(async (datos) => ({ id: 99, ...datos }));

    await BuilderPageService.crear(
      { proyecto_id: 5, usuario_id: 42, inquilino_id: 2, funnel_id: null },
      { nombre: 'Pág. Creatina' },
    );

    const [datos] = BuilderPage.create.mock.calls[0];
    expect(datos).toMatchObject({
      proyecto_id: 5, usuario_id: 42, inquilino_id: 2, funnel_id: null,
      nombre: 'Pág. Creatina', estado: 'draft',
    });
    // Sin tienda_id: una página del builder no pertenece a ninguna tienda.
    expect(datos).not.toHaveProperty('tienda_id');
  });

  test('exige nombre', async () => {
    await expect(BuilderPageService.crear(
      { proyecto_id: 1, usuario_id: 1, inquilino_id: 1 }, { nombre: '   ' },
    )).rejects.toMatchObject({ status: 422 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('NavigationTarget (T-23)', () => {

  test('acepta los tipos que ya resuelven', () => {
    expect(BuilderPageService.validarDestinoCta({ tipo: 'funnel_step', paso: 'next' }))
      .toEqual({ tipo: 'funnel_step', paso: 'next' });
    expect(BuilderPageService.validarDestinoCta({ tipo: 'gesicomm_product', producto_slug: 'creatina' }))
      .toEqual({ tipo: 'gesicomm_product', producto_slug: 'creatina' });
  });

  test('acepta checkout: está declarado aunque todavía no se resuelva', () => {
    expect(BuilderPageService.validarDestinoCta({ tipo: 'checkout', producto_slug: 'creatina' }))
      .toEqual({ tipo: 'checkout', producto_slug: 'creatina' });
  });

  test('rechaza un tipo desconocido', () => {
    expect(() => BuilderPageService.validarDestinoCta({ tipo: 'lo_que_sea' }))
      .toThrow(/desconocido/i);
  });

  test('rechaza javascript: en una URL externa', () => {
    // Este href termina renderizado en una página pública: un esquema
    // javascript: sería XSS con solo compartir el link.
    expect(() => BuilderPageService.validarDestinoCta({ tipo: 'external_url', url: 'javascript:alert(1)' }))
      .toThrow(/http/i);
  });

  test('rechaza un paso de funnel inventado', () => {
    expect(() => BuilderPageService.validarDestinoCta({ tipo: 'funnel_step', paso: 'saltar' }))
      .toThrow(/paso/i);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Crear funnel (T-13)', () => {

  test('genera slug único global y lo deja en draft', async () => {
    BuilderFunnel.findOne.mockResolvedValue(null);
    BuilderFunnel.create.mockImplementation(async (datos) => ({ id: 7, ...datos }));

    await BuilderFunnelService.crear(
      { proyecto_id: 5, usuario_id: 42, inquilino_id: 2 },
      { nombre: 'Creatina' },
    );

    const [datos] = BuilderFunnel.create.mock.calls[0];
    expect(datos).toMatchObject({ proyecto_id: 5, usuario_id: 42, inquilino_id: 2, estado: 'draft' });
    expect(datos.slug).toMatch(/^creatina-[0-9a-f]{6}$/);
    expect(datos).not.toHaveProperty('tienda_id');
  });

  test('la búsqueda de slug de funnel es global, sin tienda', async () => {
    BuilderFunnel.findOne.mockResolvedValue(null);
    await BuilderFunnelService.asegurarSlugDisponible('creatina');
    expect(BuilderFunnel.findOne).toHaveBeenCalledWith({ where: { slug: 'creatina' } });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Agregar páginas al funnel (T-14)', () => {

  beforeEach(() => {
    BuilderFunnel.findOne.mockResolvedValue({
      id: 7, proyecto_id: 5, usuario_id: 42, inquilino_id: 2, slug: 'creatina', nombre: 'Creatina',
    });
    BuilderPage.findOne.mockResolvedValue(null);
    BuilderPage.create.mockImplementation(async (datos) => ({ id: 101, ...datos }));
    BuilderFunnelPage.findAll.mockResolvedValue([]);
  });

  test('la primera página queda como página de entrada', async () => {
    BuilderFunnelPage.max.mockResolvedValue(null); // funnel vacío

    await BuilderFunnelService.agregarPagina(7, 42, { nombre: 'Landing' });

    expect(BuilderFunnelPage.create).toHaveBeenCalledWith(
      expect.objectContaining({ funnel_id: 7, pagina_id: 101, posicion: 1, es_entrada: true }),
      { transaction: TX },
    );
  });

  test('la segunda va al final y NO es la entrada', async () => {
    BuilderFunnelPage.max.mockResolvedValue(1);

    await BuilderFunnelService.agregarPagina(7, 42, { nombre: 'Oferta' });

    expect(BuilderFunnelPage.create).toHaveBeenCalledWith(
      expect.objectContaining({ posicion: 2, es_entrada: false }),
      { transaction: TX },
    );
  });

  test('la página se crea DENTRO de la transacción y con el funnel puesto', async () => {
    BuilderFunnelPage.max.mockResolvedValue(null);

    await BuilderFunnelService.agregarPagina(7, 42, { nombre: 'Landing' });

    // La FK compuesta (pagina_id, funnel_id) exige que la página ya tenga
    // el funnel antes de insertar el paso.
    expect(BuilderPage.create).toHaveBeenCalledWith(
      expect.objectContaining({ funnel_id: 7 }),
      { transaction: TX },
    );
  });

  test('un funnel de otro usuario da 404, no 403', async () => {
    BuilderFunnel.findOne.mockResolvedValue(null);
    await expect(BuilderFunnelService.agregarPagina(7, 999, { nombre: 'X' }))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Reordenar (T-15)', () => {

  const pasos = [
    { id: 1, pagina_id: 10, posicion: 1, es_entrada: true, pagina: pagina({ id: 10, funnel_id: 7 }) },
    { id: 2, pagina_id: 11, posicion: 2, es_entrada: false, pagina: pagina({ id: 11, funnel_id: 7 }) },
    { id: 3, pagina_id: 12, posicion: 3, es_entrada: false, pagina: pagina({ id: 12, funnel_id: 7 }) },
  ];

  beforeEach(() => {
    BuilderFunnel.findOne.mockResolvedValue({ id: 7, usuario_id: 42, slug: 'creatina', nombre: 'C' });
    BuilderFunnelPage.findAll.mockResolvedValue(pasos);
  });

  test('reindexa 1..N sin huecos según el array recibido', async () => {
    await BuilderFunnelService.reordenar(7, 42, [12, 10, 11]);

    const posiciones = BuilderFunnelPage.update.mock.calls.map(([valores, opciones]) => ({
      pagina_id: opciones.where.pagina_id,
      posicion: valores.posicion,
    }));
    expect(posiciones).toEqual([
      { pagina_id: 12, posicion: 1 },
      { pagina_id: 10, posicion: 2 },
      { pagina_id: 11, posicion: 3 },
    ]);
  });

  test('rechaza un orden incompleto (cliente desactualizado)', async () => {
    await expect(BuilderFunnelService.reordenar(7, 42, [10, 11]))
      .rejects.toMatchObject({ status: 409 });
    expect(BuilderFunnelPage.update).not.toHaveBeenCalled();
  });

  test('rechaza ids repetidos', async () => {
    await expect(BuilderFunnelService.reordenar(7, 42, [10, 10, 11]))
      .rejects.toMatchObject({ status: 422 });
  });

  test('rechaza una página que no es del funnel', async () => {
    await expect(BuilderFunnelService.reordenar(7, 42, [10, 11, 99]))
      .rejects.toMatchObject({ status: 409 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Página de entrada (T-16)', () => {

  beforeEach(() => {
    BuilderFunnel.findOne.mockResolvedValue({ id: 7, usuario_id: 42, slug: 'creatina', nombre: 'C' });
    BuilderFunnelPage.findAll.mockResolvedValue([]);
  });

  test('apaga la entrada anterior ANTES de prender la nueva', async () => {
    BuilderFunnelPage.findOne.mockResolvedValue({ id: 3, funnel_id: 7, pagina_id: 12 });

    await BuilderFunnelService.definirEntrada(7, 42, 12);

    // El índice parcial UNIQUE (funnel_id) WHERE es_entrada no es
    // deferrable: si se prendiera primero la nueva, habría dos a la vez y
    // Postgres rechazaría la operación.
    const [primera, segunda] = BuilderFunnelPage.update.mock.calls;
    expect(primera[0]).toEqual({ es_entrada: false });
    expect(primera[1].where).toMatchObject({ funnel_id: 7, es_entrada: true });
    expect(segunda[0]).toEqual({ es_entrada: true });
    expect(segunda[1].where).toMatchObject({ id: 3 });
  });

  test('rechaza una página que no pertenece al funnel', async () => {
    BuilderFunnelPage.findOne.mockResolvedValue(null);
    await expect(BuilderFunnelService.definirEntrada(7, 42, 999))
      .rejects.toMatchObject({ status: 404 });
  });

  test('si se saca la entrada, la primera que queda pasa a serlo', async () => {
    BuilderFunnelPage.findOne
      .mockResolvedValueOnce(null)                                  // no hay entrada
      .mockResolvedValueOnce({ id: 2, funnel_id: 7, posicion: 1 }); // la primera

    await BuilderFunnelService.asegurarEntrada(7, TX);

    expect(BuilderFunnelPage.update).toHaveBeenCalledWith(
      { es_entrada: true },
      { where: { id: 2 }, transaction: TX },
    );
  });

  test('un funnel vacío no marca ninguna entrada', async () => {
    BuilderFunnelPage.findOne.mockResolvedValue(null);
    await BuilderFunnelService.asegurarEntrada(7, TX);
    expect(BuilderFunnelPage.update).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Mover páginas entre funnel y sueltas', () => {

  beforeEach(() => {
    BuilderFunnel.findOne.mockResolvedValue({
      id: 7, proyecto_id: 5, usuario_id: 42, inquilino_id: 2, slug: 'creatina', nombre: 'C',
    });
    BuilderFunnelPage.findAll.mockResolvedValue([]);
    BuilderFunnelPage.findOne.mockResolvedValue(null);
    BuilderFunnelPage.max.mockResolvedValue(null);
  });

  test('adjuntar pone el funnel en la página ANTES de crear el paso', async () => {
    const orden = [];
    const suelta = {
      id: 20, proyecto_id: 5, funnel_id: null, slug: 'oferta', usuario_id: 42,
      save: jest.fn(async () => { orden.push('pagina.funnel_id'); }),
    };
    // 1ª llamada: la página a mover. 2ª: el chequeo de slug libre dentro
    // del funnel, que tiene que dar null para que la pueda adjuntar.
    BuilderPage.findOne.mockResolvedValueOnce(suelta).mockResolvedValue(null);
    BuilderFunnelPage.create.mockImplementation(async () => { orden.push('paso'); });

    await BuilderFunnelService.adjuntarPagina(7, 42, 20);

    expect(suelta.funnel_id).toBe(7);
    expect(orden).toEqual(['pagina.funnel_id', 'paso']);
  });

  test('no deja adjuntar una página de otro proyecto', async () => {
    BuilderPage.findOne.mockResolvedValue({ id: 20, proyecto_id: 99, funnel_id: null, slug: 'x' });
    await expect(BuilderFunnelService.adjuntarPagina(7, 42, 20))
      .rejects.toMatchObject({ status: 409 });
  });

  test('quitar borra el paso ANTES de dejar la página sin funnel', async () => {
    const orden = [];
    const enFunnel = {
      id: 20, proyecto_id: 5, funnel_id: 7, slug: 'oferta',
      save: jest.fn(async () => { orden.push('pagina.funnel_id=null'); }),
    };
    // findOne: 1) la página; 2) el chequeo de slug libre entre las sueltas
    BuilderPage.findOne
      .mockResolvedValueOnce(enFunnel)
      .mockResolvedValue(null);
    BuilderFunnelPage.destroy.mockImplementation(async () => { orden.push('paso'); });

    await BuilderFunnelService.quitarPagina(7, 42, 20);

    // Al revés, la FK compuesta lo rechazaría.
    expect(orden).toEqual(['paso', 'pagina.funnel_id=null']);
    expect(enFunnel.funnel_id).toBeNull();
  });

  test('no deja sacarla si su slug ya lo ocupa otra página suelta', async () => {
    BuilderPage.findOne
      .mockResolvedValueOnce({ id: 20, proyecto_id: 5, funnel_id: 7, slug: 'oferta' })
      .mockResolvedValueOnce(pagina({ id: 33, slug: 'oferta' }));

    await expect(BuilderFunnelService.quitarPagina(7, 42, 20))
      .rejects.toMatchObject({ status: 409 });
    expect(BuilderFunnelPage.destroy).not.toHaveBeenCalled();
  });
});
