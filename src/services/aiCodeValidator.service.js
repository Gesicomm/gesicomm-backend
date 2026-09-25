'use strict';

/**
 * "CommerceCodeValidator" — la capa de negocio que se corre DESPUÉS de
 * LandingCodigoService.sanitizar() sobre cualquier HTML de "lienzo en
 * blanco", generado por IA o pegado a mano. El sanitizador ya cubre la
 * seguridad (tags/atributos permitidos, JS denylist); esto cubre que el
 * código generado tenga sentido de NEGOCIO:
 *
 *   1) allowlist de atributos data-gesicomm-* (si la IA inventa
 *      "data-gesicomm-super-checkout", eso no hace nada y engaña al
 *      comercio creyendo que sí — se rechaza, no se ignora en silencio).
 *   2) allowlist de valores de data-gesicomm-lista (uno inventado también
 *      queda vacío para siempre — mismo motivo).
 *   3) los binds (data-gesicomm-bind) SÍ aceptan cualquier nombre en
 *      tiempo de ejecución (runtimeGesicomm.js hace `item[campo]` como
 *      fallback), así que uno fuera de lo documentado no es un error de
 *      negocio, es una advertencia: probablemente va a salir vacío.
 *   4) si el código usa data-gesicomm-comprar/agregar/oferta con un ID
 *      fijo, ese ID tiene que pertenecer a la selección de ESTA landing
 *      (nunca el producto de otro comercio).
 *   5) si el código muestra productos (catálogo, grilla, ficha) tiene que
 *      haber al menos una acción de compra en algún lado — si no, la
 *      landing "vende" pero nadie puede comprar.
 *
 * Grounded en runtimeGesicomm.js (frontend): estas listas son los nombres
 * que el runtime realmente lee, no solo lo que documenta promptsCodigo.js
 * — si diverge, hay que actualizar ambos lados a la vez.
 */

// Atributos que puede escribir el autor (humano o IA). Ver runtimeGesicomm.js.
const ATRIBUTOS_AUTOR = [
  'data-gesicomm-agregar', 'data-gesicomm-bind', 'data-gesicomm-bump', 'data-gesicomm-buscar',
  'data-gesicomm-cantidad-input', 'data-gesicomm-cargando', 'data-gesicomm-cargar-mas',
  'data-gesicomm-categoria', 'data-gesicomm-comprar', 'data-gesicomm-evento', 'data-gesicomm-filtro',
  'data-gesicomm-form', 'data-gesicomm-form-ok', 'data-gesicomm-imagen-principal', 'data-gesicomm-inicio',
  'data-gesicomm-limite', 'data-gesicomm-link', 'data-gesicomm-lista', 'data-gesicomm-oferta',
  'data-gesicomm-pagina', 'data-gesicomm-paginacion', 'data-gesicomm-redes', 'data-gesicomm-si',
  'data-gesicomm-si-vacio', 'data-gesicomm-sin', 'data-gesicomm-sin-resultados', 'data-gesicomm-tienda',
  'data-gesicomm-total', 'data-gesicomm-ver', 'data-gesicomm-whatsapp',
];
// Marcadores que el runtime agrega en tiempo de ejecución sobre elementos ya
// clonados (data-gesicomm-item, data-gesicomm-cta, etc.): el autor nunca los
// escribe, pero si aparecieran en el HTML fuente no son un riesgo — se
// aceptan para no romper un pegado de un documento ya renderizado.
const ATRIBUTOS_RUNTIME = [
  'data-gesicomm-generado', 'data-gesicomm-item', 'data-gesicomm-checkout', 'data-gesicomm-cta',
  'data-gesicomm-cta-original', 'data-gesicomm-imagen-idx', 'data-gesicomm-oferta-id',
  'data-gesicomm-variante', 'data-gesicomm-variante-id', 'data-gesicomm-paquete', 'data-gesicomm-cantidad',
];
const ATRIBUTOS_VALIDOS = new Set([...ATRIBUTOS_AUTOR, ...ATRIBUTOS_RUNTIME]);

