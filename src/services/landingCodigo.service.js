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
};

// Construcciones prohibidas en el CSS. url() con http(s)/data: se permite
// (fuentes e imágenes son parte de armar una landing).
const CSS_PROHIBIDO = [
  { re: /@import\b/i, motivo: '@import (traé la fuente con un <link> en el HTML o pegá el @font-face)' },
  { re: /expression\s*\(/i, motivo: 'expression()' },
  { re: /-moz-binding/i, motivo: '-moz-binding' },
  { re: /behavior\s*:/i, motivo: 'behavior:' },
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

class LandingCodigoService {

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
    if (/\son[a-z]+\s*=/i.test(original)) {
      advertencias.push('Se quitaron atributos de evento (onclick, onload, ...): enganchá los eventos desde la pestaña JS con addEventListener.');
    }
    return { html: limpio, advertencias };
  }

  /** @returns {string[]} motivos por los que el JS no se puede guardar (vacío = OK) */
  static revisarJs(js) {
    const texto = String(js || '');
    return JS_PROHIBIDO
      .filter(({ re }) => re.test(texto))
      .map(({ motivo }) => `El JavaScript no puede usar ${motivo}.`);
  }

  /**
   * Punto de entrada único. Lanza si el código no se puede guardar (mismo
   * contrato de error que el resto de landingSimple: err.errores).
   *
   * @param {{html?: string, css?: string, js?: string}} codigo
   * @returns {{html: string, css: string, js: string, advertencias: string[]}}
   */
  static sanitizar(codigo) {
    if (codigo === null || typeof codigo !== 'object' || Array.isArray(codigo)) {
      const err = new Error('Validación fallida.');
      err.errores = ['El código de la landing debe ser un objeto {html, css, js}.'];
      throw err;
    }

    const errores = [];
    const html = String(codigo.html ?? '');
    const css = String(codigo.css ?? '');
    const js = String(codigo.js ?? '');

    if (Buffer.byteLength(html, 'utf8') > MAX_HTML) errores.push(`El HTML supera el máximo de ${MAX_HTML / 1024} KB.`);
    if (Buffer.byteLength(css, 'utf8') > MAX_CSS) errores.push(`El CSS supera el máximo de ${MAX_CSS / 1024} KB.`);
    if (Buffer.byteLength(js, 'utf8') > MAX_JS) errores.push(`El JavaScript supera el máximo de ${MAX_JS / 1024} KB.`);

    errores.push(...this.revisarJs(js));

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
      advertencias: [...htmlLimpio.advertencias, ...cssLimpio.advertencias],
    };
  }
}

module.exports = LandingCodigoService;
module.exports.MAX_HTML = MAX_HTML;
module.exports.MAX_CSS = MAX_CSS;
module.exports.MAX_JS = MAX_JS;
