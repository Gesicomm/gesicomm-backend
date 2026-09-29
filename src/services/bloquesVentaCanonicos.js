'use strict';

/**
 * Bloques de venta CANÓNICOS (order bump y paquetes).
 *
 * No los escribe la IA: son los mismos que usa el lienzo en blanco, ya
 * probados vendiendo — con la foto del producto, el precio anterior tachado,
 * el ahorro y los estados de marcado. El modelo los reinventaba en cada
 * generación y salían peores: el bump quedaba como un renglón de texto sin
 * imagen y el paquete sin foto ni x2.
 *
 * El reparto: la IA decide DÓNDE va el bloque y cómo se ve el resto de la
 * página; Gesicomm decide QUÉ hay adentro del bloque. Por eso acá solo se
 * reemplaza el <template> de cada lista, respetando el contenedor que puso
 * el modelo (sus clases, su lugar en la página y su título).
 *
 * Generado desde gesicomm-frontend/src/pages/landing-simple/plantillasBaseCodigo.js
 * — si esa plantilla cambia, volver a extraerlo de ahí y no editar a mano.
 */

const TEMPLATE_BUMP = "<template>\r\n          <!-- Toda la tarjeta es la casilla (label): se marca tocando en\r\n               cualquier parte. El estado marcado cambia encabezado y control. -->\r\n          <label class=\"bump\">\r\n            <input class=\"bump-check\" type=\"checkbox\" data-gesicomm-bump>\r\n            <span class=\"bump-flag\">\r\n              <span class=\"bump-flag-off\">Oferta exclusiva · <span data-gesicomm-bind=\"ahorro\"></span></span>\r\n              <span class=\"bump-flag-on\">✓ Oferta agregada a tu pedido</span>\r\n            </span>\r\n            <span class=\"bump-body\">\r\n              <span class=\"bump-control\" aria-hidden=\"true\"></span>\r\n              <img class=\"bump-img\" data-gesicomm-bind=\"imagen\" alt=\"\">\r\n              <span class=\"bump-copy\">\r\n                <span class=\"bump-sub\">Sumalo a tu pedido por solo <b data-gesicomm-bind=\"precio\"></b></span>\r\n                <span class=\"bump-title\" data-gesicomm-bind=\"nombre\"></span>\r\n                <span class=\"bump-nota\">Ya está sumada al total del botón de compra.</span><span class=\"bump-prices\">\r\n                  <b data-gesicomm-bind=\"precio\"></b>\r\n                  <s data-gesicomm-bind=\"precio_antes\"></s>\r\n                </span>\r\n              </span>\r\n              <span class=\"bump-action\">\r\n                <span class=\"bump-action-off\">Agregar a mi pedido</span>\r\n                <span class=\"bump-action-on\">Quitar de mi pedido</span>\r\n              </span>\r\n            </span>\r\n          </label>\r\n        </template>";

const TEMPLATE_PAQUETES = "<template>\r\n            <button class=\"paquete\" type=\"button\">\r\n              <!-- Etiqueta editable en Configurar venta (\"Más elegido\", \"Mayor ahorro\"…). -->\r\n              <span class=\"paquete-etiqueta\" data-gesicomm-bind=\"etiqueta\"></span>\r\n              <span class=\"paquete-radio\" aria-hidden=\"true\"></span>\r\n              <span class=\"paquete-foto\" aria-hidden=\"true\">\r\n                <img data-gesicomm-bind=\"imagen\" alt=\"\">\r\n                <span class=\"paquete-x\" data-gesicomm-bind=\"unidades_texto\"></span>\r\n              </span>\r\n              <span class=\"paquete-info\">\r\n                <span class=\"paquete-titulo\" data-gesicomm-bind=\"titulo\"></span>\r\n                <span class=\"paquete-precio\" data-gesicomm-bind=\"precio\"></span>\r\n                <span class=\"paquete-unidad\" data-gesicomm-bind=\"por_unidad\"></span>\r\n                <span class=\"paquete-ahorro\"><span data-gesicomm-bind=\"ahorro\"></span><em data-gesicomm-bind=\"ahorro_pct\"></em></span>\r\n                <s class=\"paquete-antes\" data-gesicomm-bind=\"precio_antes\"></s>\r\n              </span>\r\n            </button>\r\n          </template>";

