'use strict';

/**
 * Sanitizador del modo "Lienzo en blanco" — la landing que el comercio
 * arma escribiendo HTML/CSS/JS a mano (template kind='codigo', ver
 * landingSimple.service.js). Es el ÚNICO lugar donde ese código se limpia:
 * el editor del frontend previsualiza lo que quiera, pero lo que se guarda
 * y lo que se publica pasa siempre por acá.
 *
 * Modelo de seguridad, en dos capas — ninguna alcanza sola:
 *
 * 1) Esta sanitización (servidor, al guardar). El HTML pasa por
 *    sanitize-html con un whitelist de tags/atributos; el CSS por un
 *    filtro propio; el JS NO se puede sanitizar de verdad (no existe tal
 *    cosa: cualquier blocklist de strings se evade), así que acá solo se
 *    RECHAZA el guardado cuando aparecen construcciones que en una landing
 *    no tienen ningún uso legítimo y sí sirven para escapar o exfiltrar.
 *
 * 2) El aislamiento del render (navegador). El documento se pinta dentro
 *    de un <iframe sandbox="allow-scripts ..."> SIN allow-same-origin: el
 *    origen del iframe es opaco, así que ese JS no puede leer la cookie de
 *    sesión de la tienda, ni su localStorage, ni el DOM de la página
 *    contenedora, y el CSP embebido le corta connect-src. Ver
 *    pages/landing-simple/construirDocumentoCodigo.js en el frontend.
 *
 * La capa 2 es la que realmente contiene; la 1 evita que llegue basura
 * obvia a la base y le avisa al comercio qué se le quitó.
 *
 * CONTRATO: el HTML que sale de acá se renderiza SIEMPRE dentro de ese
 * iframe sandbox y en ningún otro lado. Por eso se aceptan atributos de
 * evento inline (onclick="..."): sin ellos no funciona ninguna plantilla
 * pegada de afuera, y dentro del sandbox no son más peligrosos que el
 * <script> que igual se permite. Su contenido pasa por el MISMO blocklist
 * que la pestaña JS. Si algún día este HTML se inyectara en una página
 * que no sea el iframe (un SSR de la landing, por ejemplo), hay que
 * sacarlos antes.
 */

// Versión clavada (sin ^) a propósito: desde sanitize-html 2.14 la
// dependencia htmlparser2 es ESM puro y Jest (CJS, sin babel configurado
// en este proyecto) no la puede cargar — los tests del sanitizador
// revientan al require(). Ver src/tests/landing-codigo.test.js.
const sanitizeHtml = require('sanitize-html');

// Límites por campo — un lienzo en blanco es una landing, no una app.
const MAX_HTML = 200 * 1024;
const MAX_CSS = 100 * 1024;
const MAX_JS = 50 * 1024;

// Embeds que sí tienen sentido en una landing. Cualquier otro <iframe> se
// descarta (sanitize-html valida el host del src contra esta lista).
const IFRAMES_PERMITIDOS = [
  'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtu.be',
  'player.vimeo.com', 'www.google.com', 'maps.google.com',
  'www.instagram.com', 'www.tiktok.com', 'open.spotify.com',
];

const ATRIBUTOS_GLOBALES = [
  'class', 'id', 'style', 'title', 'role', 'lang', 'dir', 'hidden', 'tabindex',
  'data-*', 'aria-*',
  // Ver CONTRATO en la cabecera: se aceptan porque todo esto corre dentro
  // del iframe sandbox, y su contenido se revisa con revisarJs() igual que
  // la pestaña JS.
  'on*',
];

// Atributos de SVG inline — las landings de código los usan para íconos.
const ATRIBUTOS_SVG = [
  'viewbox', 'xmlns', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'width', 'height', 'x', 'y', 'x1',
  'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform',
  'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
  'preserveaspectratio', 'fill-rule', 'clip-rule', 'href',
];

const svgAttrs = () => ATRIBUTOS_SVG.concat(ATRIBUTOS_GLOBALES);

