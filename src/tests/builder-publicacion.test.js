/**
 * Page Builder — FASE 3: publicación.
 *
 * El escenario completo que tiene que quedar demostrado (T-9 a T-12):
 *
 *   1. La página está publicada en la v1 → el visitante ve la v1.
 *   2. El comercio edita y guarda      → se crea la v2 (draft).
 *   3. El visitante SIGUE VIENDO LA V1.        ← T-10, lo importante
 *   4. El comercio publica             → published_version_id pasa a la v2.
 *   5. Ahora el visitante ve la v2, y la v1 queda archivada.
 *
 * La mitad de "guardar no toca lo publicado" se prueba en
 * builder-versionado.test.js; acá está la otra mitad.
 */

const mockTX = Symbol('transaction');

jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(async (cb) => cb(mockTX)) },
  BuilderPage: { findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), count: jest.fn() },
  BuilderPageVersion: { findOne: jest.fn(), update: jest.fn() },
  BuilderFunnel: { findOne: jest.fn(), findByPk: jest.fn() },
  BuilderFunnelPage: { findAll: jest.fn() },
  BuilderProject: { findByPk: jest.fn() },
  BuilderDomain: { findOne: jest.fn() },
}));

const {
  sequelize, BuilderPage, BuilderPageVersion, BuilderFunnel, BuilderFunnelPage,
  BuilderProject, BuilderDomain,
} = require('../models');
const BuilderPublishService = require('../services/builderPublish.service');

function paginaMock(extra = {}) {
  return {
    id: 10, proyecto_id: 5, funnel_id: null, usuario_id: 1,
    nombre: 'Landing', slug: 'landing-aaa111', estado: 'draft',
    draft_version_id: null, published_version_id: null, published_at: null,
    save: jest.fn(),
    ...extra,
  };
}

function versionMock(extra = {}) {
  return {
    id: 900, pagina_id: 10, version: 2,
    html: '<h1>Creatina</h1>', css: '', js: '',
    estado: 'draft', published_at: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sequelize.transaction.mockImplementation(async (cb) => cb(mockTX));
  BuilderProject.findByPk.mockResolvedValue(null);   // recalcularEstado sale temprano
  BuilderDomain.findOne.mockResolvedValue(null);     // todavía sin hostname
  BuilderPage.count.mockResolvedValue(0);
  BuilderPage.findAll.mockResolvedValue([]);
});