const LISTAS_VALIDAS = new Set([
  'catalogo', 'productos', 'solo_productos', 'combos', 'combos_producto', 'recomendados',
  'ofertas', 'ofertas_bump', 'ofertas_pack', 'ofertas_upsell', 'variantes', 'imagenes',
  'beneficios', 'confianza', 'preguntas', 'combo_incluye', 'paquetes',
]);

// Documentados en promptsCodigo.js / runtimeGesicomm.js aplicarBind(). No es
// una allowlist estricta (ver punto 3 arriba): sirve para advertir, no para
// rechazar.
const BINDS_DOCUMENTADOS = new Set([
  'nombre', 'descripcion', 'descripcion_larga', 'precio', 'precio_antes', 'precio_separado',
  'por_unidad', 'descuento', 'ahorro', 'ahorro_texto', 'stock', 'incluye', 'imagen', 'url',
  'categoria', 'etiqueta', 'propuesta_valor', 'sobre', 'titulo', 'texto', 'pregunta', 'respuesta',
]);

// Acciones que cuentan como "se puede comprar desde acá".
const ACCIONES_COMPRA = ['data-gesicomm-comprar', 'data-gesicomm-agregar', 'data-gesicomm-ver'];

function extraerAtributos(html) {
  const vistos = new Set();
  const re = /\sdata-gesicomm-[a-z0-9-]+(?=[\s=/>])/gi;
  let m;
  while ((m = re.exec(String(html || '')))) vistos.add(m[0].trim().toLowerCase());
  return [...vistos];
}

function extraerValores(html, atributo) {
  const valores = [];
  const re = new RegExp(`${atributo}\\s*=\\s*"([^"]*)"`, 'gi');
  let m;
  while ((m = re.exec(String(html || '')))) valores.push(m[1]);
  return valores;
}

function contarOcurrencias(html, patron) {
  const m = String(html || '').match(patron);
  return m ? m.length : 0;
}

// Si el pedido dice explícitamente esto, se permite un reemplazo grande sin
// que la validación de preservación lo rechace — el comercio SÍ pidió
// rehacer todo, no es la IA yéndose de tema.
const PERMISO_REESCRITURA_TOTAL = /\b(rehac[eéí]|reemplaz[aá]|empez[aá]r?\s+de\s+cero|desde\s+cero|borr[aá]\s+todo|elimin[aá]\s+todo|dise[ñn]o\s+nuevo|nueva\s+landing|arm[aá]\s+de\s+nuevo|reescrib[ií])\b/i;

