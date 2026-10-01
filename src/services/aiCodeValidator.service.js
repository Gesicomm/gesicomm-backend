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
  'data-gesicomm-categoria', 'data-gesicomm-comprar', 'data-gesicomm-countdown',
  'data-gesicomm-countdown-parte', 'data-gesicomm-evento', 'data-gesicomm-filtro',
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
  'ofertas', 'ofertas_bump', 'ofertas_pack', 'variantes', 'imagenes',
  'beneficios', 'confianza', 'preguntas', 'combo_incluye', 'paquetes', 'estadisticas',
]);

// Documentados en promptsCodigo.js / runtimeGesicomm.js aplicarBind(). No es
// una allowlist estricta (ver punto 3 arriba): sirve para advertir, no para
// rechazar.
const BINDS_DOCUMENTADOS = new Set([
  'nombre', 'descripcion', 'descripcion_larga', 'precio', 'precio_antes', 'precio_separado',
  'por_unidad', 'descuento', 'ahorro', 'ahorro_texto', 'stock', 'incluye', 'imagen', 'url',
  'categoria', 'etiqueta', 'propuesta_valor', 'sobre', 'titulo', 'texto', 'pregunta', 'respuesta',
  'valor',
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

// Dos modos de edición: por default un pedido es EDIT_PRESERVE (achicar
// mucho el código es sospechoso, se rechaza). Si el pedido entra en este
// patrón, pasa a EDIT_DESTRUCTIVE_ALLOWED: reducir/rehacer es justo lo que
// se pidió, así que los guardrails de tamaño no aplican. No es una
// clasificación con IA — alcanza con reconocer las formas típicas de
// pedir menos código a propósito ("simplificá", "sacá X") además de las de
// pedir un rehecho total ("desde cero").
// OJO: sin \b al final de cada alternativa — \b es ASCII-only en JS, así
// que "rehacé\b" nunca matchea (la é no cuenta como "letra" para \b y la
// posición entre é y el espacio deja de ser un límite de palabra). Mejor
// una lista de raíces sin acento final, sin \b de cierre.
const PATRON_EDIT_DESTRUCTIVE_ALLOWED = /\b(rehac|reemplaz|empez[aá]r?\s+de\s+cero|desde\s+cero|arm[aá]\s+de\s+nuevo|reescrib|dise[ñn]o\s+nuevo|nueva\s+landing|simplific|minimalista|reduc|menos\s+secciones|sac[aá]\s|quit[aá]\s|elimin|borr|dej[aá]\s+solo)/i;

const SECCIONES_TEMPLATE_CRITICAS = [
  'timeline-resultados',
  'ingredientes',
  'prueba-social',
  'comparacion',
  'tabla-comparativa',
];

// Atributos cuyo valor es la IDENTIDAD de un item de la landing. Todos se
// resuelven con buscar() en el runtime, que solo acepta el content_id
// exacto o "principal". data-gesicomm-oferta-id / -variante-id / -paquete
// NO están acá: los escribe el runtime al renderizar, no el modelo.
const ATRIBUTOS_CON_CONTENT_ID = [
  'data-gesicomm-comprar', 'data-gesicomm-agregar', 'data-gesicomm-ver', 'data-gesicomm-item',
];

// Campos reales del producto en el runtime (itemPublicoARuntime +
// contenidoFicha en datosRuntime.js). data-gesicomm-si / -sin consultan
// productoActual[campo]: un campo inventado esconde el bloque para siempre.
const CAMPOS_PRODUCTO = new Set([
  'id', 'referencia_id', 'tipo', 'nombre', 'descripcion', 'descripcion_larga',
  'precio', 'precio_antes', 'precio_separado', 'descuento_pct', 'ahorro',
  'imagen', 'imagenes_url', 'categoria', 'etiqueta', 'stock', 'agotado',
  'tiene_variantes', 'variantes', 'ofertas', 'productos_incluidos', 'combo_productos',
  'propuesta_valor', 'sobre', 'beneficios', 'confianza', 'preguntas', 'combo_incluye', 'url',
]);

// Campos de la tienda que data-gesicomm-tienda puede pintar (tiendaRuntime
// en datosRuntime.js). Se dejan afuera "colores", "incluir_precio" e
// "incluir_url": no son texto y saldrían como [object Object] o "true".
const CAMPOS_TIENDA = new Set([
  'nombre', 'logo', 'whatsapp', 'mensaje', 'telefono', 'email', 'direccion',
  'horarios', 'instagram', 'facebook', 'tiktok', 'youtube', 'twitter',
]);

/** @returns {'preserve'|'destructive_allowed'} */
function modoEdicion(instruccion) {
  return PATRON_EDIT_DESTRUCTIVE_ALLOWED.test(String(instruccion || '')) ? 'destructive_allowed' : 'preserve';
}

class AICodeValidator {
  /**
   * @param {string} html
   * @param {{ contentIdsPermitidos?: string[], vista?: 'inicio'|'ficha', demoData?: object }} [opciones]
   *   `contentIdsPermitidos`: content_id (slug producto / "combo-ID") de los
   *   items que esta landing tiene cargados — para validar IDs fijos.
   *   `vista`: 'ficha' no exige acción de compra propia si ya hereda un
   *   contexto de producto (el bind vive fuera de listas).
   *   `demoData`: el `demo_data` que devolvió el RAG junto con este HTML —
   *   para chequear que countdown/estadísticas vengan respaldados (ver
   *   detectarBloquesSinConfirmar, que hace lo mismo del lado de venta ya
   *   guardada; esto corre ANTES de guardar, sobre la respuesta cruda).
   * @returns {{ errores: string[], advertencias: string[] }}
   */
  static validar(html, { contentIdsPermitidos = null, vista = 'inicio', categoriasReales = null, demoData = null } = {}) {
    const texto = String(html || '');
    const errores = [];
    const advertencias = [];

    for (const atributo of extraerAtributos(texto)) {
      if (!ATRIBUTOS_VALIDOS.has(atributo)) {
        errores.push(`El atributo "${atributo}" no existe en Gesicomm: no hace nada, aunque parezca un botón o una lista real.`);
      }
    }

    for (const valor of extraerValores(texto, 'data-gesicomm-lista')) {
      if (valor === 'ofertas_upsell') {
        // El runtime la devuelve vacía a propósito: el upsell es una etapa
        // del checkout, no un bloque de página. Se sigue ignorando en las
        // landings viejas que ya la tienen guardada; lo que se corta acá es
        // que una generación nueva la vuelva a producir.
        errores.push('data-gesicomm-lista="ofertas_upsell" no es una lista de página: Gesicomm muestra el upsell como etapa del checkout, así que ese bloque queda vacío siempre. Sacalo.');
      } else if (valor && !LISTAS_VALIDAS.has(valor)) {
        errores.push(`data-gesicomm-lista="${valor}" no existe: esa sección va a quedar vacía para siempre.`);
      }
    }

    // Countdown/estadísticas SIN demo_data: la primitiva queda en el HTML
    // pero Gesicomm no tiene con qué activarla (venta.urgencia/prueba_social
    // se guardan en false por default) — el runtime la oculta sola y el
    // comercio nunca ve el preview que se le prometió al tildar "que la IA
    // proponga ejemplos". Es un error real, no una advertencia: se manda al
    // repair para que declare el demo_data que le faltó, o saque la
    // primitiva si de verdad no la necesitaba.
    if (/data-gesicomm-countdown(?!-parte)/.test(texto) && !demoData?.urgencia?.activo) {
      errores.push(
        'Usaste data-gesicomm-countdown pero no declaraste demo_data.urgencia (con activo:true y un preset). '
        + 'Sin eso, Gesicomm no puede activar el countdown y el bloque queda oculto siempre. '
        + 'Agregá demo_data.urgencia = {"activo": true, "preset": "24h"|"48h"|"72h"}, o sacá el countdown del HTML si esta composición no lo necesita.',
      );
    }
    if (/data-gesicomm-lista=["']estadisticas["']/.test(texto) && !(Array.isArray(demoData?.prueba_social?.items) && demoData.prueba_social.items.length)) {
      errores.push(
        'Usaste data-gesicomm-lista="estadisticas" pero no declaraste demo_data.prueba_social.items. '
        + 'Sin eso, Gesicomm no tiene con qué llenar la lista y la sección queda oculta siempre. '
        + 'Agregá demo_data.prueba_social.items con 2 a 4 cifras de ejemplo, o sacá esa lista del HTML si esta composición no la necesita.',
      );
    }

    for (const valor of extraerValores(texto, 'data-gesicomm-bind')) {
      if (valor && LISTAS_VALIDAS.has(valor)) {
        // Confusión confirmada, no "probablemente vacío": "beneficios",
        // "confianza", etc. son nombres de LISTA (arrays), nunca un campo
        // escalar de data-gesicomm-bind. Pasa a error para que dispare el
        // repair — a diferencia de un nombre inventado cualquiera (ver
        // comentario del punto 3 arriba), acá se sabe con certeza que el
        // autor confundió un data-gesicomm-lista con un bind.
        errores.push(`data-gesicomm-bind="${valor}" es el nombre de una LISTA (data-gesicomm-lista="${valor}"), no un campo de data-gesicomm-bind: envolvé ese bloque en <template data-gesicomm-lista="${valor}"> en vez de usarlo como bind suelto.`);
      } else if (valor && !BINDS_DOCUMENTADOS.has(valor)) {
        advertencias.push(`data-gesicomm-bind="${valor}" no es un campo documentado: probablemente se muestre vacío.`);
      }
    }

    if (contentIdsPermitidos) {
      // El runtime resuelve estos valores en buscar(): solo el content_id
      // exacto (o "principal"). Un identificador construido por el modelo
      // —"producto_310", el nombre del producto, un slug inventado— no
      // resuelve nada y el botón queda muerto sin ningún error visible.
      const permitidos = new Set([...contentIdsPermitidos.map(String), 'principal']);
      const muestra = [...permitidos].slice(0, 10).join(', ');
      const sufijo = permitidos.size > 10 ? `, … (${permitidos.size} en total)` : '';
      for (const atributo of ATRIBUTOS_CON_CONTENT_ID) {
        for (const valor of extraerValores(texto, atributo)) {
          // Sin valor = "el producto de la tarjeta/ficha", siempre válido.
          if (valor && !permitidos.has(valor)) {
            errores.push(
              `${atributo}="${valor}" no es un content_id de esta landing: el runtime no lo resuelve y ese control queda muerto. `
              + `Usá uno de estos, tal cual: ${muestra}${sufijo}.`,
            );
          }
        }
      }
    }

    // Mismo principio que los content_id: el modelo solo puede consultar
    // campos que existen de verdad. Un data-gesicomm-si="garantia" deja el
    // bloque oculto para siempre y no hay forma de notarlo mirando la página.
    for (const atributo of ['data-gesicomm-si', 'data-gesicomm-sin']) {
      for (const valor of extraerValores(texto, atributo)) {
        if (valor && !CAMPOS_PRODUCTO.has(valor)) {
          errores.push(`${atributo}="${valor}" no es un campo del producto: ese bloque queda oculto siempre. Campos válidos: ${[...CAMPOS_PRODUCTO].join(', ')}.`);
        }
      }
    }
    for (const valor of extraerValores(texto, 'data-gesicomm-tienda')) {
      if (valor && !CAMPOS_TIENDA.has(valor)) {
        errores.push(`data-gesicomm-tienda="${valor}" no es un dato de la tienda: se muestra vacío. Campos válidos: ${[...CAMPOS_TIENDA].join(', ')}.`);
      }
    }

    // El runtime filtra por categoría con igualdad exacta (ver
    // runtimeGesicomm.js), así que una categoría aproximada —"Freidoras"
    // cuando la real es "Freidoras de Aire"— deja la grilla vacía sin
    // ningún aviso. Solo se valida si sabemos las categorías reales.
    if (categoriasReales?.length) {
      const reales = new Map(categoriasReales.filter(Boolean).map(c => [String(c).toLowerCase(), String(c)]));
      for (const valor of extraerValores(texto, 'data-gesicomm-categoria')) {
        if (valor && !reales.has(valor.toLowerCase())) {
          errores.push(`data-gesicomm-categoria="${valor}" no es una categoría real: el filtro es exacto y esa grilla queda vacía. Usá una de estas, tal cual: ${[...reales.values()].join(', ')}.`);
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
    // Sin data-gesicomm-cta el total del botón sube al marcar un order bump
    // o elegir un paquete, pero el texto sigue diciendo "Comprar ahora": el
    // cliente ve un número que no coincide con el precio de arriba.
    if (vista === 'ficha' && /data-gesicomm-total/.test(texto) && !/data-gesicomm-cta\b/.test(texto)) {
      errores.push('El botón de compra tiene data-gesicomm-total pero no data-gesicomm-cta: envolvé su texto en <span data-gesicomm-cta>Comprar ahora</span> para que Gesicomm pueda nombrar el paquete y las ofertas que se llevan.');
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
   * Se salta entero si `instruccion` es EDIT_DESTRUCTIVE_ALLOWED (rehecho
   * total o reducción a propósito, ver modoEdicion()) o si no había nada
   * previo que preservar.
   *
   * @returns {{ errores: string[] }}
   */
  static validarPreservacion(anterior, nuevo, instruccion = '') {
    const htmlAnterior = String(anterior?.html || '').trim();
    const htmlNuevo = String(nuevo?.html || '').trim();
    if (!htmlAnterior) return { errores: [] };
    if (modoEdicion(instruccion) === 'destructive_allowed') return { errores: [] };

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

    for (const seccion of SECCIONES_TEMPLATE_CRITICAS) {
      const marcador = new RegExp(`data-template-section=["']${seccion}["']`, 'i');
      if (marcador.test(htmlAnterior) && !marcador.test(htmlNuevo)) {
        errores.push(`El código nuevo eliminó la sección obligatoria del template "${seccion}". Conservá esa estructura y optimizá/rellená su contenido en vez de borrarla.`);
      }
    }

    return { errores };
  }

  /**
   * Chequeos de CALIDAD del CSS, separados de validar() a propósito: acá
   * no hay nada inseguro ni roto, es código que se puede publicar — pero
   * incumple la dirección de arte del contrato. Por eso estos motivos
   * disparan UN repair (la IA suele corregirlos sola) pero NO bloquean el
   * guardado si el repair no los arregla: una landing con un solo corte
   * responsive es peor que una con dos, pero mucho mejor que ninguna.
   *
   * @returns {string[]} motivos (vacío = OK)
   */
  static validarCalidad(codigo, familia = null) {
    const css = String(codigo?.css || '');
    const html = String(codigo?.html || '');
    const motivos = [];

    // Un <div class="...placeholder..."></div> vacío se ve como un
    // rectángulo de color en la página publicada: pasaba en el hero, donde
    // debería ir la foto real del producto (<img data-gesicomm-bind="imagen">).
    const placeholdersVacios = (html.match(/<(\w+)[^>]*class="[^"]*placeholder[^"]*"[^>]*>\s*<\/\1>/gi) || []).length;
    if (placeholdersVacios) {
      motivos.push(
        `Hay ${placeholdersVacios} elemento(s) "placeholder" vacíos: en la página publicada son un rectángulo de color. Poné la imagen real del producto con <img data-gesicomm-bind="imagen"> o sacá el bloque.`,
      );
    }

    const listasPaquetes = html.match(/<([a-z]+)[^>]*data-gesicomm-lista=["']paquetes["'][^>]*>[\s\S]*?<\/\1>/gi) || [];
    const paquetesSinImagen = listasPaquetes.filter(bloque => /<template[\s>]/i.test(bloque) && !/data-gesicomm-bind=["']imagen["']/i.test(bloque)).length;
    if (paquetesSinImagen) {
      motivos.push(
        `La lista "paquetes" tiene ${paquetesSinImagen} template(s) sin imagen: agregá <img data-gesicomm-bind="imagen" alt=""> dentro de cada tarjeta para mostrar la foto del paquete/producto.`,
      );
    }

    // Moda: el talle tiene que ser una variante real (data-gesicomm-lista=
    // "variantes"), nunca un texto fijo ni un input de cantidad disfrazado
    // de selector de talle — ver INSTRUCCIONES_MODA del lado RAG. Es una
    // página con acción de compra real (no un catálogo/inicio) la que
    // necesita el selector, por eso se chequea junto a data-gesicomm-comprar.
    if (familia === 'moda' && /data-gesicomm-comprar/i.test(html) && !/data-gesicomm-lista=["']variantes["']/i.test(html)) {
      motivos.push(
        'Es un producto de moda con acción de compra pero no se encontró data-gesicomm-lista="variantes": el talle tiene que ser un selector de variante real, no un texto fijo ni un input de cantidad.',
      );
    }

    // El contenedor completo de "estadisticas" (el que itera los 2-4 items
    // de demo_data.prueba_social) repetido en dos lugares del documento
    // produce un hero con 4 grupos de estrellas amontonados en vez de un
    // rating único — ver CONTRATO_BASE del lado RAG. Se detecta contando
    // aperturas del atributo, no aperturas de sección, porque el bug
    // concreto es "el mismo contenedor iterable puesto dos veces".
    const repeticionesEstadisticas = (html.match(/data-gesicomm-lista=["']estadisticas["']/gi) || []).length;
    if (repeticionesEstadisticas > 1) {
      motivos.push(
        `El contenedor data-gesicomm-lista="estadisticas" aparece ${repeticionesEstadisticas} veces: cada uno va a iterar los mismos 2-4 items completos, así que un rating "de adorno" en el hero termina mostrando todas las cifras con sus estrellas repetidas. Dejalo UNA sola vez, en la sección de prueba social dedicada; si el hero quiere una insignia, usá texto fijo sin número (ej. "★★★★★ Calificado por nuestros clientes").`,
      );
    }

    if (!css.trim()) return motivos;

    // Los @media de layout son los que tienen un ancho; el de
    // prefers-reduced-motion no cuenta como corte responsive.
    const mediasLayout = (css.match(/@media[^{]*\((?:max|min)-width/gi) || []).length;
    if (mediasLayout < 2) {
      motivos.push(
        `El CSS tiene ${mediasLayout} corte responsive con ancho y hacen falta al menos 2 (mobile y tablet): agregá los @media que falten sin tocar el diseño de escritorio.`,
      );
    }
    if (!/prefers-reduced-motion/i.test(css) && /@keyframes|animation\s*:|transition\s*:/i.test(css)) {
      motivos.push('El CSS anima pero no respeta @media (prefers-reduced-motion: reduce): agregá ese bloque al final.');
    }
    if (!/clamp\(/i.test(css)) {
      motivos.push('La tipografía no usa clamp(): pasá al menos los títulos a una escala fluida con clamp().');
    }
    return motivos;
  }

  /**
   * Bloques de urgencia/prueba social que el HTML usa (data-gesicomm-countdown,
   * data-gesicomm-lista="estadisticas") pero que todavía no tienen datos
   * reales confirmados por el comercio en `venta` — no se puede publicar
   * mientras existan. Chequeo estricto: si la primitiva está en el HTML, el
   * bloque tiene que estar activo, completo Y en estado "confirmado" — no
   * alcanza con "activo && no confirmado", porque así se cubre también el
   * caso de `venta.urgencia`/`venta.prueba_social` inexistente o corrupto
   * con el atributo igual presente en el HTML (la sola presencia de la
   * primitiva significa "esta landing depende de este dato").
   *
   * No valida si `fin_at` ya venció: la expiración es comportamiento normal
   * de runtime (el countdown vencido se oculta solo, mismo criterio que
   * cualquier lista vacía), no un motivo para bloquear publicación.
   */
  static detectarBloquesSinConfirmar(htmls, venta) {
    const texto = (Array.isArray(htmls) ? htmls : [htmls]).filter(Boolean).join('\n');
    const pendientes = [];
    if (/data-gesicomm-countdown(?!-parte)/.test(texto)) {
      const u = venta?.urgencia;
      if (!u?.activo || !u?.fin_at || u?.estado !== 'confirmado') pendientes.push('urgencia');
    }
    if (/data-gesicomm-lista=["']estadisticas["']/.test(texto)) {
      const p = venta?.prueba_social;
      if (!p?.activo || !Array.isArray(p?.items) || !p.items.length || p?.estado !== 'confirmado') pendientes.push('prueba_social');
    }
    return pendientes;
  }
}

module.exports = AICodeValidator;
module.exports.modoEdicion = modoEdicion;