const CSS_BLOQUES = ":root{--brand: var(--gc-primario, #16a36a); --brand-soft: color-mix(in srgb, var(--gc-primario, #16a36a) 14%, transparent); --white: var(--gc-superficie, #fff); --line: color-mix(in srgb, var(--gc-texto, #10202f) 12%, transparent);}\n.bumps {display: grid; gap: 12px; margin-bottom: 12px;}\n.bump {display: block; overflow: hidden; position: relative; cursor: pointer; background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 12%, transparent), transparent 62%), var(--white); border: 1.5px solid color-mix(in srgb, var(--brand) 38%, var(--line)); border-radius: 14px; box-shadow: 0 14px 28px rgba(15, 23, 42, .08); transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease, background .18s ease;}\n.bump:hover {border-color: var(--brand); transform: translateY(-1px); box-shadow: 0 18px 34px rgba(15, 23, 42, .12);}\n.bump:has(.bump-check:focus-visible) {outline: 3px solid var(--brand-soft); outline-offset: 2px;}\n.bump.is-checked, .bump:has(.bump-check:checked) {border-color: var(--brand); background: linear-gradient(135deg, var(--brand-soft), var(--white));}\n.bump-check {position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none;}\n.bump-flag {display: flex; align-items: center; gap: 7px; padding: 8px 14px; color: var(--brand); background: color-mix(in srgb, var(--brand) 14%, var(--white)); font-size: .72rem; font-weight: 900; letter-spacing: .05em; line-height: 1.2; text-transform: uppercase;}\n.bump-flag-on {display: none;}\n.bump.is-checked .bump-flag, .bump:has(.bump-check:checked) .bump-flag {color: var(--gc-texto-sobre-primario); background: var(--brand);}\n.bump.is-checked .bump-flag-off, .bump:has(.bump-check:checked) .bump-flag-off {display: none;}\n.bump.is-checked .bump-flag-on, .bump:has(.bump-check:checked) .bump-flag-on {display: inline;}\n.bump-body {display: grid; grid-template-columns: 28px 68px minmax(0, 1fr); gap: 12px; align-items: center; padding: 14px;}\n.bump-control {display: grid; place-items: center; width: 28px; height: 28px; border: 2px solid color-mix(in srgb, var(--brand) 64%, var(--line)); border-radius: 999px; color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, var(--white)); font-size: 0; font-weight: 950; line-height: 1;}\n.bump-control::before {content: \"+\"; font-size: 1.05rem;}\n.bump.is-checked .bump-control, .bump:has(.bump-check:checked) .bump-control {border-color: var(--brand); background: var(--brand); color: var(--white);}\n.bump.is-checked .bump-control::before, .bump:has(.bump-check:checked) .bump-control::before {content: \"✓\"; font-size: .85rem;}\n.bump-img {width: 68px; aspect-ratio: 1 / 1; object-fit: contain; background: var(--white); border: 1px solid rgba(15, 23, 42, .08); border-radius: 10px;}\n.bump-copy {display: grid; gap: 4px; min-width: 0;}\n.bump-sub {color: var(--brand); font-size: .76rem; font-weight: 900;}\n.bump-title {color: var(--ink); font-weight: 850; line-height: 1.22;}\n.bump-prices {display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline;}\n.bump-prices b {color: var(--ink); font-size: 1.05rem; font-weight: 950;}\n.bump-prices s {color: var(--ink-soft); font-size: .85rem;}\n.bump-prices em, .offer-save {color: #b42318; font-size: .82rem; font-style: normal; font-weight: 800;}\n.bump-action {grid-column: 1 / -1; padding: 10px 14px; color: var(--gc-texto-sobre-primario); background: var(--brand); border-radius: 999px; font-size: .8rem; font-weight: 900; text-align: center; white-space: nowrap;}\n.bump.is-checked .bump-action, .bump:has(.bump-check:checked) .bump-action {color: var(--brand); background: transparent; border: 1px solid color-mix(in srgb, var(--brand) 38%, transparent);}\n.bump-action-on {display: none;}\n.bump.is-checked .bump-action-off, .bump:has(.bump-check:checked) .bump-action-off {display: none;}\n.bump.is-checked .bump-action-on, .bump:has(.bump-check:checked) .bump-action-on {display: inline;}\n.bump-incluye {display: none; margin: -2px 2px 14px; color: var(--ink-soft); font-size: .85rem;}\n.bumps:has(.bump-check:checked) + .bump-incluye {display: block;}\n.paquetes {margin: 26px 0 20px;}\n.paquetes-cabeza {margin-bottom: 16px;}\n.paquetes-titulo {margin: 0; font-size: 1.15rem; letter-spacing: -.02em;}\n.paquetes-sub {margin: 4px 0 0; color: var(--ink-soft); font-size: .92rem;}\n.paquetes-lista {display: grid; gap: 14px;}\n.paquete {position: relative; display: grid; grid-template-columns: 22px 64px minmax(0, 1fr); gap: 14px; align-items: center; width: 100%; padding: 16px 18px; text-align: left; color: var(--ink); background: var(--white); border: 1.5px solid var(--line); border-radius: 16px; cursor: pointer; transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;}\n.paquete:hover {border-color: color-mix(in srgb, var(--brand) 55%, var(--line));}\n.paquete:focus-visible {outline: 3px solid color-mix(in srgb, var(--brand) 45%, transparent); outline-offset: 2px;}\n.paquete.is-selected {border: 2px solid var(--brand); background: color-mix(in srgb, var(--brand) 18%, var(--white)); box-shadow: 0 12px 30px color-mix(in srgb, var(--brand) 22%, transparent);}\n.paquete-radio {width: 22px; height: 22px; border: 2px solid color-mix(in srgb, var(--ink) 35%, transparent); border-radius: 50%;}\n.paquete.is-selected .paquete-radio {border-color: var(--brand); background: radial-gradient(circle, var(--gc-texto-sobre-primario) 0 28%, var(--brand) 32%);}\n.paquete-foto {position: relative; display: grid; place-items: center; width: 64px; height: 64px; background: #f3f2ee; border-radius: 12px;}\n.paquete-foto img {width: 100%; height: 100%; object-fit: contain; mix-blend-mode: multiply; border-radius: 12px;}\n.paquete-x {position: absolute; right: -6px; bottom: -6px; min-width: 26px; padding: 2px 6px; text-align: center; color: var(--gc-texto-sobre-primario); background: var(--brand); border-radius: 999px; font-size: .72rem; font-weight: 900;}\n.paquete-info {display: grid; gap: 3px; min-width: 0;}\n.paquete-titulo {font-size: 1.02rem; font-weight: 850;}\n.paquete-precio {font-size: 1.35rem; font-weight: 900; letter-spacing: -.02em; line-height: 1.1;}\n.paquete-unidad {color: var(--ink); font-size: .9rem; font-weight: 700;}\n.paquete-ahorro {display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--brand-dark); font-size: .9rem; font-weight: 850;}\n.paquete-ahorro:empty {display: none;}\n.paquete-ahorro em {padding: 2px 8px; color: var(--tienda-texto-sobre-secundario, #10202f); background: var(--accent); border-radius: 999px; font-size: .72rem; font-style: normal; font-weight: 900;}\n.paquete-antes {margin-top: 4px; color: var(--ink-soft); font-size: .78rem; opacity: .8;}\n.paquete-etiqueta {position: absolute; top: -11px; right: 16px; padding: 3px 10px; color: var(--brand-dark); background: var(--white); border: 1.5px solid var(--brand); border-radius: 999px; font-size: .7rem; font-weight: 900; letter-spacing: .02em;}\n.paquete.is-destacado .paquete-etiqueta, .paquete.is-selected .paquete-etiqueta {color: var(--gc-texto-sobre-primario); background: var(--brand);}\n.paquete {grid-template-columns: 22px 52px minmax(0, 1fr); padding: 16px 14px; gap: 12px;}\n.paquete-foto {width: 52px; height: 52px;}";

