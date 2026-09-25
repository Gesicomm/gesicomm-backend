'use strict';

/**
 * Traduce el borrador que devuelve el microservicio RAG (PageSchema V2:
 * theme + sections[]) al único formato que "Landing simple" sabe publicar:
 * el lienzo en blanco (content.codigo = {html, css, js}, ver
 * landingSimple.service.js / landingCodigo.service.js).
 *
 * Antes, aiLanding.service.js guardaba el PageSchema tal cual en
 * pages/page_versions (arquitectura del Page Builder) y le mentía al
 * controller devolviendo un objeto con forma de Landing. Esa fila nunca
 * aparecía en /api/mis-landings-simples (que lee la tabla Landing) y el
 * botón "Ver página publicada" siempre mostraba la landing vacía. Acá se
 * arma el HTML/CSS reales para que la landing generada sea una landing de
 * verdad: se guarda, se publica y se ve pública como cualquier otra.
 *
 * El HTML usa el mismo contrato data-gesicomm-* que documenta
 * promptsCodigo.js (frontend), así el runtime (runtimeGesicomm.js) la
 * llena con catálogo real, carrito y checkout sin código propio.
 */

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const FONDOS = { background: 'var(--gc-fondo)', surface: 'var(--ia-surface)', primary: 'var(--gc-primario)', secondary: 'var(--ia-secundario)' };
const TEXTOS = { text: 'var(--gc-texto)', textMuted: 'var(--ia-texto-muted)', primary: 'var(--gc-primario)', background: 'var(--gc-fondo)' };
const ESPACIADOS = { sm: '32px', md: '56px', lg: '80px', xl: '112px' };

function estiloSeccion(style = {}) {
  const fondo = FONDOS[style?.background] || FONDOS.background;
  const texto = TEXTOS[style?.textColor] || TEXTOS.text;
  const padding = ESPACIADOS[style?.spacing] || ESPACIADOS.md;
  return `style="background:${fondo};color:${texto};padding:${padding} 24px;"`;
}

function seccionHero(s) {
  const c = s.content || {};
  return `
<section id="${esc(s.id || 'hero')}" class="ia-hero" ${estiloSeccion(s.style)}>
  <div class="ia-container ia-hero__inner">
    ${c.eyebrow ? `<p class="ia-eyebrow">${esc(c.eyebrow)}</p>` : ''}
    <h1>${esc(c.title || '')}</h1>
    ${c.description ? `<p class="ia-hero__desc">${esc(c.description)}</p>` : ''}
    <a class="ia-cta" href="#productos">${esc(c.cta_text || 'Ver productos')}</a>
  </div>
</section>`;
}

function tarjetaProducto() {
  return `
      <article class="ia-card">
        <div class="ia-card__img"><img data-gesicomm-bind="imagen" alt="" loading="lazy"></div>
        <div class="ia-card__body">
          <h3 data-gesicomm-bind="nombre"></h3>
          <p class="ia-card__precio" data-gesicomm-bind="precio"></p>
          <button class="ia-cta ia-cta--sm" data-gesicomm-comprar>Comprar</button>
        </div>
      </article>`;
}

function seccionProductGrid(s) {
  const c = s.content || {};
  return `
<section id="${esc(s.id || 'productos')}" class="ia-grid-section" ${estiloSeccion(s.style)}>
  <div class="ia-container">
    ${c.title ? `<h2>${esc(c.title)}</h2>` : ''}
    ${c.description ? `<p class="ia-section__desc">${esc(c.description)}</p>` : ''}
    <div class="ia-grid" data-gesicomm-lista="productos" data-gesicomm-si-vacio="mostrar">
      <template>${tarjetaProducto()}
      </template>
    </div>
  </div>
</section>`;
}

