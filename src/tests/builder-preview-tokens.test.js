/**
 * Page Builder — el bug reportado: "cuando utilizo las etiquetas me tira
 * invalid input syntax for type integer: '{{siguiente}}'".
 *
 * Causa real: el preview en vivo del editor mostraba el HTML SIN resolver
 * los tokens de navegación. Un <a href="{{siguiente}}"> quedaba con ese
 * texto literal como href; al hacer clic dentro del iframe, el navegador
 * navegaba a esa URL cruda, React Router la tomaba como :id de una ruta,
 * y el id llegaba tal cual a un `where: { id }` — Postgres no puede
 * castear "{{siguiente}}" a integer y revienta con un 500 crudo.
 *
 * Dos arreglos, cada uno cubierto acá:
 *  1. El preview en vivo (previsualizar) resuelve los tokens ANTES de
 *     pintarlos, igual que la página pública: nunca debería llegar un
 *     {{token}} crudo al iframe del editor.
 *  2. Aunque algo lo lograra igual (un link a mano, una URL pegada), los
 *     controllers validan que los :id sean enteros ANTES de tocar la
 *     base: un valor no numérico da 404/422 limpio, nunca un 500 con SQL.
 */

jest.mock('../models', () => ({
  BuilderPage: { findOne: jest.fn(), findByPk: jest.fn() },
  BuilderFunnel: { findByPk: jest.fn() },
  BuilderFunnelPage: { findAll: jest.fn() },
}));

const { BuilderPage, BuilderFunnelPage } = require('../models');
const BuilderPageVersionService = require('../services/builderPageVersion.service');
const { idDeRuta, idDeCuerpo } = require('../controllers/builderComun');

function paginaMock(extra = {}) {
  return {
    id: 10, usuario_id: 1, funnel_id: 7, slug: 'oferta',
    destino_cta: null,
    funnel: { id: 7, slug: 'creatina', nombre: 'Creatina' },
    ...extra,
  };
}

beforeEach(() => jest.clearAllMocks());

// ───────────────────────────────────────────────────────────────────────
describe('previsualizar() — el preview en vivo resuelve los tokens', () => {

  test('un {{siguiente}} en el HTML sin guardar sale como URL real, no como texto crudo', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());
    BuilderFunnelPage.findAll.mockResolvedValue([
      { pagina_id: 10, posicion: 1 },
      { pagina_id: 11, posicion: 2 },
    ]);
    BuilderPage.findByPk.mockImplementation(async (id) => ({
      10: { id: 10, slug: 'oferta', published_version_id: 900 },
      11: { id: 11, slug: 'gracias', published_version_id: 900 },
    }[id]));

    const res = await BuilderPageVersionService.previsualizar(10, 1, {
      html: '<a href="{{siguiente}}">Comprar</a>',
    });

    expect(res.codigo.html).not.toMatch(/\{\{/);
    expect(res.codigo.html).toContain('href="/f/creatina/gracias"');
  });

  test('NO guarda nada: previsualizar no toca BuilderPageVersion', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock());
    BuilderFunnelPage.findAll.mockResolvedValue([]);

    // Si esto tocara la tabla de versiones, este mock (que no la declara)
    // tiraría "Cannot read properties of undefined" — la ausencia misma
    // del mock es la aserción.
    await expect(BuilderPageVersionService.previsualizar(10, 1, {
      html: '<a href="{{siguiente}}">x</a>',
    })).resolves.toBeDefined();
  });

  test('una página SUELTA (sin funnel) no revienta: el token degrada a "#"', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ funnel_id: null, funnel: null }));

    const res = await BuilderPageVersionService.previsualizar(10, 1, {
      html: '<a href="{{siguiente}}">x</a>',
    });

    expect(res.codigo.html).toContain('href="#"');
    expect(res.advertencias_navegacion.length).toBeGreaterThan(0);
  });

  test('una página de otro usuario da 404, no ejecuta nada más', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    await expect(BuilderPageVersionService.previsualizar(10, 999, { html: '<p>x</p>' }))
      .rejects.toMatchObject({ status: 404 });
  });

  test('conserva el CSS y el JS tal cual (los tokens solo aplican al HTML)', async () => {
    BuilderPage.findOne.mockResolvedValue(paginaMock({ funnel_id: null, funnel: null }));

    const res = await BuilderPageVersionService.previsualizar(10, 1, {
      html: '<p>x</p>', css: 'p{color:red}', js: 'console.log(1)',
    });

    expect(res.codigo.css).toBe('p{color:red}');
    expect(res.codigo.js).toBe('console.log(1)');
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('idDeRuta / idDeCuerpo — segunda capa: nunca dejar pasar basura a la base', () => {

  const reqCon = (id) => ({ params: { id } });

  test('un {{token}} sin resolver como :id da 404, no un 500 de Postgres', () => {
    expect(() => idDeRuta(reqCon('{{siguiente}}'))).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  test('acepta un entero positivo', () => {
    expect(idDeRuta(reqCon('42'))).toBe(42);
  });

  test.each(['0', '-1', '1.5', 'abc', '', undefined, null, '12; DROP TABLE'])(
    'rechaza %p',
    (valor) => {
      expect(() => idDeRuta(reqCon(valor))).toThrow(expect.objectContaining({ status: 404 }));
    },
  );

  test('acepta espacios alrededor del número (Number() los recorta, no es una falla)', () => {
    expect(idDeRuta(reqCon('  12  '))).toBe(12);
  });

  test('idDeCuerpo: ausente es válido (null), no un error', () => {
    expect(idDeCuerpo({ body: {} }, 'version_id')).toBeNull();
    expect(idDeCuerpo({ body: { version_id: null } }, 'version_id')).toBeNull();
  });

  test('idDeCuerpo: presente pero no numérico es 422, no revienta la consulta', () => {
    expect(() => idDeCuerpo({ body: { version_id: '{{siguiente}}' } }, 'version_id'))
      .toThrow(expect.objectContaining({ status: 422 }));
  });

  test('idDeCuerpo: un entero válido se devuelve como number', () => {
    expect(idDeCuerpo({ body: { pagina_id: '7' } }, 'pagina_id')).toBe(7);
  });
});