// El bloque original se diseñó sobre una tarjeta CLARA (el lienzo en blanco
// arranca en fondo claro). En una landing oscura hereda una superficie
// oscura y los textos pintados con el color de marca quedan casi invisibles
// —la línea "Sumalo a tu pedido por solo…" desaparecía—. Va al final para
// ganarle a las reglas de arriba sin necesidad de !important.
const CSS_ADAPTACION = `
/* Variables que el CSS del lienzo da por sentadas y en una landing de IA no
   existen: sin esto --ink/--accent quedan vacíos y los textos y la píldora
   del descuento se pierden. */
:root {
  --ink: var(--gc-texto, #10202f);
  --ink-soft: color-mix(in srgb, var(--gc-texto, #10202f) 65%, transparent);
  --brand-dark: var(--gc-primario, #16a36a);
  --accent: var(--gc-secundario, #ffb547);
}
.bump-sub, .paquete-unidad { color: inherit; opacity: .75; }
.bump-title, .paquete-titulo { color: inherit; }
.bump-prices b, .paquete-precio { color: inherit; }
.bump-prices s, .paquete-antes { color: inherit; opacity: .55; }
.bump-nota { display: none; font-size: .78rem; font-weight: 600; opacity: .8; }
.bump.is-checked .bump-nota, .bump:has(.bump-check:checked) .bump-nota { display: block; }
/* Estado marcado estable: no achica la tarjeta ni la lava con fondos grises. */
.bumps[data-gesicomm-lista="ofertas_bump"] {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  background: transparent;
}
:where(section, article, aside, div):has(> .bumps[data-gesicomm-lista="ofertas_bump"]) {
  width: 100%;
  max-width: 100%;
}
.bump {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.bump.is-checked, .bump:has(.bump-check:checked) {
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 12%, transparent), transparent 62%), var(--white);
  box-shadow: 0 14px 28px rgba(15, 23, 42, .08);
}
@media (min-width: 760px) {
  .bump.is-checked, .bump:has(.bump-check:checked) {
    min-width: min(720px, calc(100vw - 32px));
  }
}
.bump.is-checked .bump-action, .bump:has(.bump-check:checked) .bump-action {
  color: var(--gc-texto-sobre-primario);
  background: color-mix(in srgb, var(--brand) 78%, #0f172a);
  border: 1px solid color-mix(in srgb, var(--brand) 72%, transparent);
}
.bump.is-checked .bump-action-on, .bump:has(.bump-check:checked) .bump-action-on {
  font-size: 0;
}
.bump.is-checked .bump-action-on::after, .bump:has(.bump-check:checked) .bump-action-on::after {
  content: "Quitar de mi pedido";
  font-size: .8rem;
}
`;