class AICodeValidator {
  /**
   * @param {string} html
   * @param {{ contentIdsPermitidos?: string[], vista?: 'inicio'|'ficha' }} [opciones]
   *   `contentIdsPermitidos`: content_id (slug producto / "combo-ID") de los
   *   items que esta landing tiene cargados — para validar IDs fijos.
   *   `vista`: 'ficha' no exige acción de compra propia si ya hereda un
   *   contexto de producto (el bind vive fuera de listas).
   * @returns {{ errores: string[], advertencias: string[] }}
   */
  static validar(html, { contentIdsPermitidos = null, vista = 'inicio' } = {}) {
    const texto = String(html || '');
    const errores = [];
    const advertencias = [];

    for (const atributo of extraerAtributos(texto)) {
      if (!ATRIBUTOS_VALIDOS.has(atributo)) {
        errores.push(`El atributo "${atributo}" no existe en Gesicomm: no hace nada, aunque parezca un botón o una lista real.`);
      }
    }

    for (const valor of extraerValores(texto, 'data-gesicomm-lista')) {
      if (valor && !LISTAS_VALIDAS.has(valor)) {
        errores.push(`data-gesicomm-lista="${valor}" no existe: esa sección va a quedar vacía para siempre.`);
      }
    }

    for (const valor of extraerValores(texto, 'data-gesicomm-bind')) {
      if (valor && !BINDS_DOCUMENTADOS.has(valor)) {
        advertencias.push(`data-gesicomm-bind="${valor}" no es un campo documentado: probablemente se muestre vacío.`);
      }
    }

    if (contentIdsPermitidos) {
      const permitidos = new Set(contentIdsPermitidos.map(String));
      for (const atributo of ['data-gesicomm-comprar', 'data-gesicomm-agregar', 'data-gesicomm-oferta']) {
        for (const valor of extraerValores(texto, atributo)) {
          // Sin valor = "el producto de la tarjeta/ficha", siempre válido.
          if (valor && !permitidos.has(valor)) {
            errores.push(`${atributo}="${valor}" apunta a un producto que no está en la selección de esta landing.`);
          }
        }
      }
    }

    const muestraProductos = /data-gesicomm-lista=["'](catalogo|productos|solo_productos|combos)["']/.test(texto);
    const tieneAccionCompra = ACCIONES_COMPRA.some(a => new RegExp(`${a}(\\s|=|/|>)`).test(texto));
    if (vista === 'inicio' && muestraProductos && !tieneAccionCompra) {
      errores.push('La página muestra productos pero no tiene ningún botón de compra, agregar o ver ficha (data-gesicomm-comprar/agregar/ver).');
    }
    if (vista === 'ficha' && !/data-gesicomm-comprar/.test(texto)) {
      errores.push('La ficha de producto no tiene botón de compra (data-gesicomm-comprar).');
    }

    return { errores, advertencias };
  }

  /**
   * Compara el código ANTES y DESPUÉS de un /ai/code/edit: aunque el nuevo
   * HTML sea válido por su cuenta (validar() de arriba), esto detecta que
   * la IA se pasó de rosca — pidieron "agregá una sección de beneficios" y
   * la respuesta reescribió media landing o le sacó el botón de comprar.
   * Reglas simples a propósito (ver docs/ai-code-generation.md): no hace
   * falta un diff real para atajar el caso típico, con contar
   * atributos/acciones antes y después alcanza.
   *
   * Se salta entero si `instruccion` pide explícitamente un rehecho total
   * (PERMISO_REESCRITURA_TOTAL) o si no había nada previo que preservar.
   *
   * @returns {{ errores: string[] }}
   */
  static validarPreservacion(anterior, nuevo, instruccion = '') {
    const htmlAnterior = String(anterior?.html || '').trim();
    const htmlNuevo = String(nuevo?.html || '').trim();
    if (!htmlAnterior) return { errores: [] };
    if (PERMISO_REESCRITURA_TOTAL.test(String(instruccion || ''))) return { errores: [] };

    const errores = [];
    const REGEX_ATRIBUTOS = /\sdata-gesicomm-[a-z0-9-]+/gi;
    const REGEX_ACCIONES = /data-gesicomm-(comprar|agregar|ver)\b/gi;

    const atributosAntes = contarOcurrencias(htmlAnterior, REGEX_ATRIBUTOS);
    const atributosDespues = contarOcurrencias(htmlNuevo, REGEX_ATRIBUTOS);
    if (atributosAntes >= 4 && atributosDespues < atributosAntes * 0.5) {
      errores.push(
        `El código nuevo tiene muchos menos atributos data-gesicomm-* que el actual (${atributosAntes} → ${atributosDespues}): parece un reemplazo completo en vez del ajuste puntual que pediste. Si en verdad querés rehacer todo, pedilo explícitamente ("rehacé todo", "empezá de cero").`,
      );
    }

    const accionesAntes = contarOcurrencias(htmlAnterior, REGEX_ACCIONES);
    const accionesDespues = contarOcurrencias(htmlNuevo, REGEX_ACCIONES);
    if (accionesAntes > 0 && accionesDespues === 0) {
      errores.push('El código nuevo se quedó sin ninguna acción de compra/agregar/ver ficha, aunque el actual sí tenía.');
    }

    if (htmlAnterior.length > 400 && htmlNuevo.length < htmlAnterior.length * 0.35) {
      errores.push(
        `El HTML nuevo es mucho más corto que el actual (${htmlAnterior.length} → ${htmlNuevo.length} caracteres): parece que se perdieron secciones enteras que el pedido no mencionaba.`,
      );
    }

    return { errores };
  }
}

module.exports = AICodeValidator;