// ───────────────────────────────────────────────────────────────────────
describe('Publicar una página (T-7)', () => {

  test('publica el borrador actual y archiva la versión que estaba publicada', async () => {
    const pagina = paginaMock({
      draft_version_id: 900, published_version_id: 700, estado: 'published',
    });
    BuilderPage.findOne.mockResolvedValue(pagina);
    BuilderPageVersion.findOne.mockResolvedValue(versionMock());

    await BuilderPublishService.publicar(10, 1);

    // La vieja a archivada...
    expect(BuilderPageVersion.update).toHaveBeenCalledWith(
      { estado: 'archived' },
      expect.objectContaining({ where: { id: 700 } }),
    );
    // ...la nueva a publicada, con su fecha.
    expect(BuilderPageVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'published' }),
      expect.objectContaining({ where: { id: 900 } }),
    );
    expect(pagina.published_version_id).toBe(900);
    expect(pagina.estado).toBe('published');
  });

  test('todo va en UNA transacción: no hay instante con la página a medio publicar', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: 900 }));
    BuilderPageVersion.findOne.mockResolvedValue(versionMock());

    await BuilderPublishService.publicar(10, 1);

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
    // Cada escritura lleva la misma transacción.
    for (const [, opciones] of BuilderPageVersion.update.mock.calls) {
      expect(opciones.transaction).toBe(mockTX);
    }
  });

  test('se puede publicar una versión vieja explícita, no solo el borrador', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({
      draft_version_id: 900, published_version_id: 800,
    }));
    BuilderPageVersion.findOne.mockResolvedValue(versionMock({ id: 700, version: 1 }));

    await BuilderPublishService.publicar(10, 1, 700);

    expect(BuilderPageVersion.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 700, pagina_id: 10 } }),
    );
  });

  test('no publica una página sin nada guardado', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());
    await expect(BuilderPublishService.publicar(10, 1)).rejects.toMatchObject({ status: 409 });
  });

  test('no publica una página vacía', async () => {
    // Publicar esto dejaría al visitante mirando una pantalla en blanco
    // sin ninguna pista de por qué.
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: 900 }));
    BuilderPageVersion.findOne.mockResolvedValue(versionMock({ html: '  ', css: '', js: '' }));

    await expect(BuilderPublishService.publicar(10, 1)).rejects.toMatchObject({ status: 422 });
    expect(BuilderPageVersion.update).not.toHaveBeenCalled();
  });

  test('rechaza una versión que no es de esa página', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: 900 }));
    BuilderPageVersion.findOne.mockResolvedValue(null);
    await expect(BuilderPublishService.publicar(10, 1, 12345))
      .rejects.toMatchObject({ status: 404 });
  });

  test('una página de otro usuario da 404', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    await expect(BuilderPublishService.publicar(10, 999)).rejects.toMatchObject({ status: 404 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('El visitante no ve el borrador (T-9 a T-12)', () => {

  test('guardar la v2 no mueve el puntero: el visitante sigue en la v1', async () => {
    // Estado tras publicar la v1 y guardar la v2 (lo hace el service de
    // versiones, ver builder-versionado.test.js).
    const pagina = paginaMock({
      draft_version_id: 900,        // v2, recién guardada
      published_version_id: 700,    // v1, la que se sirve
      estado: 'published',
    });

    // Lo que el renderer público va a cargar es published_version_id.
    expect(pagina.published_version_id).toBe(700);
    expect(pagina.draft_version_id).not.toBe(pagina.published_version_id);
  });

  test('recién al publicar la v2 el visitante pasa a verla', async () => {
    const pagina = paginaMock({
      draft_version_id: 900, published_version_id: 700, estado: 'published',
    });
    BuilderPage.findOne.mockResolvedValue(pagina);
    BuilderPageVersion.findOne.mockResolvedValue(versionMock({ id: 900, version: 2 }));

    await BuilderPublishService.publicar(10, 1);

    expect(pagina.published_version_id).toBe(900);   // ahora sí
    expect(pagina.draft_version_id).toBe(900);       // y ya no hay cambios pendientes
  });

  test('publicar dos veces la misma versión no la archiva a sí misma', async () => {
    const pagina = paginaMock({ draft_version_id: 900, published_version_id: 900 });
    BuilderPage.findOne.mockResolvedValue(pagina);
    BuilderPageVersion.findOne.mockResolvedValue(versionMock({ id: 900 }));

    await BuilderPublishService.publicar(10, 1);

    const archivados = BuilderPageVersion.update.mock.calls
      .filter(([valores]) => valores.estado === 'archived');
    expect(archivados).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Despublicar', () => {

  test('baja la página pero CONSERVA published_at', async () => {
    const antes = new Date('2026-08-01T10:00:00Z');
    const pagina = paginaMock({
      published_version_id: 700, published_at: antes, estado: 'published',
    });
    BuilderPage.findOne.mockResolvedValue(pagina);

    await BuilderPublishService.despublicar(10, 1);

    expect(pagina.published_version_id).toBeNull();
    expect(pagina.estado).toBe('unpublished');
    // published_at es lo único que distingue "se bajó" de "nunca se
    // publicó": si se limpiara, los dos estados serían iguales.
    expect(pagina.published_at).toBe(antes);
  });

  test('no se puede despublicar algo que no está publicado', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());
    await expect(BuilderPublishService.despublicar(10, 1)).rejects.toMatchObject({ status: 409 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Publicar un funnel entero', () => {

  beforeEach(() => {
    BuilderFunnel.findOne.mockResolvedValue({ id: 7, usuario_id: 1, estado: 'draft' });
    BuilderFunnel.findByPk.mockResolvedValue({ id: 7, estado: 'draft', save: jest.fn() });
  });

  test('publica las que tienen cambios y saltea las que ya están al día', async () => {
    BuilderFunnelPage.findAll.mockResolvedValue([
      { pagina_id: 10, posicion: 1 },
      { pagina_id: 11, posicion: 2 },
      { pagina_id: 12, posicion: 3 },
    ]);

    const paginas = {
      10: paginaMock({ id: 10, funnel_id: 7, draft_version_id: 900, published_version_id: 700 }),
      11: paginaMock({ id: 11, funnel_id: 7, draft_version_id: 901, published_version_id: 901 }),
      12: paginaMock({ id: 12, funnel_id: 7, draft_version_id: null }),
    };
    BuilderPage.findByPk.mockImplementation(async (id) => paginas[id]);
    BuilderPage.findOne.mockImplementation(async ({ where }) => paginas[where.id] || null);
    BuilderPageVersion.findOne.mockResolvedValue(versionMock());

    const res = await BuilderPublishService.publicarFunnel(7, 1);

    expect(res.publicadas).toEqual([10]);
    expect(res.salteadas.map(s => s.pagina_id)).toEqual([11, 12]);
    expect(res.fallidas).toHaveLength(0);
  });

  test('una página que falla no frena a las demás', async () => {
    BuilderFunnelPage.findAll.mockResolvedValue([
      { pagina_id: 10, posicion: 1 },
      { pagina_id: 11, posicion: 2 },
    ]);

    const paginas = {
      10: paginaMock({ id: 10, funnel_id: 7, draft_version_id: 900 }),
      11: paginaMock({ id: 11, funnel_id: 7, draft_version_id: 901 }),
    };
    BuilderPage.findByPk.mockImplementation(async (id) => paginas[id]);
    BuilderPage.findOne.mockImplementation(async ({ where }) => paginas[where.id] || null);
    // La primera está vacía, la segunda no.
    BuilderPageVersion.findOne
      .mockResolvedValueOnce(versionMock({ html: '', css: '', js: '' }))
      .mockResolvedValueOnce(versionMock({ id: 901 }));

    const res = await BuilderPublishService.publicarFunnel(7, 1);

    expect(res.fallidas.map(f => f.pagina_id)).toEqual([10]);
    expect(res.publicadas).toEqual([11]);
  });

  test('un funnel sin páginas no se puede publicar', async () => {
    BuilderFunnelPage.findAll.mockResolvedValue([]);
    await expect(BuilderPublishService.publicarFunnel(7, 1)).rejects.toMatchObject({ status: 409 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Estado derivado del funnel', () => {

  test('queda published si al menos una página lo está', async () => {
    const funnel = { id: 7, estado: 'draft', save: jest.fn() };
    BuilderFunnel.findByPk.mockResolvedValue(funnel);
    BuilderPage.findAll.mockResolvedValue([
      { published_version_id: null, published_at: null },
      { published_version_id: 900, published_at: new Date() },
    ]);

    expect(await BuilderPublishService.recalcularEstadoFunnel(7)).toBe('published');
    expect(funnel.estado).toBe('published');
  });

  test('unpublished si ninguna está publicada pero alguna lo estuvo', async () => {
    BuilderFunnel.findByPk.mockResolvedValue({ id: 7, estado: 'published', save: jest.fn() });
    BuilderPage.findAll.mockResolvedValue([
      { published_version_id: null, published_at: new Date() },
    ]);

    expect(await BuilderPublishService.recalcularEstadoFunnel(7)).toBe('unpublished');
  });

  test('draft si ninguna se publicó nunca', async () => {
    BuilderFunnel.findByPk.mockResolvedValue({ id: 7, estado: 'draft', save: jest.fn() });
    BuilderPage.findAll.mockResolvedValue([{ published_version_id: null, published_at: null }]);

    expect(await BuilderPublishService.recalcularEstadoFunnel(7)).toBe('draft');
  });

  test('una página suelta no dispara el recálculo de ningún funnel', async () => {
    expect(await BuilderPublishService.recalcularEstadoFunnel(null)).toBeNull();
    expect(BuilderFunnel.findByPk).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('URL pública en la respuesta', () => {

  test('devuelve la URL canónica si la página ya tiene hostname', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: 900 }));
    BuilderPageVersion.findOne.mockResolvedValue(versionMock());
    BuilderDomain.findOne.mockResolvedValue({ hostname: 'calcula.gesicomm.com' });

    const res = await BuilderPublishService.publicar(10, 1);
    expect(res.url_publica).toBe('https://calcula.gesicomm.com');
  });

  test('null si todavía no le asignaron ninguno', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: 900 }));
    BuilderPageVersion.findOne.mockResolvedValue(versionMock());
    BuilderDomain.findOne.mockResolvedValue(null);

    const res = await BuilderPublishService.publicar(10, 1);
    expect(res.url_publica).toBeNull();
  });
});