const OPCIONES_HTML = {
  // Sin 'script' ni 'style': el JS y el CSS son campos aparte del editor,
  // no algo que se cuele dentro del HTML.
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img', 'picture', 'source', 'video', 'audio', 'track',
    'button', 'form', 'input', 'textarea', 'select', 'option', 'optgroup',
    'label', 'fieldset', 'legend', 'details', 'summary', 'dialog',
    'svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
    'g', 'defs', 'lineargradient', 'radialgradient', 'stop', 'use', 'symbol',
    'desc', 'mask', 'clippath', 'text', 'tspan',
    'iframe', 'canvas', 'progress', 'meter', 'output',
    // <template> es el molde de las listas del runtime de Gesicomm
    // (data-gesicomm-lista, ver runtimeGesicomm.js en el frontend). Su
    // contenido es inerte hasta que el runtime lo clona, y sus hijos pasan
    // por este mismo whitelist como cualquier otro nodo.
    'template',
    // <link> para hojas de estilo externas (Google Fonts es el caso real).
    // Cargar un script por acá no sirve: el CSP del documento solo admite
    // script inline. Ver construirDocumentoCodigo.js.
    'link',
  ],
  allowedAttributes: {
    '*': ATRIBUTOS_GLOBALES,
    a: [...ATRIBUTOS_GLOBALES, 'href', 'name', 'target', 'rel', 'download'],
    img: [...ATRIBUTOS_GLOBALES, 'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
    source: [...ATRIBUTOS_GLOBALES, 'src', 'srcset', 'sizes', 'type', 'media'],
    video: [...ATRIBUTOS_GLOBALES, 'src', 'poster', 'controls', 'autoplay', 'muted', 'loop', 'playsinline', 'preload', 'width', 'height'],
    audio: [...ATRIBUTOS_GLOBALES, 'src', 'controls', 'autoplay', 'muted', 'loop', 'preload'],
    track: [...ATRIBUTOS_GLOBALES, 'src', 'kind', 'srclang', 'label', 'default'],
    iframe: [...ATRIBUTOS_GLOBALES, 'src', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'frameborder', 'referrerpolicy'],
    form: [...ATRIBUTOS_GLOBALES, 'action', 'method', 'target', 'name', 'novalidate'],
    input: [...ATRIBUTOS_GLOBALES, 'type', 'name', 'value', 'placeholder', 'required', 'checked', 'disabled', 'readonly', 'min', 'max', 'step', 'pattern', 'maxlength', 'minlength', 'autocomplete', 'multiple', 'accept'],
    textarea: [...ATRIBUTOS_GLOBALES, 'name', 'placeholder', 'rows', 'cols', 'required', 'disabled', 'readonly', 'maxlength'],
    select: [...ATRIBUTOS_GLOBALES, 'name', 'required', 'disabled', 'multiple', 'size'],
    option: [...ATRIBUTOS_GLOBALES, 'value', 'selected', 'disabled', 'label'],
    optgroup: [...ATRIBUTOS_GLOBALES, 'label', 'disabled'],
    button: [...ATRIBUTOS_GLOBALES, 'type', 'name', 'value', 'disabled'],
    label: [...ATRIBUTOS_GLOBALES, 'for'],
    link: [...ATRIBUTOS_GLOBALES, 'rel', 'href', 'as', 'type', 'media', 'crossorigin', 'referrerpolicy'],
    details: [...ATRIBUTOS_GLOBALES, 'open'],
    dialog: [...ATRIBUTOS_GLOBALES, 'open'],
    canvas: [...ATRIBUTOS_GLOBALES, 'width', 'height'],
    progress: [...ATRIBUTOS_GLOBALES, 'value', 'max'],
    meter: [...ATRIBUTOS_GLOBALES, 'value', 'min', 'max', 'low', 'high', 'optimum'],
    td: [...ATRIBUTOS_GLOBALES, 'colspan', 'rowspan', 'headers'],
    th: [...ATRIBUTOS_GLOBALES, 'colspan', 'rowspan', 'headers', 'scope'],
    ol: [...ATRIBUTOS_GLOBALES, 'start', 'reversed', 'type'],
    time: [...ATRIBUTOS_GLOBALES, 'datetime'],
    svg: svgAttrs(),
    path: svgAttrs(),
    circle: svgAttrs(),
    ellipse: svgAttrs(),
    rect: svgAttrs(),
    line: svgAttrs(),
    polyline: svgAttrs(),
    polygon: svgAttrs(),
    g: svgAttrs(),
    defs: svgAttrs(),
    lineargradient: svgAttrs(),
    radialgradient: svgAttrs(),
    stop: svgAttrs(),
    use: svgAttrs(),
    symbol: svgAttrs(),
    mask: svgAttrs(),
    clippath: svgAttrs(),
    text: svgAttrs(),
    tspan: svgAttrs(),
  },
  // 'data:' solo para imágenes: un data: URI en un <a href> es una vía
  // clásica de navegar a un documento controlado por el atacante.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'], source: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'srcset', 'cite', 'action'],
  allowedIframeHostnames: IFRAMES_PERMITIDOS,
  allowProtocolRelative: false,
  // Sin esto, el CONTENIDO de un <script> descartado quedaría como texto
  // suelto dentro del body.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  disallowedTagsMode: 'discard',
  exclusiveFilter: frame => esAvisoIaVisible(frame.text),
};

