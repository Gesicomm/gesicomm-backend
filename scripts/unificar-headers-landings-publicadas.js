'use strict';

/**
 * Backfill puntual para landings de codigo ya publicadas.
 *
 * Las landings guardan snapshots de HTML/CSS en landings.content. Cambiar la
 * plantilla base no alcanza para registros que ya existen, asi que este script
 * normaliza los headers viejos y agrega el CSS compartido de ancho completo.
 *
 * Uso:
 *   node scripts/unificar-headers-landings-publicadas.js          # dry run
 *   node scripts/unificar-headers-landings-publicadas.js --apply  # escribe DB
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize, Landing, Tienda } = require('../src/models');

const MARCADOR_HEADER = 'gesicomm-header-unificado';
const MARCADOR_ANCHO = 'gesicomm-ancho-completo';
const MARCADOR_CHECKOUT = 'gesicomm-checkout-centrado';
const MARCADOR_GALERIA = 'gesicomm-gallery-lateral';
const MARCADOR_GALERIA_FIT = 'gesicomm-gallery-image-fit';
const MARCADOR_GALERIA_JS = 'gesicomm-gallery-hover';

const LINKS_HEADER = [
  { key: 'inicio', label: 'Inicio', href: '/', attrs: 'data-gesicomm-inicio' },
  { key: 'productos', label: 'Productos', href: '/catalogo', attrs: 'data-gesicomm-link="catalogo"' },
  { key: 'descuentos', label: 'Descuentos', href: '/catalogo?etiqueta=Oferta', attrs: 'data-gesicomm-link="catalogo"' },
  { key: 'nosotros', label: 'Nosotros', href: '/#marca', attrs: '' },
  { key: 'contacto', label: 'Contacto', href: '/contacto', attrs: 'data-gesicomm-link="contacto"' },
];

function leerCssCompartido() {
  const archivoPlantillas = path.resolve(__dirname, '../../gesicomm-frontend/src/pages/landing-simple/plantillasBaseCodigo.js');
  const fuente = fs.readFileSync(archivoPlantillas, 'utf8');

  function extraerConstante(nombre) {
    const re = new RegExp(`const ${nombre} = \`([\\s\\S]*?)\`;`);
    const match = fuente.match(re);
    if (!match) throw new Error(`No se pudo extraer ${nombre} desde plantillasBaseCodigo.js`);
    return match[1];
  }

  const header = extraerConstante('HEADER_UNIFICADO_CSS');
  const ancho = extraerConstante('ANCHO_COMPLETO_CSS');
  const checkout = extraerConstante('CHECKOUT_CENTRADO_CSS');
  const galeriaFit = extraerConstante('GALERIA_IMAGEN_FIT_CSS');
  return {
    header,
    ancho,
    checkout,
    galeriaFit,
    compartido: `${header}\n${ancho}\n${checkout}\n${galeriaFit}`,
  };
}

const CSS_BASE = leerCssCompartido();

const CSS_GALERIA_LATERAL = `
/* gesicomm-gallery-lateral: ficha de producto con miniaturas al costado de la imagen principal. */
[data-gesicomm-base="producto"] .gallery {
  display: grid !important;
  grid-template-columns: 84px minmax(0, 1fr) !important;
  gap: 14px !important;
  align-items: start !important;
}
[data-gesicomm-base="producto"] .gallery-main { grid-column: 2 !important; grid-row: 1 !important; }
[data-gesicomm-base="producto"] .thumbs {
  grid-column: 1 !important;
  grid-row: 1 !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 10px !important;
  max-height: min(620px, calc(100vh - 128px)) !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  padding: 2px 4px 2px 0 !important;
  scrollbar-width: thin !important;
}
[data-gesicomm-base="producto"] .thumb {
  flex: 0 0 76px !important;
  width: 76px !important;
  height: 76px !important;
  border-color: transparent !important;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease !important;
}
[data-gesicomm-base="producto"] .thumb:hover,
[data-gesicomm-base="producto"] .thumb.is-selected {
  border-color: var(--gc-primario, var(--brand, #075da0)) !important;
  box-shadow: 0 8px 20px rgba(15, 23, 42, .10) !important;
}
@media (max-width: 960px) {
  [data-gesicomm-base="producto"] .gallery { grid-template-columns: 72px minmax(0, 1fr) !important; gap: 12px !important; }
  [data-gesicomm-base="producto"] .thumbs { max-height: min(420px, 72vw) !important; }
  [data-gesicomm-base="producto"] .thumb { flex-basis: 64px !important; width: 64px !important; height: 64px !important; }
}
@media (max-width: 720px) {
  [data-gesicomm-base="producto"] .gallery { grid-template-columns: 1fr !important; }
  [data-gesicomm-base="producto"] .gallery-main { grid-column: 1 !important; grid-row: 1 !important; }
  [data-gesicomm-base="producto"] .thumbs {
    grid-column: 1 !important;
    grid-row: 2 !important;
    flex-direction: row !important;
    max-height: none !important;
    overflow-x: auto !important;
    overflow-y: hidden !important;
    padding: 2px 0 4px !important;
  }
}
`;

const JS_GALERIA_HOVER = `
// gesicomm-gallery-hover: seleccion de miniaturas al posar el mouse.
(function () {
  if (window.__gesicommGalleryHover) return;
  window.__gesicommGalleryHover = true;
  function seleccionar(el) {
    if (!el) return;
    var principal = document.querySelector('[data-gesicomm-imagen-principal]');
    var img = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (!principal || !img || !img.src) return;
    principal.src = img.src;
    principal.removeAttribute('srcset');
    if (img.alt) principal.alt = img.alt;
    var lista = el.closest('[data-gesicomm-lista="imagenes"]') || document;
    var thumbs = lista.querySelectorAll('[data-gesicomm-imagen-idx]');
    for (var i = 0; i < thumbs.length; i++) {
      var activa = thumbs[i] === el;
      thumbs[i].classList.toggle('is-selected', activa);
      if (activa) thumbs[i].setAttribute('aria-current', 'true');
      else thumbs[i].removeAttribute('aria-current');
    }
  }
  document.addEventListener('pointerover', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-gesicomm-imagen-idx]') : null;
    if (target) seleccionar(target);
  });
  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-gesicomm-imagen-idx]') : null;
    if (!target) return;
    event.preventDefault();
    seleccionar(target);
  });
  function marcarPrimera() {
    var listas = document.querySelectorAll('[data-gesicomm-lista="imagenes"]');
    for (var i = 0; i < listas.length; i++) {
      var activa = listas[i].querySelector('[data-gesicomm-imagen-idx].is-selected, [data-gesicomm-imagen-idx][aria-current="true"]');
      if (!activa) seleccionar(listas[i].querySelector('[data-gesicomm-imagen-idx]'));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', marcarPrimera);
  else marcarPrimera();
})();
`;

function headerUnico(activo = '') {
  const links = LINKS_HEADER.map(({ key, label, href, attrs }) => {
    const clase = key === activo ? ' class="active"' : '';
    const extra = attrs ? ` ${attrs}` : '';
    return `<a${clase} href="${href}"${extra}>${label}</a>`;
  }).join('\n        ');

  return `<header class="commerce-header" data-gesicomm-bloque="encabezado">
  <div class="container header-main">
    <div class="brand-column">
      <a class="brand brand-mark" href="#" data-gesicomm-inicio aria-label="Volver al inicio">
        <img class="brand-logo" data-gesicomm-tienda="logo" alt="">
        <span data-gesicomm-tienda="nombre">Tu tienda</span>
      </a>
    </div>

    <nav class="header-nav" aria-label="Navegacion comercial">
      <div id="nav-links" class="nav-links">
        ${links}
      </div>
    </nav>

    <div class="header-actions">
      <div class="search-wrap">
        <button class="search-toggle" type="button" data-gesicomm-search-toggle aria-expanded="false" aria-controls="gesicomm-search-panel" aria-label="Buscar">⌕</button>
        <form id="gesicomm-search-panel" class="search-box" role="search" hidden>
          <input type="search" placeholder="Busca productos, marcas y mas..." aria-label="Buscar productos" data-gesicomm-buscar>
          <button type="submit" aria-label="Buscar">⌕</button>
        </form>
        <div class="search-results" data-gesicomm-search-results hidden></div>
      </div>
      <button class="cart-button" type="button" data-gesicomm-carrito aria-label="Abrir carrito">
        <span aria-hidden="true">🛒</span>
        <strong>Carrito</strong>
      </button>
      <button class="menu-toggle" type="button" aria-label="Abrir menu" aria-expanded="false" aria-controls="nav-links">☰</button>
    </div>
  </div>
