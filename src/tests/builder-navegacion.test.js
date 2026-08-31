/**
 * Page Builder — FASE 8: navegación entre páginas.
 *
 * Test puro: no toca modelos. Lo que se verifica es que el HTML del
 * usuario nunca salga con un {{token}} crudo a la vista del visitante, y
 * que los tokens que no resuelven degraden a "#" con una advertencia en
 * vez de romper la página.
 */

const Nav = require('../services/builderNavegacion.service');
const LandingCodigoService = require('../services/landingCodigo.service');

const FUNNEL = { id: 7, slug: 'creatina', nombre: 'Creatina' };
const PAGINAS = [
  { slug: 'landing', nombre: 'Landing', posicion: 1 },
  { slug: 'oferta', nombre: 'Oferta', posicion: 2 },
  { slug: 'gracias', nombre: 'Gracias', posicion: 3 },
];

const ctx = (extra = {}) => ({
  funnel: FUNNEL,
  pagina: { slug: 'oferta' },
  paginas: PAGINAS,
  porHostname: false,
  ...extra,
});

// ───────────────────────────────────────────────────────────────────────
describe('Tokens de navegación', () => {

  test('{{siguiente}} y {{anterior}} llevan a los pasos vecinos', () => {
    const { html } = Nav.resolverTokens(
      '<a href="{{anterior}}">Volver</a><a href="{{siguiente}}">Comprar</a>', ctx(),
    );
    expect(html).toContain('href="/f/creatina/landing"');
    expect(html).toContain('href="/f/creatina/gracias"');
  });

  test('{{inicio}} y {{funnel}} llevan a la entrada', () => {
    const { html } = Nav.resolverTokens('<a href="{{inicio}}">Inicio</a>', ctx());
    expect(html).toContain('href="/f/creatina"');
  });

  test('{{pagina:slug}} lleva a ese paso', () => {
    const { html } = Nav.resolverTokens('<a href="{{pagina:gracias}}">Gracias</a>', ctx());
    expect(html).toContain('href="/f/creatina/gracias"');
  });

  test('tolera espacios adentro del token', () => {
    const { html } = Nav.resolverTokens('<a href="{{ siguiente }}">x</a>', ctx());
    expect(html).toContain('href="/f/creatina/gracias"');
  });

  test('en un hostname propio los pasos cuelgan de la raíz', () => {
    // creatina.gesicomm.com/gracias, no /f/creatina/gracias.
    const { html } = Nav.resolverTokens(
      '<a href="{{siguiente}}">x</a>', ctx({ porHostname: true }),
    );
    expect(html).toContain('href="/gracias"');
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Tokens que no resuelven', () => {

  test('NUNCA queda un {{...}} crudo en el HTML', () => {
    const { html } = Nav.resolverTokens(
      '<a href="{{siguiente}}">a</a><a href="{{no_existe}}">b</a><a href="{{pagina:fantasma}}">c</a>',
      ctx({ pagina: { slug: 'gracias' } }),
    );
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toMatch(/\}\}/);
  });

  test('la última página avisa que {{siguiente}} no lleva a ningún lado', () => {
    const { html, advertencias } = Nav.resolverTokens(
      '<a href="{{siguiente}}">x</a>', ctx({ pagina: { slug: 'gracias' } }),
    );
    expect(html).toContain('href="#"');
    expect(advertencias.join(' ')).toMatch(/última página/i);
  });

  test('la primera avisa lo mismo con {{anterior}}', () => {
    const { advertencias } = Nav.resolverTokens(
      '<a href="{{anterior}}">x</a>', ctx({ pagina: { slug: 'landing' } }),
    );
    expect(advertencias.join(' ')).toMatch(/primera página/i);
  });

  test('una página suelta avisa que no es parte de un funnel', () => {
    const { html, advertencias } = Nav.resolverTokens(
      '<a href="{{siguiente}}">x</a>',
      { funnel: null, pagina: { slug: 'suelta' }, paginas: [], porHostname: false },
    );
    expect(html).toContain('href="#"');
    expect(advertencias.join(' ')).toMatch(/no es parte de un funnel/i);
  });

  test('{{cta}} sin destino configurado avisa en vez de romper', () => {
    const { html, advertencias } = Nav.resolverTokens('<a href="{{cta}}">x</a>', ctx());
    expect(html).toContain('href="#"');
    expect(advertencias.join(' ')).toMatch(/destino de CTA/i);
  });

  test('{{cta}} usa el destino_cta de la página', () => {
    const { html } = Nav.resolverTokens('<a href="{{cta}}">x</a>', ctx({
      destino_cta: { tipo: 'external_url', url: 'https://ejemplo.com' },
    }));
    expect(html).toContain('href="https://ejemplo.com"');
  });

  test('no repite la misma advertencia por cada token igual', () => {
    const { advertencias } = Nav.resolverTokens(
      '<a href="{{siguiente}}">a</a><a href="{{siguiente}}">b</a><a href="{{siguiente}}">c</a>',
      ctx({ pagina: { slug: 'gracias' } }),
    );
    expect(advertencias).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Destinos declarados pero todavía no implementados (T-23)', () => {

  test.each([
    ['checkout', { tipo: 'checkout', producto_slug: 'creatina' }],
    ['upsell', { tipo: 'upsell', oferta_id: 12 }],
    ['gesicomm_product', { tipo: 'gesicomm_product', producto_slug: 'creatina' }],
  ])('%s devuelve "#" con una advertencia, no rompe', (_, target) => {
    const { url, advertencia } = Nav.resolver(target, ctx());
    expect(url).toBe('#');
    expect(advertencia).toBeTruthy();
  });

  test('{{checkout:x}} en el HTML degrada igual', () => {
    const { html, advertencias } = Nav.resolverTokens(
      '<a href="{{checkout:creatina}}">Comprar</a>', ctx(),
    );
    expect(html).toContain('href="#"');
    expect(advertencias).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Los tokens sobreviven al sanitizador (T-19)', () => {

  test('sanitizar() no destruye un {{siguiente}} dentro de un href', () => {
    // Si sanitize-html los descartara por no tener esquema válido, todo
    // el mecanismo de navegación se caería en silencio al guardar.
    const { html } = LandingCodigoService.sanitizar({
      html: '<a href="{{siguiente}}" class="cta">Comprar ahora</a>',
    });
    expect(html).toContain('{{siguiente}}');
    expect(html).toContain('class="cta"');
  });

  test('tampoco los de argumento', () => {
    const { html } = LandingCodigoService.sanitizar({
      html: '<a href="{{pagina:gracias}}">Gracias</a>',
    });
    expect(html).toContain('{{pagina:gracias}}');
  });

  test('y el orden real funciona: se guarda con token y se resuelve al renderizar', () => {
    const guardado = LandingCodigoService.sanitizar({
      html: '<a href="{{siguiente}}">Comprar</a>',
    });
    const { html } = Nav.resolverTokens(guardado.html, ctx());
    expect(html).toContain('href="/f/creatina/gracias"');
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('tieneTokens', () => {

  test('detecta si vale la pena recorrer el HTML', () => {
    expect(Nav.tieneTokens('<a href="{{siguiente}}">x</a>')).toBe(true);
    expect(Nav.tieneTokens('<a href="/algo">x</a>')).toBe(false);
  });

  test('no se queda pegado entre llamadas (lastIndex del regex global)', () => {
    const html = '<a href="{{siguiente}}">x</a>';
    expect(Nav.tieneTokens(html)).toBe(true);
    expect(Nav.tieneTokens(html)).toBe(true);
  });
});