// El runtime de Gesicomm no tiene un bind "por id de producto" fuera de la
// ficha: data-gesicomm-lista siempre trabaja sobre listas. Se aproxima
// mostrando el primero de la selección (con data-gesicomm-limite="1").
function seccionProductShowcase(s) {
  const c = s.content || {};
  return `
<section id="${esc(s.id || 'destacado')}" class="ia-showcase" ${estiloSeccion(s.style)}>
  <div class="ia-container ia-showcase__inner" data-gesicomm-lista="productos" data-gesicomm-limite="1">
    <template>
      <div class="ia-showcase__img"><img data-gesicomm-bind="imagen" alt=""></div>
      <div class="ia-showcase__info">
        ${c.eyebrow ? `<p class="ia-eyebrow">${esc(c.eyebrow)}</p>` : ''}
        <h2 data-gesicomm-bind="nombre"></h2>
        <p data-gesicomm-bind="descripcion"></p>
        <p class="ia-card__precio" data-gesicomm-bind="precio"></p>
        <button class="ia-cta" data-gesicomm-comprar>${esc(c.cta_text || 'Comprar ahora')}</button>
      </div>
    </template>
  </div>
</section>`;
}

function seccionFaq(s) {
  const items = Array.isArray(s.content?.items) ? s.content.items : [];
  if (!items.length) return '';
  return `
<section id="${esc(s.id || 'faq')}" class="ia-faq" ${estiloSeccion(s.style)}>
  <div class="ia-container">
    <h2>${esc(s.content?.title || 'Preguntas frecuentes')}</h2>
    <div class="ia-faq__list">
      ${items.map((it) => `
      <details class="ia-faq__item">
        <summary>${esc(it.q || it.pregunta || '')}</summary>
        <p>${esc(it.a || it.respuesta || '')}</p>
      </details>`).join('')}
    </div>
  </div>
</section>`;
}

function seccionTestimonials(s) {
  const items = Array.isArray(s.content?.items) ? s.content.items : [];
  if (!items.length) return '';
  return `
<section id="${esc(s.id || 'testimonios')}" class="ia-testimonials" ${estiloSeccion(s.style)}>
  <div class="ia-container">
    <h2>${esc(s.content?.title || 'Lo que dicen nuestros clientes')}</h2>
    <div class="ia-testimonials__grid">
      ${items.map((it) => `
      <blockquote class="ia-testimonial">
        <p>"${esc(it.quote || it.texto || '')}"</p>
        <footer>${esc(it.name || it.nombre || '')}${it.rating ? ` · ${'★'.repeat(Math.max(1, Math.min(5, Number(it.rating) || 5)))}` : ''}</footer>
      </blockquote>`).join('')}
    </div>
  </div>
</section>`;
}

// CategoryGrid no tiene equivalente en Landing simple (no hay navegación
// por categoría fuera de /catalogo): se aproxima con la misma grilla de
// productos seleccionados en vez de dejar la sección vacía.
const RENDER_POR_TIPO = {
  Hero: seccionHero,
  ProductGrid: seccionProductGrid,
  ProductShowcase: seccionProductShowcase,
  CategoryGrid: seccionProductGrid,
  FAQ: seccionFaq,
  Testimonials: seccionTestimonials,
};

function construirHtml(draft) {
  const secciones = Array.isArray(draft?.sections) ? draft.sections : [];
  const cuerpo = secciones
    .map((s) => (RENDER_POR_TIPO[s?.type] || (() => ''))(s))
    .filter(Boolean)
    .join('\n');
  return cuerpo || '<section class="ia-hero"><div class="ia-container"><h1>Landing generada</h1></div></section>';
}