const CSS_FINAL = CSS_BLOQUES + CSS_ADAPTACION;

// Delimitan el bloque dentro del CSS guardado, para poder reemplazarlo en la
// próxima aplicación en vez de apilar otra copia.
const MARCA_INICIO = '/* GESICOMM:BLOQUES-VENTA:INICIO */';
const MARCA_FIN = '/* GESICOMM:BLOQUES-VENTA:FIN */';

module.exports = { TEMPLATE_BUMP, TEMPLATE_PAQUETES, CSS_BLOQUES: CSS_FINAL };

/**
 * Reemplaza el <template> de las listas ofertas_bump y paquetes por el
 * canónico, dejando intacto el contenedor que escribió la IA.
 *
 * Sin parser de DOM a propósito: se busca la etiqueta de apertura de la
 * lista y el PRIMER <template> que le sigue (los <template> no se anidan en
 * estos bloques). Si el modelo no puso la lista, no se inventa: significa
 * que esa vista no lleva ese bloque.
 *
 * @returns {{ html: string, css: string, aplicados: string[] }}
 */
function aplicarBloquesCanonicos(codigo) {
  const original = String(codigo?.html || '');
  let html = original;
  const aplicados = [];

  for (const [lista, plantilla] of [['ofertas_bump', TEMPLATE_BUMP], ['paquetes', TEMPLATE_PAQUETES]]) {
    const apertura = new RegExp(`<[a-z]+[^>]*data-gesicomm-lista=["']${lista}["'][^>]*>`, 'i');
    const m = apertura.exec(html);
    if (!m) continue;
    const desde = m.index + m[0].length;
    const ini = html.indexOf('<template', desde);
    if (ini === -1) continue;
    const finTag = html.indexOf('</template>', ini);
    if (finTag === -1) continue;
    html = html.slice(0, ini) + plantilla + html.slice(finTag + '</template>'.length);
    aplicados.push(lista);
  }

  if (!aplicados.length) return { html: original, css: String(codigo?.css || ''), aplicados };

  // Se REEMPLAZA la copia anterior, no se apila. Aplicar el bloque dos veces
  // (una regeneración, una edición con IA) dejaba dos juegos de reglas y el
  // viejo seguía pintando: la nota del order bump aparecía duplicada y con
  // el layout de la versión anterior.
  // Las marcas son comentarios CSS: sus /* y */ hay que escaparlos o el
  // patrón nunca matchea y la copia vieja se queda.
  const esc = t => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const previo = String(codigo?.css || '').replace(
    new RegExp(`${esc(MARCA_INICIO)}[\\s\\S]*?${esc(MARCA_FIN)}`, 'g'), '',
  ).trimEnd();
  // Va al final para ganarle al CSS del modelo sin necesidad de !important.
  const css = `${previo}\n\n${MARCA_INICIO}\n${CSS_FINAL}\n${MARCA_FIN}`;
  return { html, css, aplicados };
}

module.exports.aplicarBloquesCanonicos = aplicarBloquesCanonicos;