// Construcciones prohibidas en el CSS. url() con http(s)/data: se permite
// (fuentes e imágenes son parte de armar una landing).
const CSS_PROHIBIDO = [
  { re: /@import\b/i, motivo: '@import (las fuentes externas se guardan en el campo fonts y Gesicomm las carga en el <head>)' },
  { re: /expression\s*\(/i, motivo: 'expression()' },
  { re: /-moz-binding/i, motivo: '-moz-binding' },
  { re: /(^|[;{}\s])behavior\s*:/i, motivo: 'behavior:' },
  { re: /url\s*\(\s*['"]?\s*(javascript|vbscript)\s*:/i, motivo: 'url(javascript:)' },
  { re: /<\s*\/?\s*(style|script)\b/i, motivo: 'etiquetas <style>/<script> dentro del CSS' },
];

/**
 * Construcciones que se rechazan en el JS. NO es una sanitización — el JS
 * no se puede sanitizar (ver cabecera). Es una lista corta de cosas que en
 * una landing no sirven para nada y sí para escapar del sandbox, robarle
 * datos al visitante o mandarlos afuera. Lo que contiene de verdad es el
 * iframe sandbox + el CSP del documento.
 */
const JS_PROHIBIDO = [
  { re: /document\s*\.\s*cookie/i, motivo: 'document.cookie' },
  { re: /\b(localStorage|sessionStorage|indexedDB)\b/i, motivo: 'almacenamiento del navegador (localStorage/sessionStorage/indexedDB)' },
  { re: /\b(window\s*\.\s*)?(parent|top|opener)\s*\./i, motivo: 'acceso a la ventana contenedora (parent/top/opener)' },
  { re: /\bfetch\s*\(/i, motivo: 'fetch()' },
  { re: /\bXMLHttpRequest\b/i, motivo: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/i, motivo: 'WebSocket' },
  { re: /\bEventSource\b/i, motivo: 'EventSource' },
  { re: /navigator\s*\.\s*sendBeacon/i, motivo: 'navigator.sendBeacon' },
  { re: /\beval\s*\(/i, motivo: 'eval()' },
  { re: /new\s+Function\s*\(/i, motivo: 'new Function()' },
  { re: /\bimport\s*\(/i, motivo: 'import() dinámico' },
  { re: /document\s*\.\s*write\b/i, motivo: 'document.write' },
  { re: /\bpostMessage\s*\(/i, motivo: 'postMessage' },
  { re: /\bserviceWorker\b/i, motivo: 'serviceWorker' },
  { re: /<\s*\/?\s*script\b/i, motivo: 'etiquetas <script> dentro del JS' },
];

const AVISOS_IA_EN_LANDING = [
  /experiencias?\s+mostradas?/i,
  /no\s+corresponden\s+necesariamente/i,
  /resultados?\s+individuales?\s+pueden\s+variar/i,
  /resultados?\s+pueden\s+variar\s+seg[uú]n\s+cada\s+persona/i,
];

function esAvisoIaVisible(texto) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  return limpio.length > 0
    && limpio.length <= 1200
    && AVISOS_IA_EN_LANDING.some(re => re.test(limpio));
}

function jsSinComentarios(js) {
  const texto = String(js || '');
  let salida = '';
  let i = 0;
  let quote = null;
  let escapado = false;

  while (i < texto.length) {
    const actual = texto[i];
    const siguiente = texto[i + 1];

    if (quote) {
      salida += actual;
      if (escapado) {
        escapado = false;
      } else if (actual === '\\') {
        escapado = true;
      } else if (actual === quote) {
        quote = null;
      }
      i += 1;
      continue;
    }

    if (actual === '"' || actual === "'" || actual === '`') {
      quote = actual;
      salida += actual;
      i += 1;
      continue;
    }

    if (actual === '/' && siguiente === '/') {
      salida += '  ';
      i += 2;
      while (i < texto.length && texto[i] !== '\n') {
        salida += ' ';
        i += 1;
      }
      continue;
    }

    if (actual === '/' && siguiente === '*') {
      salida += '  ';
      i += 2;
      while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) {
        salida += texto[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < texto.length) {
        salida += '  ';
        i += 2;
      }
      continue;
    }

    salida += actual;
    i += 1;
  }

  return salida;
}

// Marcas de que lo pegado en la pestaña HTML no es un fragmento sino una
// página entera. Es el caso normal: el comercio copia una plantilla de
// afuera (o se la genera una IA) y la pega tal cual en el primer campo.
const ES_DOCUMENTO_COMPLETO = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i;
const TIENE_BLOQUES_EMBEBIDOS = /<\s*(style|script)\b|<link\b/i;

/** Concatena dos bloques de código sin dejar líneas en blanco de más. */
function unir(existente, agregado) {
  const a = String(existente || '').trim();
  const b = String(agregado || '').trim();
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n${b}`;
}

function limpiarFonts(fonts) {
  const lista = Array.isArray(fonts) ? fonts : [];
  const salida = [];
  const vistos = new Set();
  for (const valor of lista) {
    try {
      const url = new URL(String(valor || '').trim());
      if (url.protocol !== 'https:') continue;
      if (url.hostname !== 'fonts.googleapis.com') continue;
      if (!url.pathname.startsWith('/css2')) continue;
      const limpio = url.toString();
      if (vistos.has(limpio)) continue;
      vistos.add(limpio);
      salida.push(limpio);
      if (salida.length >= 4) break;
    } catch {
      // URL inválida: se ignora.
    }
  }
  return salida;
}

function limpiarDesignContext(valor, profundidad = 0) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) || profundidad > 2) return {};
  const salida = {};
  for (const [clave, crudo] of Object.entries(valor).slice(0, 20)) {
    const k = String(clave || '').replace(/[^\w-]/g, '').slice(0, 40);
    if (!k) continue;
    if (typeof crudo === 'string' || typeof crudo === 'number' || typeof crudo === 'boolean' || crudo === null) {
      salida[k] = typeof crudo === 'string' ? crudo.replace(/\s+/g, ' ').trim().slice(0, 160) : crudo;
    } else if (crudo && typeof crudo === 'object' && !Array.isArray(crudo)) {
      salida[k] = limpiarDesignContext(crudo, profundidad + 1);
    }
  }
  return salida;
}

function extraerFontsDeHtml(html) {
  const fonts = [];
  const sinLinks = String(html || '').replace(/<link\b[^>]*>/gi, (link) => {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(link)) return '';
    const href = (link.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i) || []).slice(1).find(Boolean);
    if (href) fonts.push(href);
    return '';
  });
  return { html: sinLinks, fonts };
}

class LandingCodigoService {

  /**
   * Desarma un documento HTML completo en los tres campos del editor: el
   * contenido de los <style> va al CSS, el de los <script> al JS, y del
   * resto se conserva solo lo que había dentro del <body>.
   *
   * Sin esto, pegar una plantilla entera daba una landing muerta: el
   * sanitizador descartaba <style> y <script> (van en otras pestañas) y
   * quedaba el marcado pelado, sin estilos ni interacción.
   *
   * Es una separación por regex, no un parseo: alcanza porque lo único
   * que se busca son los bloques <style>/<script> de primer nivel y el
   * cuerpo. Lo que salga de acá igual pasa por sanitizeHtml después.
   *
   * @returns {{html: string, css: string, js: string, advertencias: string[]}}
   *   css/js son lo EXTRAÍDO (hay que sumarlo a lo que ya tenía el campo).
   */
  static separarDocumentoCompleto(htmlOriginal) {
    const original = String(htmlOriginal || '');
    const esDocumentoCompleto = ES_DOCUMENTO_COMPLETO.test(original);
    const tieneBloquesEmbebidos = TIENE_BLOQUES_EMBEBIDOS.test(original);
    if (!esDocumentoCompleto && !tieneBloquesEmbebidos) {
      return { html: original, css: '', js: '', fonts: [], advertencias: [] };
    }

    const advertencias = [];
    const estilos = [];
    const scripts = [];
    let resto = original;

    resto = resto.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, cuerpo) => {
      estilos.push(cuerpo.trim());
      return '';
    });

    resto = resto.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_m, atributos, cuerpo) => {
      // Un <script src="..."> no se puede traer: el CSP del documento solo
      // admite script inline, así que cargarlo nunca funcionaría.
      if (/\bsrc\s*=/i.test(atributos)) {
        advertencias.push('Se quitó un <script src="..."> externo: la landing no puede cargar scripts de otros servidores.');
      } else if (cuerpo.trim()) {
        scripts.push(cuerpo.trim());
      }
      return '';
    });

    // Los <link rel="stylesheet"> viven en el <head>; se convierten al
    // campo `fonts` para que el render los inyecte donde corresponde.
    const links = [];
    resto.replace(/<link\b[^>]*>/gi, (m) => { links.push(m); return m; });
    const fonts = extraerFontsDeHtml(links.join('\n')).fonts;

    const cuerpo = resto.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
    if (cuerpo) {
      resto = cuerpo[1];
    } else {
      resto = resto
        .replace(/<!doctype[^>]*>/gi, '')
        .replace(/<\/?(html|head|body)\b[^>]*>/gi, '');
    }
    resto = extraerFontsDeHtml(resto).html;

    const origen = esDocumentoCompleto ? 'una página completa' : 'HTML con bloques embebidos';
    if (estilos.length) advertencias.push(`Pegaste ${origen}: el contenido de ${estilos.length === 1 ? 'su <style>' : `sus ${estilos.length} <style>`} se movió a la pestaña CSS.`);
    if (scripts.length) advertencias.push(`Pegaste ${origen}: el contenido de ${scripts.length === 1 ? 'su <script>' : `sus ${scripts.length} <script>`} se movió a la pestaña JavaScript.`);
    if (esDocumentoCompleto && !estilos.length && !scripts.length) advertencias.push('Pegaste una página completa: se conservó solo lo que había dentro del <body>.');

    return {
      html: resto.trim(),
      css: estilos.join('\n\n'),
      js: scripts.join('\n\n'),
      fonts,
      advertencias,
    };
  }

  /**
   * Los onclick="..." y demás atributos de evento son JavaScript y se
   * revisan con las mismas reglas que la pestaña JS — si no, poner el
   * código en un onclick sería la forma trivial de saltear el blocklist.
   *
   * @returns {string[]} motivos (vacío = OK)
   */
  static revisarEventosInline(html) {
    const errores = new Set();
    const re = /\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let m;
    while ((m = re.exec(String(html || ''))) !== null) {
      const codigo = m[1] ?? m[2] ?? m[3] ?? '';
      for (const motivo of this.revisarJs(codigo)) {
        errores.add(motivo.replace('El JavaScript no puede usar', 'Un atributo de evento del HTML (onclick, etc.) no puede usar'));
      }
    }
    return [...errores];
  }

  static limpiarCss(css) {
    const advertencias = [];
    let salida = String(css || '');
    for (const { re, motivo } of CSS_PROHIBIDO) {
      if (!re.test(salida)) continue;
      advertencias.push(`Se quitó del CSS: ${motivo}.`);
      // Se descarta la línea entera: dejar la regla a medias produce CSS
      // roto y confunde más que borrarla.
      salida = salida.split('\n').filter(linea => !re.test(linea)).join('\n');
    }
    return { css: salida, advertencias };
  }

  static limpiarHtml(html) {
    const original = String(html || '');
    const limpio = sanitizeHtml(original, OPCIONES_HTML);
    const advertencias = [];
    if (/<\s*script\b/i.test(original)) {
      advertencias.push('Se quitaron etiquetas <script> del HTML: el JavaScript va en la pestaña JS.');
    }
    if (/<\s*style\b/i.test(original)) {
      advertencias.push('Se quitaron etiquetas <style> del HTML: el CSS va en la pestaña CSS.');
    }
    return { html: limpio, advertencias };
  }

  /** @returns {string[]} motivos por los que el JS no se puede guardar (vacío = OK) */
  static revisarJs(js) {
    const texto = jsSinComentarios(js);
    return JS_PROHIBIDO
      .filter(({ re }) => re.test(texto))
      .map(({ motivo }) => `El JavaScript no puede usar ${motivo}.`);
  }

  /**
   * Verifica que el JS al menos PARSEE — no lo ejecuta, solo lo compila con
   * `new Function()` para que el motor de JS tire el SyntaxError si lo hay
   * (variable declarada dos veces, paréntesis sin cerrar, etc.). Sin esto,
   * un JS roto se guardaba igual y recién explotaba en el navegador del
   * visitante (o del comercio, mirando el preview) — visto en código
   * generado por IA que declaró la misma constante dos veces.
   *
   * @returns {string[]} motivos (vacío = OK)
   */
  static revisarSintaxisJs(js) {
    const texto = String(js || '').trim();
    if (!texto) return [];
    try {
      // eslint-disable-next-line no-new-func
      new Function(texto);
      return [];
    } catch (err) {
      if (err instanceof SyntaxError) {
        return [`El JavaScript tiene un error de sintaxis y no se puede guardar: ${err.message}.`];
      }
      // Un error que no sea de sintaxis (ReferenceError, etc.) no bloquea:
      // `new Function` no ejecuta el cuerpo, así que esto no debería pasar,
      // pero si pasa no es motivo para rechazar el guardado.
      return [];
    }
  }

  /**
   * Punto de entrada único. Lanza si el código no se puede guardar (mismo
   * contrato de error que el resto de landingSimple: err.errores).
   *
   * @param {{html?: string, css?: string, js?: string}} codigo
   * @returns {{html: string, css: string, js: string, advertencias: string[]}}
   */
  /**
   * @param {{html?: string, css?: string, js?: string}} codigo
   * @param {{maxHtml?: number, maxCss?: number, maxJs?: number, maxTotal?: number}} [opciones]
   *   Límites en bytes. Los defaults son los de una landing y NO cambian:
   *   quien no pasa `opciones` obtiene exactamente el comportamiento de
   *   siempre. El Page Builder pasa los suyos, más altos, porque una
   *   página generada por una IA fácilmente pasa los 200 KB de HTML sola
   *   (ver builderPageVersion.service.js). Es una extensión, no un fork:
   *   este sigue siendo el ÚNICO sanitizador del proyecto.
   */
  static sanitizar(codigo, opciones = {}) {
    const {
      maxHtml = MAX_HTML,
      maxCss = MAX_CSS,
      maxJs = MAX_JS,
      maxTotal = Infinity,
    } = opciones;

    if (codigo === null || typeof codigo !== 'object' || Array.isArray(codigo)) {
      const err = new Error('Validación fallida.');
      err.errores = ['El código de la landing debe ser un objeto {html, css, js}.'];
      throw err;
    }

    // Si vino una página entera en el campo HTML, primero se reparte en
    // los tres campos y recién después se valida — así los límites y el
    // blocklist se aplican sobre lo que realmente se va a guardar.
    const separado = this.separarDocumentoCompleto(codigo.html);
    const htmlConFonts = extraerFontsDeHtml(separado.html);
    const html = htmlConFonts.html;
    // Pegar una página entera encima de un CSS que ya existía deja dos
    // hojas de estilo compitiendo (típico: el código de arranque del
    // lienzo todavía puesto). Se avisa en vez de borrar por las dudas:
    // decidir qué sobra es del comercio, no de acá.
    if (separado.css && String(codigo.css ?? '').trim()) {
      separado.advertencias.push('Revisá la pestaña CSS: arriba quedó el CSS que ya tenías y abajo el de la página que pegaste. Si no lo usás, borralo — puede pisarte estilos.');
    }
    // Lo extraído va DESPUÉS de lo que ya había en el campo: en CSS gana
    // la última regla, así lo recién pegado pisa al código de arranque en
    // vez de quedar tapado por él.
    const css = unir(String(codigo.css ?? ''), separado.css);
    const js = unir(String(codigo.js ?? ''), separado.js);
    const fonts = limpiarFonts([
      ...(Array.isArray(codigo.fonts) ? codigo.fonts : []),
      ...(separado.fonts || []),
      ...htmlConFonts.fonts,
    ]);
    const designContext = limpiarDesignContext(codigo.design_context);

    const errores = [];
    const bytesHtml = Buffer.byteLength(html, 'utf8');
    const bytesCss = Buffer.byteLength(css, 'utf8');
    const bytesJs = Buffer.byteLength(js, 'utf8');

    if (bytesHtml > maxHtml) errores.push(`El HTML supera el máximo de ${Math.round(maxHtml / 1024)} KB.`);
    if (bytesCss > maxCss) errores.push(`El CSS supera el máximo de ${Math.round(maxCss / 1024)} KB.`);
    if (bytesJs > maxJs) errores.push(`El JavaScript supera el máximo de ${Math.round(maxJs / 1024)} KB.`);
    if (bytesHtml + bytesCss + bytesJs > maxTotal) {
      errores.push(`El total de HTML + CSS + JavaScript supera el máximo de ${Math.round(maxTotal / 1024)} KB.`);
    }

    errores.push(...this.revisarSintaxisJs(js));
    errores.push(...this.revisarJs(js));
    errores.push(...this.revisarEventosInline(html));

    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    const htmlLimpio = this.limpiarHtml(html);
    const cssLimpio = this.limpiarCss(css);

    return {
      html: htmlLimpio.html,
      css: cssLimpio.css,
      js,
      fonts,
      design_context: designContext,
      bytes: bytesHtml + bytesCss + bytesJs,
      advertencias: [...separado.advertencias, ...htmlLimpio.advertencias, ...cssLimpio.advertencias],
    };
  }
}

/**
 * Configuración comercial del lienzo en blanco (content.venta): qué tipo de
 * venta arma la landing y cómo se eligieron sus productos. Es público (el
 * runtime del iframe la lee para pintar recomendados y ventas cruzadas), así
 * que se arma campo por campo desde una lista blanca — nunca se guarda el
 * objeto que mandó el cliente.
 *
 * Los productos en sí NO viven acá: siguen siendo LandingItem, que es lo que
 * el checkout acepta. `seleccion`/`categorias` solo recuerdan CÓMO se armó
 * esa lista, para que el editor la pueda volver a mostrar igual.
 */
const TIPOS_VENTA = ['catalogo', 'producto_unico', 'combos'];
const MODOS_SELECCION = ['manual', 'categoria', 'todos'];
const MODOS_RECOMENDADOS = ['auto', 'manual'];
// String, no boolean, a propósito: el día que haga falta un tercer estado
// real (dato importado de otra plataforma, marcado incompleto, etc.) alcanza
// con sumarlo acá, sin migrar nada. 'confirmado' NUNCA sale de lo que manda
// el cliente en `venta` — ver limpiarUrgencia/limpiarPruebaSocial abajo y el
// mecanismo dedicado de confirmación en landingSimple.service.js.
const ESTADOS_CONFIRMACION = ['demo', 'confirmado'];

function textoCorto(valor, max) {
  if (typeof valor !== 'string') return '';
  return valor.trim().slice(0, max);
}

function fechaValidaISO(valor) {
  if (typeof valor !== 'string' || !valor) return null;
  const t = Date.parse(valor);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// El comercio (o la IA vía demo_data) puede mandar `estado`, pero acá se
// ignora siempre: un guardado normal de "Configurar venta" jamás puede dejar
// `confirmado` por accidente. La única puerta hacia 'confirmado' es el flag
// `confirmaciones` que procesa LandingSimpleService.actualizarCodigo DESPUÉS
// de esta limpieza.
// `null` cuando el bloque JAMÁS se configuró (ni el comercio ni una fusión de
// demo_data previa) — a diferencia de un objeto con `activo:false`, que
// significa "se configuró y se dejó/puso apagado". La diferencia importa: es
// la señal que usa AILandingService.fusionarDemoData para decidir si puede
// llenar el hueco con la propuesta de la IA o si ya hay algo del comercio que
// no se debe pisar (ver ese método).
function limpiarUrgencia(urgencia) {
  if (!urgencia || typeof urgencia !== 'object') return null;
  return {
    activo: urgencia.activo === true,
    fin_at: fechaValidaISO(urgencia.fin_at),
    producto_id: contentId(urgencia.producto_id || urgencia.content_id),
    estado: 'demo',
  };
}

function limpiarPruebaSocial(pruebaSocial) {
  if (!pruebaSocial || typeof pruebaSocial !== 'object') return null;
  return {
    activo: pruebaSocial.activo === true,
    producto_id: contentId(pruebaSocial.producto_id || pruebaSocial.content_id),
    items: listaDe(pruebaSocial.items, 8, it => {
      if (!it || typeof it !== 'object') return null;
      const valor = textoCorto(it.valor, 20);
      const etiqueta = textoCorto(it.etiqueta, 120);
      return valor && etiqueta ? { valor, etiqueta } : null;
    }),
    estado: 'demo',
  };
}

function listaDe(valor, max, mapear) {
  if (!Array.isArray(valor)) return [];
  const vistos = new Set();
  const salida = [];
  for (const v of valor) {
    const limpio = mapear(v);
    if (limpio === null || limpio === '' || vistos.has(limpio)) continue;
    vistos.add(limpio);
    salida.push(limpio);
    if (salida.length >= max) break;
  }
  return salida;
}

const enteroPositivo = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
const contentId = v => (typeof v === 'string' && /^[a-z0-9-]{1,200}$/i.test(v) ? v : null);

const TIPOS_SECCION_INICIO = ['categoria', 'ofertas', 'mas_vendidos', 'novedades', 'manual'];
// Mismo criterio que imagenes_landing (ver más abajo): http(s) absoluta, o
// ruta propia del backend (/uploads/...), nunca otro esquema.
const urlMedia = v => (typeof v === 'string' && v.length <= 2048 && (/^https?:\/\/[^\s]+$/i.test(v) || /^\/(?!\/)[^\s]+$/.test(v)) ? v : '');
const TIPOS_MEDIO = ['imagen', 'gif', 'video'];

function limpiarBannerInicio(b) {
  if (!b || typeof b !== 'object') return null;
  return {
    id: textoCorto(b.id, 60) || undefined,
    activo: b.activo !== false,
    titulo: textoCorto(b.titulo, 100),
    subtitulo: textoCorto(b.subtitulo, 160),
    etiqueta: textoCorto(b.etiqueta, 40),
    cta_texto: textoCorto(b.cta_texto, 40),
    enlace: textoCorto(b.enlace, 200),
    imagen: urlMedia(b.imagen),
    tipo_medio: TIPOS_MEDIO.includes(b.tipo_medio) ? b.tipo_medio : 'imagen',
  };
}

function limpiarSeccionInicio(s) {
  if (!s || typeof s !== 'object') return null;
  const limite = Number(s.limite);
  return {
    id: textoCorto(s.id, 60) || undefined,
    activo: s.activo !== false,
    tipo: TIPOS_SECCION_INICIO.includes(s.tipo) ? s.tipo : 'categoria',
    titulo: textoCorto(s.titulo, 100),
    subtitulo: textoCorto(s.subtitulo, 160),
    categoria: textoCorto(s.categoria, 100),
    productos: listaDe(s.productos, 50, contentId),
    limite: Number.isInteger(limite) && limite >= 1 && limite <= 24 ? limite : 4,
  };
}

/**
 * Contenido editable del "Inicio" del lienzo en blanco (menú, banners,
 * categorías visuales y vitrinas) — ver inicioComercialDesdeVenta /
 * normalizarInicioComercial en ConfigurarVentaCodigo.jsx (frontend), el
 * espejo de esta función. `null` si no vino nada: antes esta clave NO se
 * guardaba en absoluto (se perdía al hacer submit), este es el fix.
 */
// Secciones del body del Inicio que el comercio puede reordenar/ocultar como
// bloques (ver EditorBloquesInicio en el frontend). El Menú vive en el header
// fijo y no entra en esta lista — no tiene "posición" que mover.
const TIPOS_BLOQUE_INICIO = [
  'anuncios', 'banner', 'categorias', 'productos_categoria', 'destacados', 'confianza', 'marca',
  'banner_intermedio', 'secciones_inicio', 'mas_vendidos', 'ofertas_urgencia', 'ofertas_catalogo',
  'novedades', 'combos', 'colecciones', 'preguntas', 'contacto',
];
const TIPOS_MEDIO_MARCA = ['imagen', 'gif', 'video'];

// `icono` es una clave libre (igual que en confianza, ver limpiarConfianza):
// el runtime la traduce a un glifo si la reconoce, o cicla íconos por
// defecto si viene vacía — así landings viejas (anuncio como string suelto,
// sin ícono elegido) se siguen viendo igual que antes.
function limpiarAnuncioInicio(it) {
  if (typeof it === 'string') {
    const texto = textoCorto(it, 80);
    return texto ? { texto, icono: '' } : null;
  }
  if (!it || typeof it !== 'object') return null;
  const texto = textoCorto(it.texto, 80);
  return texto ? { texto, icono: textoCorto(it.icono, 40) } : null;
}

function limpiarBloquesInicio(bloques) {
  // Sin lista guardada: no se fuerza ningún orden/visibilidad — el runtime
  // deja la página tal como viene en el HTML (compatibilidad total con
  // landings guardadas antes de que existiera esta lista). `listaDe` no
  // sirve acá porque dedupea por el VALOR mapeado (cada objeto es único por
  // referencia); un bloque repetido se identifica por `tipo`, a mano.
  if (!Array.isArray(bloques)) return [];
  const vistos = new Set();
  const salida = [];
  for (const b of bloques) {
    if (!b || typeof b !== 'object' || !TIPOS_BLOQUE_INICIO.includes(b.tipo) || vistos.has(b.tipo)) continue;
    vistos.add(b.tipo);
    salida.push({ tipo: b.tipo, visible: b.visible !== false });
    if (salida.length >= TIPOS_BLOQUE_INICIO.length) break;
  }
  return salida;
}

function limpiarConfianza(items) {
  return listaDe(items, 3, it => {
    if (!it || typeof it !== 'object') return null;
    const titulo = textoCorto(it.titulo, 60);
    const texto = textoCorto(it.texto, 120);
    if (!titulo && !texto) return null;
    return { icono: textoCorto(it.icono, 40) || 'shield', titulo, texto };
  });
}

function limpiarMedioMarca(m) {
  if (!m || typeof m !== 'object') return null;
  const url = urlMedia(m.url);
  if (!url) return null;
  return { tipo: TIPOS_MEDIO_MARCA.includes(m.tipo) ? m.tipo : 'imagen', url };
}

function limpiarMarca(marca) {
  if (!marca || typeof marca !== 'object') return null;
  return {
    activo: marca.activo === true,
    kicker: textoCorto(marca.kicker, 40),
    titulo: textoCorto(marca.titulo, 100),
    texto: textoCorto(marca.texto, 600),
    badges: listaDe(marca.badges, 6, v => textoCorto(v, 30)),
    medios: listaDe(marca.medios, 5, limpiarMedioMarca),
  };
}

function limpiarProductosCategoria(pc) {
  if (!pc || typeof pc !== 'object') return null;
  const limite = Number(pc.limite);
  return {
    activo: pc.activo === true,
    titulo: textoCorto(pc.titulo, 100),
    kicker: textoCorto(pc.kicker, 40),
    subtitulo: textoCorto(pc.subtitulo, 160),
    items: listaDe(pc.items, 48, contentId),
    limite: Number.isInteger(limite) && limite >= 1 && limite <= 48 ? limite : 8,
  };
}

function limpiarInicio(inicio) {
  if (!inicio || typeof inicio !== 'object') return null;
  return {
    menu_links: listaDe(inicio.menu_links, 8, item => {
      if (!item || typeof item !== 'object') return null;
      const texto = textoCorto(item.texto, 30);
      const destino = textoCorto(item.destino, 200);
      return texto && destino ? { texto, destino, visible: item.visible !== false } : null;
    }),
    menu_categorias: inicio.menu_categorias !== false,
    categorias: listaDe(inicio.categorias, 50, v => textoCorto(v, 100)),
    // null = tamaño legado (alto fijo de siempre, ver TAMANOS_BANNER en el
    // frontend) — no se le asume "mediano" a una landing que nunca tocó el
    // selector.
    banner_tamano: ['pequeno', 'mediano', 'grande'].includes(inicio.banner_tamano) ? inicio.banner_tamano : null,
    banners: listaDe(inicio.banners, 8, limpiarBannerInicio),
    banners_intermedios: listaDe(inicio.banners_intermedios, 4, limpiarBannerInicio),
    secciones: listaDe(inicio.secciones, 8, limpiarSeccionInicio),
    bloques: limpiarBloquesInicio(inicio.bloques),
    anuncios: listaDe(inicio.anuncios, 8, limpiarAnuncioInicio),
    confianza: limpiarConfianza(inicio.confianza),
    ...(() => {
      const marca = limpiarMarca(inicio.marca);
      return marca ? { marca } : {};
    })(),
    ...(() => {
      const productosCategoria = limpiarProductosCategoria(inicio.productos_categoria);
      return productosCategoria ? { productos_categoria: productosCategoria } : {};
    })(),
  };
}

function limpiarPaquetes(paquetes) {
  if (!paquetes || typeof paquetes !== 'object' || Array.isArray(paquetes)) return {};
  const salida = {};
  let destacado = false;
  for (const [clave, conf] of Object.entries(paquetes).slice(0, 50)) {
    const id = enteroPositivo(clave);
    if (!id || !conf || typeof conf !== 'object') continue;
    const etiqueta = String(conf.etiqueta ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const activo = conf.activo !== false;
    // Un solo paquete destacado por landing.
    const esDestacado = activo && conf.destacado === true && !destacado;
    if (esDestacado) destacado = true;
    if (etiqueta || esDestacado || !activo) salida[id] = { etiqueta, destacado: esDestacado, ...(activo ? {} : { activo: false }) };
  }
  return salida;
}

const CAMPOS_BRIEF_COMERCIAL = [
  'prueba_social',
  'objeciones',
  'beneficios',
  'faq',
  'modo_uso_ingredientes',
  'detalles_tecnicos',
  'usos_concretos',
  'guia_talles',
];

function limpiarBriefComercial(brief) {
  const fuente = brief?.respuestas && typeof brief.respuestas === 'object' && !Array.isArray(brief.respuestas)
    ? brief.respuestas
    : brief;
  if (!fuente || typeof fuente !== 'object' || Array.isArray(fuente)) return null;
  const respuestas = {};
  for (const campo of CAMPOS_BRIEF_COMERCIAL) {
    const texto = textoCorto(fuente[campo], 1800);
    if (texto) respuestas[campo] = texto;
  }
  return Object.keys(respuestas).length
    ? { completado: true, respuestas }
    : null;
}

LandingCodigoService.limpiarVenta = function limpiarVenta(venta) {
  if (!venta || typeof venta !== 'object' || Array.isArray(venta)) return null;
  const cross = venta.cross_sell || {};
  const reco = venta.recomendados || {};
  const max = Number(reco.max);
  const briefComercial = limpiarBriefComercial(venta.brief_comercial);
  const tipo = TIPOS_VENTA.includes(venta.tipo) ? venta.tipo : 'catalogo';
  const paymentLogos = Array.isArray(venta.payment_logos)
    ? venta.payment_logos
      .filter(logo => logo && typeof logo === 'object')
      .slice(0, 100)
      .map(logo => ({
        clave: textoCorto(logo.clave, 80),
        grupo: textoCorto(logo.grupo, 60),
        nombre: textoCorto(logo.nombre, 120),
        logo_url: textoCorto(logo.logo_url || logo.imagen, 700),
        imagen: textoCorto(logo.logo_url || logo.imagen, 700),
        orden: enteroPositivo(logo.orden) || 0,
      }))
      .filter(logo => logo.clave && logo.nombre && logo.logo_url)
    : null;
  return {
    configurado: true,
    tipo,
    seleccion: MODOS_SELECCION.includes(venta.seleccion) ? venta.seleccion : 'manual',
    categorias: listaDe(venta.categorias, 30, v => textoCorto(v, 100)),
    incluir_combos: venta.incluir_combos !== false,
    // Dónde entra el cliente: la tienda (catálogo) o directo en la ficha del
    // producto principal. `tipo` se sigue guardando por compatibilidad.
    abrir_en: venta.abrir_en === 'producto' ? 'producto' : 'tienda',
    combos_primero: venta.combos_primero === true,
    principal_id: tipo === 'producto_unico' ? enteroPositivo(venta.principal_id) : null,
    // Productos destacados del inicio: content_id públicos, elegidos en
    // Configurar venta. Si queda vacío, el runtime usa los primeros de la
    // selección para conservar compatibilidad con landings anteriores.
    destacados: listaDe(venta.destacados, 12, contentId),
    // Menú, banners, categorías visuales y vitrinas del Inicio — ver
    // limpiarInicio. Acepta `inicio_comercial` (nombre legado) si no vino
    // `inicio`, igual que inicioComercialDesdeVenta en el frontend.
    ...(() => {
      const inicioLimpio = limpiarInicio(venta.inicio || venta.inicio_comercial);
      return inicioLimpio ? { inicio: inicioLimpio, inicio_comercial: inicioLimpio } : {};
    })(),
    // Por paquete (oferta 'normal'): la etiqueta que muestra la ficha
    // ("Más elegido", "Mayor ahorro"…) y cuál se destaca (arranca elegido).
    paquetes: limpiarPaquetes(venta.paquetes),
    ...(venta.presentacion_productos && typeof venta.presentacion_productos === 'object' ? {
      presentacion_productos: Object.fromEntries(Object.entries(venta.presentacion_productos)
        .filter(([key, value]) => /^(producto|combo):[1-9]\d*$/.test(key) && value && typeof value === 'object')
        .slice(0, 500).map(([key, value]) => [key, {
          titulo_comercial: textoCorto(value.titulo_comercial, 100),
          mensaje_comercial: textoCorto(value.mensaje_comercial, 160),
          insignia_principal: textoCorto(value.insignia_principal, 40),
          insignia_secundaria: textoCorto(value.insignia_secundaria, 40),
          ...(Array.isArray(value.imagenes_landing) ? { imagenes_landing: [...new Set(value.imagenes_landing
            .filter(url => typeof url === 'string' && url.length <= 2048 && (/^https?:\/\/[^\s]+$/i.test(url) || /^\/(?!\/)[^\s]+$/.test(url)))
            .slice(0, 10))] } : {}),
        }])),
    } : {}),
    ...(venta.catalogo_filtros && typeof venta.catalogo_filtros === 'object' ? {
      catalogo_filtros: Object.fromEntries(['buscador', 'categoria', 'marca', 'etiqueta', 'precio', 'disponibilidad', 'orden']
        .filter(k => typeof venta.catalogo_filtros[k] === 'boolean')
        .map(k => [k, venta.catalogo_filtros[k]])),
    } : {}),
    cross_sell: {
      activo: cross.activo !== false,
      ofertas: listaDe(cross.ofertas, 200, enteroPositivo),
    },
    recomendados: {
      activo: reco.activo !== false,
      modo: MODOS_RECOMENDADOS.includes(reco.modo) ? reco.modo : 'auto',
      items: listaDe(reco.items, 50, contentId),
      max: Number.isInteger(max) && max >= 1 && max <= 8 ? max : 4,
      titulo: textoCorto(reco.titulo, 80),
    },
    urgencia: limpiarUrgencia(venta.urgencia),
    prueba_social: limpiarPruebaSocial(venta.prueba_social),
    // Logos de medios de pago en la ficha (Tarjetas / Bocas de cobranza /
    // Billetera electrónica): de la tienda entera, no por producto.
    // `undefined` = el comercio no lo tocó = se sigue mostrando.
    pago_logos: {
      tarjetas: venta.pago_logos?.tarjetas !== false,
      bocas: venta.pago_logos?.bocas !== false,
      billetera: venta.pago_logos?.billetera !== false,
    },
    ...(paymentLogos ? { payment_logos: paymentLogos } : {}),
    ...(briefComercial ? { brief_comercial: briefComercial } : {}),
  };
};

module.exports = LandingCodigoService;
module.exports.MAX_HTML = MAX_HTML;
module.exports.MAX_CSS = MAX_CSS;
module.exports.MAX_JS = MAX_JS;
module.exports.ESTADOS_CONFIRMACION = ESTADOS_CONFIRMACION;
