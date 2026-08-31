/**
 * Page Builder — FASE 4: renderer público.
 *
 * La regla que estos tests protegen: EL VISITANTE NUNCA VE EL BORRADOR.
 * Se carga exclusivamente published_version_id. Si alguien "arregla" el
 * service para que caiga al draft cuando no hay publicada, se cae acá.
 */

jest.mock('../models', () => ({
  BuilderDomain: { findOne: jest.fn() },
  BuilderPage: { findOne: jest.fn(), findByPk: jest.fn() },
  BuilderPageVersion: { findByPk: jest.fn() },
  BuilderFunnel: { findOne: jest.fn(), findByPk: jest.fn() },
  BuilderFunnelPage: { findOne: jest.fn(), findAll: jest.fn() },
}));

const {
  BuilderDomain, BuilderPage, BuilderPageVersion, BuilderFunnel, BuilderFunnelPage,
} = require('../models');
const BuilderPublicPageService = require('../services/builderPublicPage.service');

const PUBLICADA = {
  id: 700, version: 1,
  html: '<h1>Creatina</h1>', css: 'h1{color:#111}', js: 'console.log(1)',
};
const BORRADOR = {
  id: 900, version: 2,
  html: '<h1>NO PUBLICADO</h1>', css: '', js: '',
};

function paginaMock(extra = {}) {
  return {
    id: 10, nombre: 'Landing', slug: 'landing-aaa111', funnel_id: null,
    published_version_id: 700, draft_version_id: 900,
    seo_titulo: null, seo_descripcion: null,
    og_titulo: null, og_descripcion: null, og_imagen: null, favicon_url: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  BuilderPageVersion.findByPk.mockImplementation(async (id) => {
    if (id === 700) return PUBLICADA;
    if (id === 900) return BORRADOR;
    return null;
  });
  BuilderFunnelPage.findAll.mockResolvedValue([]);
});