</header>`;
}

const RE_HEADER_COMMERCE = /<header\b(?=[^>]*class=(["'])[^"']*\bcommerce-header\b[^"']*\1)[\s\S]*?<\/header>/i;

function activoParaVista(vista) {
  if (vista === 'inicio' || vista === 'codigo') return 'inicio';
  if (['catalogo', 'categoria', 'producto', 'productos', 'checkout'].includes(vista)) return 'productos';
  return '';
}

function normalizarCss(css) {
  const texto = String(css || '');
  var siguiente = texto;
  var changed = false;

  if (!siguiente.includes(MARCADOR_HEADER)) {
    siguiente = `${siguiente.trimEnd()}\n\n${CSS_BASE.header}`.trimStart();
    changed = true;
  }
  if (!siguiente.includes(MARCADOR_ANCHO)) {
    siguiente = `${siguiente.trimEnd()}\n\n${CSS_BASE.ancho}`.trimStart();
    changed = true;
  }
  if (!siguiente.includes(MARCADOR_CHECKOUT)) {
    siguiente = `${siguiente.trimEnd()}\n\n${CSS_BASE.checkout}`.trimStart();
    changed = true;
  }
  if (!siguiente.includes(MARCADOR_GALERIA)) {
    siguiente = `${siguiente.trimEnd()}\n\n${CSS_GALERIA_LATERAL}`.trimStart();
    changed = true;
  }
  if (!siguiente.includes(MARCADOR_GALERIA_FIT)) {
    siguiente = `${siguiente.trimEnd()}\n\n${CSS_BASE.galeriaFit}`.trimStart();
    changed = true;
  }

  return { css: siguiente, changed };
}

function normalizarJs(js) {
  const texto = String(js || '');
  if (texto.includes(MARCADOR_GALERIA_JS)) {
    return { js: texto, changed: false };
  }
  return {
    js: `${texto.trimEnd()}\n\n${JS_GALERIA_HOVER}`.trimStart(),
    changed: true,
  };
}

function normalizarCodigo(codigo, vista, cambios, ruta) {
  if (!codigo || typeof codigo !== 'object') return codigo;

  const salida = { ...codigo };
  let changed = false;
  const html = String(salida.html || '');
  if (RE_HEADER_COMMERCE.test(html)) {
    const nuevoHtml = html.replace(RE_HEADER_COMMERCE, headerUnico(activoParaVista(vista)));
    if (nuevoHtml !== html) {
      salida.html = nuevoHtml;
      changed = true;
    }
  }

  const cssResultado = normalizarCss(salida.css);
  if (cssResultado.changed) {
    salida.css = cssResultado.css;
    changed = true;
  }
  const jsResultado = normalizarJs(salida.js);
  if (jsResultado.changed) {
    salida.js = jsResultado.js;
    changed = true;
  }

  if (changed) cambios.push(ruta);
  return changed ? salida : codigo;
}

function normalizarContent(content) {
  if (!content || typeof content !== 'object') return { content, cambios: [] };

  const salida = JSON.parse(JSON.stringify(content));
  const cambios = [];

  salida.codigo = normalizarCodigo(salida.codigo, 'codigo', cambios, 'content.codigo');

  if (salida.vistas && typeof salida.vistas === 'object') {
    for (const vista of ['inicio', 'catalogo', 'categoria', 'producto', 'checkout']) {
      if (salida.vistas[vista]) {
        salida.vistas[vista] = normalizarCodigo(salida.vistas[vista], vista, cambios, `content.vistas.${vista}`);
      }
    }

    if (salida.vistas.productos && typeof salida.vistas.productos === 'object') {
      for (const [contentId, codigo] of Object.entries(salida.vistas.productos)) {
        salida.vistas.productos[contentId] = normalizarCodigo(
          codigo,
          'producto',
          cambios,
          `content.vistas.productos.${contentId}`,
        );
      }
    }

    if (salida.vistas.legales && typeof salida.vistas.legales === 'object') {
      for (const [pagina, codigo] of Object.entries(salida.vistas.legales)) {
        salida.vistas.legales[pagina] = normalizarCodigo(
          codigo,
          'legal',
          cambios,
          `content.vistas.legales.${pagina}`,
        );
      }
    }
  }

  return { content: cambios.length ? salida : content, cambios };
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    apply: args.has('--apply'),
    includeInactive: args.has('--include-inactive'),
  };
}

async function main() {
  const opciones = parseArgs();
  const where = {
    content: { [Op.ne]: null },
  };
  if (!opciones.includeInactive) where.activo = true;

  const landings = await Landing.findAll({
    where,
    include: [{ model: Tienda, attributes: ['id', 'nombre', 'subdominio', 'dominio_propio'] }],
    order: [['id', 'ASC']],
  });

  const tocadas = [];
  for (const landing of landings) {
    const anterior = landing.content || {};
    const { content, cambios } = normalizarContent(anterior);
    if (!cambios.length) continue;

    tocadas.push({
      id: landing.id,
      tienda_id: landing.tienda_id,
      tienda: landing.Tienda?.nombre || null,
      subdominio: landing.Tienda?.subdominio || null,
      dominio_propio: landing.Tienda?.dominio_propio || null,
      slug: landing.slug,
      cambios,
      content_anterior: anterior,
    });

    if (opciones.apply) {
      landing.content = content;
      await landing.save({ fields: ['content'] });
    }
  }

  if (opciones.apply && tocadas.length) {
    const carpeta = path.resolve(__dirname, 'data/backups');
    fs.mkdirSync(carpeta, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivo = path.join(carpeta, `landings-header-unificado-${stamp}.json`);
    fs.writeFileSync(archivo, JSON.stringify(tocadas, null, 2));
    console.log(`Backup escrito: ${archivo}`);
  }

  console.log(`${opciones.apply ? 'Actualizadas' : 'Detectadas'} ${tocadas.length} landing(s).`);
  for (const item of tocadas) {
    const host = item.dominio_propio || (item.subdominio ? `${item.subdominio}.gesicomm.com` : `tienda:${item.tienda_id}`);
    console.log(`- landing ${item.id} (${host}/${item.slug || ''}): ${item.cambios.join(', ')}`);
  }
}

main()
  .then(() => sequelize.close())
  .catch(async err => {
    console.error('Error unificando headers:', err);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