function construirCss(draft) {
  const palette = draft?.theme?.palette || {};
  const tipografia = draft?.theme?.typography || {};
  const radios = draft?.theme?.radius || {};
  return `
:root {
  --gc-primario: ${palette.primary || '#2563eb'};
  --gc-texto-sobre-primario: #ffffff;
  --gc-fondo: ${palette.background || '#ffffff'};
  --gc-texto: ${palette.text || '#0f172a'};
  --ia-surface: ${palette.surface || '#f8fafc'};
  --ia-secundario: ${palette.secondary || palette.primary || '#2563eb'};
  --ia-texto-muted: ${palette.textMuted || '#64748b'};
  --ia-radio-card: ${radios.card || '16px'};
  --ia-radio-btn: ${radios.button || '999px'};
}
* { box-sizing: border-box; }
body { margin: 0; font-family: ${tipografia.body ? `'${String(tipografia.body).replace(/['"<>]/g, '')}', ` : ''}system-ui, sans-serif; background: var(--gc-fondo); color: var(--gc-texto); }
h1, h2, h3 { font-family: ${tipografia.heading ? `'${String(tipografia.heading).replace(/['"<>]/g, '')}', ` : ''}system-ui, sans-serif; margin: 0 0 16px; }
.ia-container { max-width: 1100px; margin: 0 auto; }
.ia-eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 13px; font-weight: 700; color: var(--gc-primario); margin: 0 0 8px; }
.ia-hero__inner { text-align: center; display: grid; gap: 16px; justify-items: center; padding: 24px 0; }
.ia-hero h1 { font-size: clamp(32px, 6vw, 56px); }
.ia-hero__desc { max-width: 60ch; opacity: .8; font-size: 18px; }
.ia-cta { display: inline-flex; align-items: center; justify-content: center; padding: 14px 28px; border-radius: var(--ia-radio-btn); background: var(--gc-primario); color: var(--gc-texto-sobre-primario); font-weight: 700; text-decoration: none; border: none; cursor: pointer; }
.ia-cta--sm { padding: 10px 18px; font-size: 14px; width: 100%; }
.ia-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 24px; margin-top: 24px; }
.ia-card { background: var(--ia-surface); border-radius: var(--ia-radio-card); overflow: hidden; display: flex; flex-direction: column; }
.ia-card__img img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.ia-card__body { padding: 16px; display: grid; gap: 8px; }
.ia-card__precio { font-weight: 700; color: var(--gc-primario); }
.ia-showcase__inner { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: center; }
.ia-showcase__img img { width: 100%; border-radius: var(--ia-radio-card); }
.ia-showcase__info { display: grid; gap: 12px; }
.ia-faq__item { border-bottom: 1px solid rgba(0,0,0,.08); padding: 16px 0; }
.ia-faq__item summary { cursor: pointer; font-weight: 600; }
.ia-testimonials__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px; margin-top: 24px; }
.ia-testimonial { background: var(--ia-surface); border-radius: var(--ia-radio-card); padding: 24px; margin: 0; }
.ia-testimonial footer { margin-top: 12px; opacity: .7; font-size: 14px; }
@media (max-width: 720px) { .ia-showcase__inner { grid-template-columns: 1fr; } }

/* Animaciones de entrada + interacción: el PageSchema del borrador no
   tiene ningún campo de "animación" (solo texto y colores), así que un
   prompt como "más animaciones" no tiene dónde aterrizar en el draft. Esto
   da una base pareja de movimiento en TODAS las landings generadas — no
   reacciona al prompt, pero ya no se ven estáticas. */
@keyframes ia-fade-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
.ia-hero, .ia-grid-section, .ia-showcase, .ia-faq, .ia-testimonials { animation: ia-fade-up .7s cubic-bezier(.16,1,.3,1) both; }
.ia-grid .ia-card, .ia-testimonials__grid .ia-testimonial { animation: ia-fade-up .6s cubic-bezier(.16,1,.3,1) both; }
.ia-grid .ia-card:nth-child(2), .ia-testimonials__grid .ia-testimonial:nth-child(2) { animation-delay: .08s; }
.ia-grid .ia-card:nth-child(3), .ia-testimonials__grid .ia-testimonial:nth-child(3) { animation-delay: .16s; }
.ia-grid .ia-card:nth-child(4), .ia-testimonials__grid .ia-testimonial:nth-child(4) { animation-delay: .24s; }
.ia-grid .ia-card:nth-child(n+5), .ia-testimonials__grid .ia-testimonial:nth-child(n+5) { animation-delay: .3s; }
.ia-card, .ia-testimonial, .ia-showcase__img img { transition: transform .3s cubic-bezier(.16,1,.3,1), box-shadow .3s ease; }
.ia-card:hover, .ia-testimonial:hover { transform: translateY(-6px); box-shadow: 0 16px 32px rgba(0,0,0,.14); }
.ia-showcase__img img:hover { transform: scale(1.02); }
.ia-cta { transition: transform .2s ease, box-shadow .2s ease, filter .2s ease; }
.ia-cta:hover { transform: translateY(-2px) scale(1.02); box-shadow: 0 12px 26px rgba(0,0,0,.2); filter: brightness(1.05); }
.ia-cta:active { transform: translateY(0) scale(.98); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`.trim();
}

function construirCodigoDesdeSchema(draft) {
  return {
    html: construirHtml(draft),
    css: construirCss(draft),
    js: '',
  };
}

module.exports = { construirCodigoDesdeSchema };