// ───────────────────────────────────────────────────────────────────────
describe('Solo se sirve la versión publicada (T-8)', () => {

  test('devuelve el código de la publicada, no el del borrador', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    const res = await BuilderPublicPageService.porSlugSuelto('landing-aaa111');

    expect(res.codigo.html).toBe(PUBLICADA.html);
    expect(res.codigo.html).not.toContain('NO PUBLICADO');
    expect(res.version).toBe(1);
    expect(BuilderPageVersion.findByPk).toHaveBeenCalledWith(700);
  });

  test('una página con borrador pero sin publicar es 404 "en construcción"', async () => {
    // Tiene draft_version_id, o sea que hay código guardado. Da igual:
    // sin published_version_id, para el visitante no existe.
    BuilderPage.findOne.mockResolvedValue(paginaMock({
      published_version_id: null, draft_version_id: 900,
    }));

    await expect(BuilderPublicPageService.porSlugSuelto('landing-aaa111'))
      .rejects.toMatchObject({ status: 404, enConstruccion: true });

    expect(BuilderPageVersion.findByPk).not.toHaveBeenCalled();
  });

  test('nunca consulta draft_version_id en el camino público', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());
    await BuilderPublicPageService.porSlugSuelto('landing-aaa111');
    expect(BuilderPageVersion.findByPk).not.toHaveBeenCalledWith(900);
  });

  test('un slug que no existe da 404', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    await expect(BuilderPublicPageService.porSlugSuelto('no-existe'))
      .rejects.toMatchObject({ status: 404 });
  });

  test('busca solo entre las páginas SUELTAS', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());
    await BuilderPublicPageService.porSlugSuelto('landing-aaa111');
    expect(BuilderPage.findOne).toHaveBeenCalledWith({
      where: { slug: 'landing-aaa111', funnel_id: null },
    });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Resolución por hostname', () => {

  test('solo resuelve hostnames verificados Y con certificado activo', async () => {
    BuilderDomain.findOne.mockResolvedValue(null);
    await BuilderPublicPageService.resolverHostname('calcula.gesicomm.com');

    // Un dominio propio a medio verificar no puede secuestrar tráfico.
    expect(BuilderDomain.findOne).toHaveBeenCalledWith({
      where: {
        hostname: 'calcula.gesicomm.com',
        estado_verificacion: 'verificado',
        estado_ssl: 'activo',
      },
    });
  });

  test('normaliza mayúsculas y descarta el puerto', async () => {
    BuilderDomain.findOne.mockResolvedValue(null);
    await BuilderPublicPageService.resolverHostname('CALCULA.Gesicomm.com:443');
    expect(BuilderDomain.findOne.mock.calls[0][0].where.hostname).toBe('calcula.gesicomm.com');
  });

  test('un host vacío no consulta la base', async () => {
    expect(await BuilderPublicPageService.resolverHostname('')).toBeNull();
    expect(BuilderDomain.findOne).not.toHaveBeenCalled();
  });

  test('el hostname de una página suelta la sirve en la raíz', async () => {
    BuilderPage.findByPk.mockResolvedValue(paginaMock());
    const res = await BuilderPublicPageService.porHostname({ pagina_id: 10, funnel_id: null }, null);
    expect(res.codigo.html).toBe(PUBLICADA.html);
  });

  test('y cualquier sub-path suyo es 404, no un alias', async () => {
    // calcula.gesicomm.com/lo-que-sea no puede devolver la misma página:
    // sería contenido duplicado en infinitas URLs.
    await expect(
      BuilderPublicPageService.porHostname({ pagina_id: 10, funnel_id: null }, 'lo-que-sea'),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Funnels', () => {

  const funnel = { id: 7, nombre: 'Creatina', slug: 'creatina' };

  beforeEach(() => {
    BuilderFunnel.findByPk.mockResolvedValue(funnel);
    BuilderFunnel.findOne.mockResolvedValue(funnel);
  });

  test('la raíz del funnel sirve la página de entrada', async () => {
    BuilderFunnelPage.findOne.mockResolvedValue({ pagina_id: 10, es_entrada: true });
    BuilderPage.findByPk.mockResolvedValue(paginaMock({ funnel_id: 7 }));

    const res = await BuilderPublicPageService.porSlugDeFunnel('creatina', null);

    expect(BuilderFunnelPage.findOne).toHaveBeenCalledWith({
      where: { funnel_id: 7, es_entrada: true },
    });
    expect(res.funnel.slug).toBe('creatina');
  });

  test('si nadie marcó entrada, cae a la de posición más baja', async () => {
    BuilderFunnelPage.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ pagina_id: 10, posicion: 1 });
    BuilderPage.findByPk.mockResolvedValue(paginaMock({ funnel_id: 7 }));

    await BuilderPublicPageService.porSlugDeFunnel('creatina', null);

    expect(BuilderFunnelPage.findOne).toHaveBeenNthCalledWith(2, expect.objectContaining({
      order: [['posicion', 'ASC']],
    }));
  });

  test('la navegación EXCLUYE los pasos sin publicar', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ funnel_id: 7, slug: 'landing' }));
    BuilderFunnelPage.findAll.mockResolvedValue([
      { pagina_id: 10, posicion: 1 },
      { pagina_id: 11, posicion: 2 },
      { pagina_id: 12, posicion: 3 },
    ]);
    BuilderPage.findByPk.mockImplementation(async (id) => ({
      10: paginaMock({ id: 10, slug: 'landing', funnel_id: 7 }),
      // La 11 está sin publicar: si apareciera, {{siguiente}} llevaría a un 404.
      11: paginaMock({ id: 11, slug: 'oferta', funnel_id: 7, published_version_id: null }),
      12: paginaMock({ id: 12, slug: 'gracias', funnel_id: 7 }),
    }[id]));

    const res = await BuilderPublicPageService.porSlugDeFunnel('creatina', 'landing');

    expect(res.navegacion.paginas.map(p => p.slug)).toEqual(['landing', 'gracias']);
    expect(res.navegacion.siguiente).toBe('gracias');
    expect(res.navegacion.anterior).toBeNull();
  });

  test('un funnel que no existe da 404', async () => {
    BuilderFunnel.findOne.mockResolvedValue(null);
    await expect(BuilderPublicPageService.porSlugDeFunnel('no-existe'))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('SEO', () => {

  test('cae al nombre de la página si no cargaron título', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ nombre: 'Pág. Creatina' }));
    const res = await BuilderPublicPageService.porSlugSuelto('landing-aaa111');
    expect(res.seo.titulo).toBe('Pág. Creatina');
    expect(res.seo.og_titulo).toBe('Pág. Creatina');
  });

  test('og_titulo propio gana sobre seo_titulo', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({
      seo_titulo: 'SEO', og_titulo: 'Para compartir',
    }));
    const res = await BuilderPublicPageService.porSlugSuelto('landing-aaa111');
    expect(res.seo.titulo).toBe('SEO');
    expect(res.seo.og_titulo).toBe('Para compartir');
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Preview del borrador', () => {

  test('el dueño sí ve el borrador', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    const res = await BuilderPublicPageService.obtenerPreview(10, 1);

    expect(res.es_borrador).toBe(true);
    expect(res.codigo.html).toContain('NO PUBLICADO');
    expect(BuilderPage.findOne).toHaveBeenCalledWith({ where: { id: 10, usuario_id: 1 } });
  });

  test('otro usuario recibe 404, no el borrador', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    await expect(BuilderPublicPageService.obtenerPreview(10, 999))
      .rejects.toMatchObject({ status: 404 });
  });

  test('una página sin nada guardado no tiene preview', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: null }));
    await expect(BuilderPublicPageService.obtenerPreview(10, 1))
      .rejects.toMatchObject({ status: 404 });
  });
});
