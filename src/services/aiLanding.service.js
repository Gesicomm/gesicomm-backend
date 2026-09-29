'use strict';

/**
 * Servicio de Inteligencia Artificial para Gesicomm.
 * Llama al microservicio RAG (FastAPI) a través de la red interna Docker.
 */

const { Op } = require('sequelize');
const { Producto, Tienda } = require('../models');
const LandingSimpleService = require('./landingSimple.service');
const LandingCodigoService = require('./landingCodigo.service');
const AICodeValidator = require('./aiCodeValidator.service');
const { aplicarBloquesCanonicos } = require('./bloquesVentaCanonicos');
const AiGenerationLogService = require('./aiGenerationLog.service');

// Reemplazamos localhost por 127.0.0.1 para evitar problemas de IPv6 en Node 18+ con docker
const rawUrl = process.env.RAG_INTERNAL_URL || 'http://rag-backend:8000';
const RAG_URL = rawUrl.replace('localhost', '127.0.0.1');

/**
 * Duplas tipográficas curadas (Google Fonts), agrupadas por el CARÁCTER
 * que le dan a la página.
 *
 * Por qué la variedad se decide acá y no en el prompt: con la misma
 * instrucción y temperatura baja, el modelo elige siempre la misma dupla
 * (venía sacando Playfair Display + Instrument Sans en todas las tiendas,
 * porque además estaba de ejemplo en el contrato). Si la elección la hace
 * el LLM "libremente", el default se muda de fuente pero sigue siendo un
 * default. Acá, en cambio, cada tienda recibe un abanico distinto.
 *
 * La elección es DETERMINISTA por tienda: la misma tienda siempre ve las
 * mismas candidatas (regenerar no le cambia la identidad de un día para
 * otro), pero dos tiendas distintas arrancan de paletas distintas.
 */
const DUPLAS_TIPOGRAFICAS = [
  { display: 'Fraunces', body: 'Karla', caracter: 'editorial cálido, con personalidad artesanal' },
  { display: 'Archivo Black', body: 'Archivo', caracter: 'impacto rotundo, casi cartel' },
  { display: 'Cormorant Garamond', body: 'Lato', caracter: 'clásico elegante, aire de boutique' },
  { display: 'Space Grotesk', body: 'IBM Plex Sans', caracter: 'técnico y contemporáneo' },
  { display: 'Bodoni Moda', body: 'Work Sans', caracter: 'alto contraste, lujo editorial' },
  { display: 'Outfit', body: 'Inter Tight', caracter: 'geométrico limpio, producto moderno' },
  { display: 'Bitter', body: 'Source Sans 3', caracter: 'robusto y confiable, tono de oficio' },
  { display: 'Syne', body: 'DM Sans', caracter: 'raro y de diseño, para marcas jóvenes' },
  { display: 'Libre Baskerville', body: 'Jost', caracter: 'tradición con base moderna' },
  { display: 'Unbounded', body: 'Manrope', caracter: 'expresivo y expansivo, tono pop' },
  { display: 'Instrument Serif', body: 'Geist', caracter: 'editorial sobrio, mínimo' },
  { display: 'Anton', body: 'Barlow', caracter: 'condensado y directo, tono deportivo' },
];

/** URL de Google Fonts para una dupla, con los pesos que hacen falta. */
function urlGoogleFonts({ display, body }) {
  const familia = (nombre, pesos) => `family=${nombre.replace(/ /g, '+')}:wght@${pesos}`;
  return `https://fonts.googleapis.com/css2?${familia(display, '400;600;700')}&${familia(body, '400;500;600')}&display=swap`;
}

/** Hash estable de un string — para que la misma tienda reciba siempre lo mismo. */
function hashEstable(texto) {
  let h = 0;
  for (let i = 0; i < String(texto).length; i++) {
    h = (h * 31 + String(texto).charCodeAt(i)) >>> 0;
  }
  return h;
}

class AILandingService {

  /**
   * POST genérico al microservicio RAG, con el header X-API-Key y timeout.
   * `err.status` queda seteado con el código HTTP cuando la respuesta no es
   * ok — si el RAG no tiene /ai/code/* desplegado, el flujo falla de forma
   * explícita para no volver al generador rígido basado en PageSchema.
   */
  static async _fetchRAG(path, payload, timeoutMs = 90000) {
    const ragKey = process.env.RAG_API_KEY;
    if (!ragKey) {
      throw new Error('La variable de entorno RAG_API_KEY no está configurada en el servidor.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${RAG_URL}${path}`, {
        method: 'POST',
        headers: {
          'X-API-Key': ragKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.detail || `Error del microservicio de IA (${response.status})`);
        err.status = response.status;
        throw err;
      }

      return response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('La generación con IA tardó demasiado tiempo. Intentá de nuevo.');
      }
      throw err;
    }
  }

  /**
   * La marca que el comercio cargó en "Mi Tienda" (Branding) — es lo que
   * la landing TIENE que respetar. Antes acá viajaban solo los dos colores
   * de acento: sin `color_fondo` el modelo se inventaba el fondo (sommix
   * tiene #101A21 y las landings salían con #0a0a0a), y sin saber si hay
   * logo no podía decidir entre mostrar el logo o el nombre en el header.
   */
  /**
   * Tres duplas tipográficas distintas para esta tienda, sacadas del
   * catálogo con un salto (no tres seguidas del array) para que el abanico
   * no sea siempre "vecinas". Determinista por tienda — ver
   * DUPLAS_TIPOGRAFICAS.
   */
  static fuentesSugeridasParaTienda(tienda) {
    const total = DUPLAS_TIPOGRAFICAS.length;
    const inicio = hashEstable(`${tienda.id}-${tienda.nombre || ''}`) % total;
    const salto = 5; // coprimo con 12: recorre el catálogo sin repetir
    return [0, 1, 2].map(i => {
      const dupla = DUPLAS_TIPOGRAFICAS[(inicio + i * salto) % total];
      return { ...dupla, url: urlGoogleFonts(dupla) };
    });
  }

  static storeContextParaRAG(tienda) {
    return {
      nombre: tienda.nombre || 'Mi Tienda',
      descripcion: tienda.descripcion || '',
      whatsapp: tienda.contacto_whatsapp || tienda.telefono || '',
      color_primario: tienda.color_primario || '#2563eb',
      color_secundario: tienda.color_secundario || null,
      color_fondo: tienda.color_fondo || null,
      fuentes_sugeridas: this.fuentesSugeridasParaTienda(tienda),
      // Solo si tiene logo o no: la URL no le sirve al modelo (la imagen
      // real la inyecta el runtime con data-gesicomm-tienda="logo"), pero
      // saber que existe cambia cómo maqueta el header.
      tiene_logo: !!tienda.logo_imagen,
      instrucciones_marca: [
        'Respetar color_primario, color_secundario y color_fondo usando variables CSS --gc-primario, --gc-secundario, --gc-fondo, --gc-texto y --gc-superficie.',
        'Si tiene_logo=true, incluir un <img data-gesicomm-tienda="logo"> visible en el header junto al nombre con data-gesicomm-tienda="nombre".',
        'Las imagenes reales de productos y combos deben mostrarse completas con object-fit: contain, no recortadas como banners.',
      ],
    };
  }

  static _extraerVariableCss(css, nombre) {
    const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(css || '').match(new RegExp(`${escapado}\\s*:\\s*([^;]+)`, 'i'));
    return match ? match[1].trim() : '';
  }

  /**
   * Primera familia de una variable de fuente. Acepta varios nombres
   * porque el nombre de la variable lo elige el modelo: pide
   * --font-display/--font-text pero en la práctica también escribe
   * --font-heading/--font-body. Si no encuentra ninguna, cae al
   * font-family del selector que se le pase (h1 o body).
   */
  static _extraerFuente(css, variables, selectorFallback = null) {
    const nombres = Array.isArray(variables) ? variables : [variables];
    for (const nombre of nombres) {
      const valor = this._extraerVariableCss(css, nombre);
      const match = valor.match(/['"]([^'"]+)['"]|([^,\s][^,]*)/);
      const fuente = (match?.[1] || match?.[2] || '').trim();
      // var(--otra-cosa) no es una fuente: es un alias, no sirve para heredar.
      if (fuente && !fuente.startsWith('var(')) return fuente;
    }
    if (selectorFallback) {
      const bloque = String(css || '').match(new RegExp(`${selectorFallback}\\s*\\{[^}]*font-family\\s*:\\s*([^;}]+)`, 'i'));
      const primera = bloque?.[1]?.split(',')[0]?.replace(/['"]/g, '').trim();
      if (primera && !primera.startsWith('var(')) return primera;
    }
    return '';
  }

  static designContextDesdeCodigo(codigo, tienda) {
    const css = String(codigo?.css || '');
    const existente = codigo?.design_context && typeof codigo.design_context === 'object' ? codigo.design_context : {};
    return {
      brand: {
        primary: existente.brand?.primary || this._extraerVariableCss(css, '--gc-primario') || tienda.color_primario || '#2563eb',
        secondary: existente.brand?.secondary || this._extraerVariableCss(css, '--gc-secundario') || tienda.color_secundario || null,
        background: existente.brand?.background || this._extraerVariableCss(css, '--gc-fondo') || '#ffffff',
        surface: existente.brand?.surface || this._extraerVariableCss(css, '--gc-superficie') || this._extraerVariableCss(css, '--surface') || null,
        text: existente.brand?.text || this._extraerVariableCss(css, '--gc-texto') || '#111827',
      },
      typography: {
        heading: existente.typography?.heading
          || this._extraerFuente(css, ['--font-display', '--font-heading', '--font-titulo'], 'h1'),
        body: existente.typography?.body
          || this._extraerFuente(css, ['--font-text', '--font-body', '--font-texto'], 'body'),
      },
      visual_style: existente.visual_style || existente.visualStyle || 'derivado del inicio generado',
      radius: existente.radius || (css.includes('999px') ? 'pill' : css.includes('14px') || css.includes('16px') ? 'medium' : 'subtle'),
      spacing: existente.spacing || (css.includes('--esp-5') || css.includes('--space-5') ? 'generous' : 'balanced'),
      motion: existente.motion || (css.includes('cubic-bezier') ? 'smooth cinematic' : css.includes('transition') || css.includes('animation') ? 'smooth' : 'minimal'),
      button_style: existente.button_style || (css.includes('999px') ? 'solid pill' : 'solid'),
    };
  }

  static referenciaVisualInicio(landingModel) {
    const codigoInicio = landingModel?.content?.codigo || {};
    const fonts = Array.isArray(codigoInicio.fonts) ? codigoInicio.fonts : [];
    const designContext = codigoInicio.design_context || landingModel?.content?.design_context || null;
    if (!fonts.length && !designContext) return '';
    return [
      'DESIGN_CONTEXT DEL INICIO YA PUBLICADO:',
      'Usá este resumen como guía de marca para la ficha: mantené familias tipográficas, escala, paleta, ritmo de espaciado, tono visual y nivel de efecto. No copies secciones del inicio ni cambies el motor comercial.',
      JSON.stringify({ fonts, design_context: designContext }, null, 2),
    ].join('\n\n');
  }

  /**
   * HTML/CSS/JS libre desde un prompt — ver docs/ai-code-generation.md.
   * Reemplaza al antiguo PageSchema como motor de diseño creativo: acá
   * el LLM escribe código de verdad (animaciones, layouts) en vez de
   * rellenar un JSON tipado sin lugar para eso.
   */
  static async solicitarCodigoRAG({ prompt, tienda, productos, pageType = 'landing', producto = null, comercio = null }) {
    const plan = this.planLandingIA({ prompt, productos, pageType, producto, comercio });
    const data = await this._fetchRAG('/ai/code/generate', {
      page_type: pageType,
      prompt: this.promptConPlanLanding(prompt, plan),
      context: {
        store: this.storeContextParaRAG(tienda),
        products: productos,
        product: producto,
        commerce: { ...(comercio || {}), landing_plan: plan },
      },
    });
    if (!data.ok || !data.html) throw new Error('Respuesta del microservicio de IA inválida.');
    return this._codigoConMetadata(data);
  }

  /**
   * Edita el HTML/CSS/JS que ya existe con una instrucción nueva, en vez de
   * rehacerlo todo — esto es lo que hace que "hacela más animada" ajuste la
   * landing existente en vez de regenerarla entera con textos distintos.
   */
  static async solicitarEdicionRAG({ instruction, current, tienda, productos, pageType = 'landing', producto = null, comercio = null }) {
    const plan = this.planLandingIA({ prompt: instruction, productos, pageType, producto, comercio });
    const data = await this._fetchRAG('/ai/code/edit', {
      instruction: this.promptConPlanLanding(instruction, plan),
      current: {
        html: current?.html || '',
        css: current?.css || '',
        js: current?.js || '',
        fonts: Array.isArray(current?.fonts) ? current.fonts : [],
        design_context: current?.design_context || {},
      },
      page_type: pageType,
      context: {
        store: this.storeContextParaRAG(tienda),
        products: productos,
        product: producto,
        commerce: { ...(comercio || {}), landing_plan: plan },
      },
    });
    if (!data.ok || !data.html) throw new Error('Respuesta del microservicio de IA inválida.');
    return this._codigoConMetadata(data);
  }

  /**
   * Le pide al RAG UN intento de corrección puntual (ver
   * _conRepairAutomatico) — no vuelve a diseñar, solo arregla los errores
   * que le mandamos.
   */
  static async solicitarRepairRAG({ current, errores, tienda, productos, pageType = 'landing', producto = null, comercio = null }) {
    const plan = this.planLandingIA({ prompt: errores.join('\n'), productos, pageType, producto, comercio });
    const data = await this._fetchRAG('/ai/code/repair', {
      current: {
        html: current?.html || '',
        css: current?.css || '',
        js: current?.js || '',
        fonts: Array.isArray(current?.fonts) ? current.fonts : [],
        design_context: current?.design_context || {},
      },
      errores,
      page_type: pageType,
      context: {
        store: this.storeContextParaRAG(tienda),
        products: productos,
        product: producto,
        commerce: { ...(comercio || {}), landing_plan: plan },
      },
    });
    if (!data.ok || !data.html) throw new Error('Respuesta del microservicio de IA inválida.');
    return this._codigoConMetadata(data);
  }

  /**
   * {html, css, js} + metadata de telemetría (modelo, intentos, tokens) que
   * viene en la respuesta de /ai/code/generate|edit|repair. Los campos
   * extra no molestan a nadie que solo lea .html/.css/.js (sanitizar(),
   * AICodeValidator, actualizarCodigo) — así no hace falta pasear un
   * segundo objeto en paralelo por todos lados.
   */
  static _codigoConMetadata(data) {
    return {
      html: data.html,
      css: data.css || '',
      js: data.js || '',
      fonts: Array.isArray(data.fonts) ? data.fonts : [],
      design_context: data.design_context && typeof data.design_context === 'object' ? data.design_context : null,
      _modelo: data.model || null,
      _intentos: data.intentos || 1,
      _tokensInput: data.tokens_input || 0,
      _tokensOutput: data.tokens_output || 0,
    };
  }

  /**
   * Planner comercial liviano para el generador IA.
   *
   * No es un PageSchema ni una plantilla rígida: no define componentes ni
   * layout. Solo le dice al modelo qué bloques comerciales tienen sentido
   * según los datos reales disponibles. El RAG sigue generando HTML libre.
   */
  static planLandingIA({ prompt = '', productos = [], pageType = 'landing', producto = null, comercio = null } = {}) {
    const catalogo = Array.isArray(productos) ? productos : [];
    const foco = producto || catalogo[0] || {};
    const texto = this._textoClasificacion([prompt, foco?.nombre, foco?.categoria, foco?.ficha_rubro, foco?.descripcion, foco?.propuesta_valor, JSON.stringify(foco?.ficha_datos || {})].join(' '));
    const familia = this.inferirFamiliaProducto(texto, catalogo);
    const hayPaquetes = !!comercio?.hay_paquetes || catalogo.some(p => Array.isArray(p.paquetes) && p.paquetes.length);
    const hayBumps = !!comercio?.hay_order_bumps || catalogo.some(p => Array.isArray(p.order_bumps) && p.order_bumps.length);
    const hayCombos = !!comercio?.hay_combos || catalogo.some(p => p.tipo === 'combo');
    const hayRelacionados = comercio?.recomendados_activo !== false && (
      (Array.isArray(comercio?.recomendados_items) && comercio.recomendados_items.length > 0)
      || catalogo.length > 1
    );
    const hayBeneficios = this._alguno(catalogo, p => Array.isArray(p.beneficios) && p.beneficios.some(b => b?.titulo || b?.texto));
    const hayFaq = this._alguno(catalogo, p => Array.isArray(p.preguntas_frecuentes) && p.preguntas_frecuentes.some(f => f?.pregunta && f?.respuesta));
    const hayVariantes = this._alguno(catalogo, p => Number(p.variantes_count) > 0);
    const hayGaleria = this._alguno(catalogo, p => Number(p.imagenes_count) > 1);
    const hayFichaDatos = this._alguno(catalogo, p => p.ficha_datos && typeof p.ficha_datos === 'object' && Object.keys(p.ficha_datos).length > 0);

    const sections = [];
    const add = (id, reason, opts = {}) => {
      if (sections.some(s => s.id === id)) return;
      sections.push({
        id,
        reason,
        priority: opts.priority || 'recommended',
        data_source: opts.data_source || 'real_data_or_runtime',
        required_when: opts.required_when || null,
        omit_if_missing: opts.omit_if_missing !== false,
      });
    };

    add('trust_bar', 'Reduce fricción antes del primer CTA: envío, pago, devolución y seguridad.', { priority: 'high', omit_if_missing: false });
    add('hero_product_value', 'Primera pantalla con propuesta clara, producto real, precio por bind y CTA principal.', { priority: 'high', omit_if_missing: false });
    if (hayGaleria) add('gallery_or_demo', 'Hay varias imágenes: conviene mostrar exploración visual o demo sin inventar media.');
    add('offer_price_cta', 'El precio, precio tachado y CTA deben salir de binds/data-gesicomm, no texto fijo.', { priority: 'high', omit_if_missing: false });
    if (hayVariantes) add('variants_selector', 'Hay variantes reales: se necesita selector visible antes de comprar.', { priority: 'high', data_source: 'data-gesicomm-lista="variantes"' });
    if (hayPaquetes) add('quantity_packages', 'Hay paquetes/ofertas por cantidad: usar lista "paquetes" como bloque de decisión.', { priority: 'high', data_source: 'data-gesicomm-lista="paquetes"' });
    if (hayBumps && pageType === 'product') add('order_bump_slot', 'Hay order bumps reales: reservar casilla arriba del botón de compra.', { priority: 'high', data_source: 'data-gesicomm-lista="ofertas_bump"' });
    if (hayCombos) add('combos_or_bundle_value', 'Hay combos reales: mostrar ahorro/incluye sin inventar composición.', { data_source: 'data-gesicomm-lista="combos" o "combos_producto"' });
    if (hayBeneficios || hayFichaDatos) add('benefits', 'Hay beneficios o datos de ficha: convertirlos en razones de compra escaneables.', { data_source: 'beneficios/ficha_datos' });

    if (familia === 'suplementos') {
      add('how_it_works', 'En suplementos conviene explicar mecanismo/objetivo sin claims médicos.', { data_source: 'propuesta_valor/ficha_datos' });
      add('ingredients_or_formula', 'Si hay ingredientes/dosis en ficha_datos, mostrarlos; si no hay datos reales, omitir.', { data_source: 'ficha_datos', required_when: 'ingredientes reales disponibles' });
      add('how_to_use', 'Modo de uso y rutina reducen objeciones en suplementos.', { data_source: 'ficha_datos o copy informativo no médico' });
    } else if (familia === 'tecnologia' || familia === 'electrodomesticos') {
      add('features_specs', 'Productos técnicos necesitan funciones y especificaciones antes de comprar.', { data_source: 'ficha_datos/especificaciones' });
      add('comparison', 'La comparación ayuda si hay diferencias verificables; no inventar competidores.', { data_source: 'datos reales o comparación genérica nosotros/alternativas' });
    } else if (familia === 'bazar_hogar') {
      add('use_cases', 'Bazar/hogar convierte mejor mostrando usos concretos y escenarios.', { data_source: 'descripcion/ficha_datos' });
      add('before_after_or_steps', 'Una demo paso a paso reemplaza texto largo cuando el producto resuelve una tarea.', { data_source: 'imagenes/descripción' });
    } else if (familia === 'belleza') {
      add('routine_steps', 'Belleza necesita rutina, aplicación y resultado esperado sin promesas falsas.', { data_source: 'ficha_datos/propuesta_valor' });
      add('ingredients_or_materials', 'Ingredientes/materiales reales sostienen confianza.', { data_source: 'ficha_datos' });
    }

    add('social_proof_real_only', 'Prueba social solo si hay datos reales; si no, usar marcador editable o no mostrar.', { data_source: 'testimonios reales', required_when: 'testimonios reales disponibles' });
    if (hayFaq) add('faq', 'Hay preguntas frecuentes reales: usarlas para resolver objeciones.', { data_source: 'data-gesicomm-lista="preguntas"' });
    else add('faq', 'FAQ útil para objeciones de envío, pago y cambios, sin inventar datos del producto.', { priority: 'optional', data_source: 'políticas/tienda' });
    if (hayRelacionados) add('related_products', 'Productos relacionados/complementos permiten cross-sell sin bloquear la compra principal.', { data_source: 'data-gesicomm-lista="recomendados"' });
    add('guarantee_shipping_returns', 'Cierre de confianza con envío, pago seguro, cambios/devoluciones y links legales.', { priority: 'high', omit_if_missing: false });
    add('final_cta', 'Resumen de oferta y CTA final después de resolver objeciones.', { priority: 'high', omit_if_missing: false });

    return {
      strategy: pageType === 'product' ? 'direct_response_product_page' : 'adaptive_ecommerce_landing',
      product_family: familia,
      goal: comercio?.tipo_venta === 'producto_unico' || pageType === 'product'
        ? 'vender una ficha de producto con alto foco en conversión'
        : 'presentar tienda/catalogo y llevar a fichas de producto',
      rules: [
        'Este plan es una guía comercial, no un layout rígido ni una lista obligatoria de componentes.',
        'Podés fusionar, reordenar o representar visualmente las secciones de manera creativa.',
        'No inventes testimonios, certificaciones, comparaciones, stock, precios, descuentos ni claims médicos.',
        'Los datos comerciales deben salir de data-gesicomm-* y de las listas del runtime.',
        'Si una sección no tiene datos reales suficientes, omitila o dejá un marcador editable claramente marcado.',
      ],
      facts: {
        products_count: catalogo.length,
        has_packages: hayPaquetes,
        has_order_bumps: hayBumps,
        has_combos: hayCombos,
        has_related_products: hayRelacionados,
        has_variants: hayVariantes,
        has_gallery: hayGaleria,
        has_product_benefits: hayBeneficios,
        has_product_faq: hayFaq,
      },
      sections,
    };
  }

  static promptConPlanLanding(prompt, plan) {
    return [
      String(prompt || '').trim(),
      '',
      'PLAN_INTERNO_DE_LANDING_GESICOMM:',
      JSON.stringify(plan, null, 2),
      '',
      'Usá el plan como criterio de estructura comercial adaptable. La salida sigue siendo HTML/CSS/JS libre: no devuelvas JSON, no nombres el plan al usuario y no conviertas esto en una plantilla rígida.',
    ].join('\n');
  }

  static _textoClasificacion(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  static _alguno(lista, predicado) {
    return Array.isArray(lista) && lista.some(item => {
      try { return predicado(item); } catch { return false; }
    });
  }

  static inferirFamiliaProducto(texto, catalogo = []) {
    const categorias = this._textoClasificacion((catalogo || []).map(p => [p?.categoria, p?.ficha_rubro, p?.nombre].filter(Boolean).join(' ')).join(' '));
    const t = `${texto} ${categorias}`;
    if (/(suplement|proteina|creatina|colageno|vitamina|capsula|adelgaz|fitness|gimnas|nutric|omega|magnesio|probio)/.test(t)) return 'suplementos';
    if (/(electrodom|licuadora|freidora|air fryer|cafetera|aspiradora|cortador|procesador|batidora|cocina)/.test(t)) return 'electrodomesticos';
    if (/(bazar|hogar|cocina|utensilio|organizador|recipiente|mesa|decoracion|limpieza|jardin)/.test(t)) return 'bazar_hogar';
    if (/(tech|tecnolog|electron|auricular|smart|celular|notebook|gadget|parlante|reloj|camara)/.test(t)) return 'tecnologia';
    if (/(beauty|belleza|skincare|piel|cabello|cosmetic|maquill|serum|crema|shampoo)/.test(t)) return 'belleza';
    if (/(ropa|moda|calzado|remera|camisa|vestido|jean|zapatilla|talle)/.test(t)) return 'moda';
    return 'general';
  }

  static resumenTextoRAG(valor, max = 320) {
    const texto = String(valor || '').replace(/\s+/g, ' ').trim();
    if (!texto) return null;
    return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
  }

  static valorCompactoRAG(valor, profundidad = 0) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
    if (typeof valor === 'string') return this.resumenTextoRAG(valor, 180);
    if (Array.isArray(valor)) {
      const lista = valor
        .slice(0, 8)
        .map(item => this.valorCompactoRAG(item, profundidad + 1))
        .filter(item => item !== null && item !== undefined && item !== '');
      return lista.length ? lista : null;
    }
    if (typeof valor === 'object' && profundidad < 2) {
      const salida = {};
      for (const [clave, contenido] of Object.entries(valor).slice(0, 14)) {
        const compacto = this.valorCompactoRAG(contenido, profundidad + 1);
        if (compacto !== null && compacto !== undefined && compacto !== '') salida[clave] = compacto;
      }
      return Object.keys(salida).length ? salida : null;
    }
    return null;
  }

  static listaMarketingRAG(lista, max = 6) {
    if (!Array.isArray(lista)) return [];
    return lista
      .map(item => {
        if (typeof item === 'string') return this.resumenTextoRAG(item, 180);
        if (!item || typeof item !== 'object') return null;
        const titulo = this.resumenTextoRAG(item.titulo || item.title || item.nombre || item.label, 80);
        const texto = this.resumenTextoRAG(item.texto || item.descripcion || item.description || item.detalle || item.body, 180);
        if (!titulo && !texto) return null;
        return { ...(titulo ? { titulo } : {}), ...(texto ? { texto } : {}) };
      })
      .filter(Boolean)
      .slice(0, max);
  }

  static listaFaqRAG(lista, max = 6) {
    if (!Array.isArray(lista)) return [];
    return lista
      .map(item => {
        if (!item || typeof item !== 'object') return null;
        const pregunta = this.resumenTextoRAG(item.pregunta || item.question, 120);
        const respuesta = this.resumenTextoRAG(item.respuesta || item.answer, 240);
        return pregunta && respuesta ? { pregunta, respuesta } : null;
      })
      .filter(Boolean)
      .slice(0, max);
  }

  static resumenProductoRAG(p, ofertas = {}) {
    const faqJson = this.listaFaqRAG(p.preguntas_frecuentes);
    const faqRelacion = this.listaFaqRAG(p.faq);
    return {
      content_id: p.slug || `producto-${p.id}`,
      tipo: 'producto',
      nombre: p.nombre,
      precio: p.precio_base || p.precio,
      precio_tachado: p.precio_tachado || null,
      descripcion: this.resumenTextoRAG(p.descripcion_corta || p.sobre_este_producto || p.descripcion_larga, 420) || '',
      propuesta_valor: this.resumenTextoRAG(p.propuesta_valor, 420),
      categoria: p.categoria?.nombre || null,
      ficha_rubro: p.ficha_rubro || null,
      ficha_datos: this.valorCompactoRAG(p.ficha_datos) || {},
      beneficios: this.listaMarketingRAG(p.beneficios),
      confianza: this.listaMarketingRAG(p.confianza, 4),
      preguntas_frecuentes: faqJson.length ? faqJson : faqRelacion,
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 12).map(t => String(t)).filter(Boolean) : [],
      stock: Number(p.cantidad_disponible) || 0,
      estado_venta: p.estado_venta || null,
      imagenes_count: Array.isArray(p.imagenes) ? p.imagenes.length : 0,
      variantes_count: Array.isArray(p.variantes) ? p.variantes.length : 0,
      ...(ofertas || {}),
    };
  }

  static resumenComboRAG(c) {
    return {
      content_id: `combo-${c.id}`,
      tipo: 'combo',
      nombre: c.nombre,
      precio: c.precio_total,
      precio_tachado: c.snapshot_precio_original || null,
      descripcion: this.resumenTextoRAG(c.descripcion || c.sobre_este_producto, 420) || '',
      propuesta_valor: this.resumenTextoRAG(c.propuesta_valor, 420),
      categoria: c.producto_padre?.categoria?.nombre || null,
      ficha_rubro: c.ficha_rubro || null,
      ficha_datos: this.valorCompactoRAG(c.ficha_datos) || {},
      beneficios: this.listaMarketingRAG(c.beneficios),
      confianza: this.listaMarketingRAG(c.confianza, 4),
      preguntas_frecuentes: this.listaFaqRAG(c.preguntas_frecuentes),
      imagenes_count: Array.isArray(c.imagenes) ? c.imagenes.length : 0,
      items_count: Array.isArray(c.items) ? c.items.length + 1 : 1,
    };
  }


  /**
   * Productos/combos reales que se le mandan al RAG como contexto — misma
   * forma para crear y para regenerar, así el LLM siempre ve datos reales
   * y nunca inventa precios, secciones ni claims.
   */
  static async catalogoParaRAG(inquilino_id, items) {
    const { Categoria, ProductoCombo, ProductoComboImagen, ProductoComboItem, ProductoFaq, ProductoImagen, ProductoVariante } = require('../models');
    // La categoría viaja con cada producto porque el HTML la usa como
    // filtro EXACTO (data-gesicomm-categoria="Freidoras de Aire"): sin
    // esto el modelo la inventaba corta ("Freidoras") y la grilla filtrada
    // quedaba vacía en la landing publicada.
    const incluirCategoria = [{ model: Categoria, as: 'categoria', attributes: ['nombre'], required: false }];
    const incluirProductoRAG = [
      ...incluirCategoria,
      { model: ProductoImagen, as: 'imagenes', attributes: ['id'], required: false },
      { model: ProductoVariante, as: 'variantes', attributes: ['id'], required: false, where: { activo: true } },
      { model: ProductoFaq, as: 'faq', attributes: ['pregunta', 'respuesta', 'orden'], required: false },
    ];
    const lista = Array.isArray(items) ? items : [];
    const idsProductos = lista.filter(i => i.tipo === 'producto').map(i => Number(i.referencia_id ?? i.id));
    const idsCombos = lista.filter(i => i.tipo === 'combo').map(i => Number(i.referencia_id ?? i.id));

    let productos = [];
    let combos = [];
    if (idsProductos.length || idsCombos.length) {
      [productos, combos] = await Promise.all([
        idsProductos.length
          ? Producto.findAll({ where: { inquilino_id, activo: true, id: { [Op.in]: idsProductos } }, include: incluirProductoRAG })
          : Promise.resolve([]),
        idsCombos.length
          ? ProductoCombo.findAll({
            where: { inquilino_id, estado: 'ACTIVO', id: { [Op.in]: idsCombos } },
            include: [
              { model: Producto, as: 'producto_padre', attributes: ['id', 'nombre'], required: false, include: incluirCategoria },
              { model: ProductoComboImagen, as: 'imagenes', attributes: ['id'], required: false },
              { model: ProductoComboItem, as: 'items', attributes: ['id'], required: false },
            ],
          })
          : Promise.resolve([]),
      ]);
    } else {
      // Sin selección (fallback inicial): primeros 10 productos activos.
      productos = await Producto.findAll({
        where: { inquilino_id, activo: true },
        include: incluirProductoRAG,
        limit: 10,
        order: [['created_at', 'DESC']],
      });
    }

    // Ofertas reales de esos productos (paquetes, order bump y upsell). Sin
    // esto el modelo no sabía que existían y nunca ponía los bloques
    // data-gesicomm-lista="ofertas_bump" / "paquetes" en la ficha: el
    // comercio cargaba sus ofertas y la landing generada no las mostraba.
    const ofertasPorProducto = await this.ofertasPorProducto(inquilino_id, productos.map(p => p.id));

    return [
      // Un solo identificador visible para el modelo: el content_id, que es
      // lo único que resuelve buscar() en el runtime. Antes iba también un
      // `id` con formato "producto_310" que el runtime NO resuelve — y el
      // contrato le decía al modelo "usá su id", así que cualquier control
      // que lo usara quedaba muerto en silencio.
      ...productos.map(p => this.resumenProductoRAG(p, ofertasPorProducto.get(p.id) || {})),
      ...combos.map(c => this.resumenComboRAG(c)),
    ];
  }

  /**
   * Ofertas activas agrupadas por producto ancla y por estrategia, con la
   * forma en que las muestra la landing:
   *   - paquetes    → lista "paquetes" ("Elegí tu oferta": x2, x3…)
   *   - order_bump  → lista "ofertas_bump" (casilla arriba del botón)
   *   - upsell      → NO va en la ficha; Gesicomm lo muestra en el checkout
   * Se manda solo lo que el modelo necesita para decidir qué bloques poner,
   * no el detalle de componentes (eso lo resuelve el runtime).
   */
  static async ofertasPorProducto(inquilino_id, idsProducto) {
    const mapa = new Map();
    if (!idsProducto.length) return mapa;
    const { Oferta } = require('../models');
    const ofertas = await Oferta.findAll({
      where: { inquilino_id, activo: true, producto_ancla_id: { [Op.in]: idsProducto } },
      attributes: ['id', 'nombre', 'estrategia', 'precio_normal', 'precio_order_bump', 'producto_ancla_id'],
      order: [['orden', 'ASC']],
    });

    for (const o of ofertas) {
      const actual = mapa.get(o.producto_ancla_id) || { paquetes: [], order_bumps: [], upsells: [] };
      const resumen = {
        id: o.id,
        nombre: o.nombre,
        estrategia: o.estrategia,
        precio: Number(o.precio_order_bump || o.precio_normal) || null,
      };
      if (o.estrategia === 'normal') actual.paquetes.push(resumen);
      else if (o.estrategia === 'order_bump') actual.order_bumps.push(resumen);
      else if (o.estrategia === 'upsell') actual.upsells.push(resumen);
      mapa.set(o.producto_ancla_id, actual);
    }
    // Se limpian las listas vacías para no mandarle ruido al modelo.
    for (const [id, grupos] of mapa) {
      const limpio = Object.fromEntries(Object.entries(grupos).filter(([, v]) => v.length));
      mapa.set(id, Object.keys(limpio).length ? limpio : {});
    }
    return mapa;
  }

  /**
   * La configuración comercial de "Configurar venta" que el modelo necesita
   * para decidir qué bloques incluir: qué tipo de venta es, si hay ventas
   * cruzadas activas y si van recomendados.
   */
  static contextoComercialParaRAG(venta, catalogoRAG) {
    const ventaConfigurada = venta?.configurado === true;
    const idsOfertasElegidas = new Set((venta?.cross_sell?.ofertas || []).map(Number).filter(Boolean));
    const recomendadosItems = Array.isArray(venta?.recomendados?.items) ? venta.recomendados.items.map(String).filter(Boolean) : [];
    // Content_id tal cual: es la única forma de identidad que maneja el
    // wizard y la única que entiende el runtime.
    const idsDestacados = new Set(recomendadosItems);
    const ofertaVisible = oferta => !ventaConfigurada || idsOfertasElegidas.has(Number(oferta.id));
    const hayBumps = catalogoRAG.some(p => (p.order_bumps || []).some(ofertaVisible));
    const hayPaquetes = catalogoRAG.some(p => (p.paquetes || []).some(ofertaVisible));
    const hayCombos = catalogoRAG.some(p => p.tipo === 'combo');
    const ofertasSeleccionadas = catalogoRAG.flatMap(p => [
      ...(p.paquetes || []).filter(ofertaVisible).map(o => ({ ...o, producto: p.nombre, bloque: 'paquetes' })),
      ...(p.order_bumps || []).filter(ofertaVisible).map(o => ({ ...o, producto: p.nombre, bloque: 'ofertas_bump' })),
      ...(p.upsells || []).filter(ofertaVisible).map(o => ({ ...o, producto: p.nombre, bloque: 'upsell_carrito' })),
    ]);
    const destacadosSeleccionados = catalogoRAG
      .filter(p => idsDestacados.has(String(p.content_id || '')))
      .map(p => ({ content_id: p.content_id, nombre: p.nombre, tipo: p.tipo || 'producto', precio: p.precio }))
      .slice(0, 12);
    return {
      tipo_venta: venta?.tipo || 'catalogo',
      seleccion: venta?.seleccion || 'manual',
      categorias: Array.isArray(venta?.categorias) ? venta.categorias : [],
      incluir_combos: venta?.incluir_combos !== false,
      abrir_en: venta?.abrir_en || 'tienda',
      principal_id: venta?.principal_id || null,
      combos_primero: venta?.combos_primero === true,
      cross_sell_activo: venta?.cross_sell?.activo !== false,
      ofertas_elegidas_ids: Array.from(idsOfertasElegidas),
      ofertas_seleccionadas: ofertasSeleccionadas.slice(0, 30),
      paquetes_config: venta?.paquetes || {},
      recomendados_activo: venta?.recomendados?.activo !== false,
      recomendados_modo: venta?.recomendados?.modo || 'auto',
      recomendados_items: recomendadosItems,
      destacados_seleccionados: destacadosSeleccionados,
      recomendados_max: venta?.recomendados?.max || 4,
      recomendados_titulo: venta?.recomendados?.titulo || '',
      hay_order_bumps: hayBumps,
      hay_paquetes: hayPaquetes,
      hay_combos: hayCombos,
    };
  }

  static productosParaFichasIniciales(catalogoRAG, venta) {
    const recomendadosItems = Array.isArray(venta?.recomendados?.items) ? venta.recomendados.items.map(String).filter(Boolean) : [];
    // Los destacados vienen del wizard como content_id, igual que el
    // catálogo: ya no hace falta tolerar la variante "producto_310".
    const idsDestacados = new Set(recomendadosItems);
    const catalogo = Array.isArray(catalogoRAG) ? catalogoRAG : [];
    // SOLO los destacados. Antes, sin ninguno marcado, esto caía a "los
    // primeros 4 productos" y generaba 4 fichas propias además de la home:
    // seis llamadas al modelo en fila, casi cinco minutos, y el navegador
    // cortaba la request antes de que el backend terminara. Desde que existe
    // la ficha GENERAL ese fallback no aporta nada: los productos que nadie
    // destacó ya tienen página.
    return catalogo
      .filter(p => p?.content_id && idsDestacados.has(String(p.content_id)))
      .slice(0, 4);
  }

  /**
   * Datos reales del producto/combo de una ficha PROPIA, a partir de su
   * content_id público (el mismo que arma contentIdPanel() en el frontend:
   * el slug del producto, o "combo-<id>"). Sin esto no se le puede decir al
   * RAG "esta ficha es de ESTE producto puntual" — page_type="product" con
   * context.product real es lo que permite pedirle una ficha distinta por
   * producto ("este termo estilo outdoor", "este auricular tech").
   */
  static async resolverProductoPorContentId(inquilino_id, contentId) {
    const comboMatch = /^combo-(\d+)$/.exec(String(contentId || ''));
    if (comboMatch) {
      const { Categoria, ProductoCombo, ProductoComboImagen, ProductoComboItem } = require('../models');
      const combo = await ProductoCombo.findOne({
        where: { id: Number(comboMatch[1]), inquilino_id, estado: 'ACTIVO' },
        include: [
          { model: Producto, as: 'producto_padre', attributes: ['id', 'nombre'], required: false, include: [{ model: Categoria, as: 'categoria', attributes: ['nombre'], required: false }] },
          { model: ProductoComboImagen, as: 'imagenes', attributes: ['id'], required: false },
          { model: ProductoComboItem, as: 'items', attributes: ['id'], required: false },
        ],
      });
      if (!combo) return null;
      return this.resumenComboRAG(combo);
    }
    const { Categoria, ProductoFaq, ProductoImagen, ProductoVariante } = require('../models');
    const include = [
      { model: Categoria, as: 'categoria', attributes: ['nombre'], required: false },
      { model: ProductoImagen, as: 'imagenes', attributes: ['id'], required: false },
      { model: ProductoVariante, as: 'variantes', attributes: ['id'], required: false, where: { activo: true } },
      { model: ProductoFaq, as: 'faq', attributes: ['pregunta', 'respuesta', 'orden'], required: false },
    ];
    let producto = await Producto.findOne({ where: { slug: contentId, inquilino_id, activo: true }, include });
    const idMatch = !producto && /^producto-(\d+)$/.exec(String(contentId || ''));
    if (idMatch) {
      producto = await Producto.findOne({ where: { id: Number(idMatch[1]), inquilino_id, activo: true }, include });
    }
    if (!producto) return null;
    return this.resumenProductoRAG(producto);
  }

  /**
   * Pipeline completo de validación de un código antes de guardarlo:
   * sanitizador (seguridad + sintaxis JS) → preservación (¿se comió
   * secciones que el pedido no mencionaba?) → CommerceCodeValidator
   * (negocio: atributos/listas reales, acción de compra). Se usa tanto
   * para el intento inicial como para el resultado del repair.
   *
   * @returns {string[]} errores (vacío = todo OK)
   */
  static validarTodo(anterior, nuevo, instruccion, vista, categoriasReales = null, contentIdsPermitidos = null) {
    const errores = [];
    try {
      LandingCodigoService.sanitizar(nuevo);
    } catch (err) {
      errores.push(...(err.errores || [err.message]));
    }
    if (anterior) {
      errores.push(...AICodeValidator.validarPreservacion(anterior, nuevo, instruccion).errores);
    }
    errores.push(...AICodeValidator.validar(nuevo.html, { vista, categoriasReales, contentIdsPermitidos }).errores);
    return errores;
  }

  /**
   * Genera/edita con UN reintento automático de corrección si la
   * validación falla — así el comercio no ve un error técnico por algo que
   * la IA puede arreglar sola (un atributo inventado, faltó el botón de
   * compra). Nunca más de un repair: si sigue fallando, se tira el error
   * con el detalle para que el usuario reformule.
   *
   * `generar` es la función que pide el primer intento (generate o edit);
   * si el RAG todavía no tiene /ai/code/repair desplegado (404), se
   * mantienen los errores de la primera validación tal cual.
   *
   * Devuelve { codigo, repairUsed, erroresPreRepair, tokensInput,
   * tokensOutput, modelo } — el detalle es para AiGenerationLog (ver
   * registrarLog más abajo), no hace falta en el camino feliz.
   */
  static async _conRepairAutomatico({ generar, anterior, instruccion, vista, tienda, productos, pageType, producto, comercio = null }) {
    // Las categorías que el HTML puede usar como filtro son las de los
    // productos de ESTA landing: cualquier otra deja la grilla vacía.
    const categoriasReales = [...new Set((productos || []).map(p => p.categoria).filter(Boolean))];
    // Identidad de los items: el content_id es lo único que el runtime sabe
    // resolver, y es lo único que le pasamos al modelo (ver catalogoParaRAG).
    const contentIdsPermitidos = [...new Set((productos || []).map(p => p.content_id).filter(Boolean))];
    let codigo = await generar();
    let errores = this.validarTodo(anterior, codigo, instruccion, vista, categoriasReales, contentIdsPermitidos);
    // Calidad (dirección de arte): se le pide al repair junto con los
    // errores reales, pero si sigue sin cumplir NO se bloquea el guardado
    // — ver AICodeValidator.validarCalidad.
    let mejorables = AICodeValidator.validarCalidad(codigo);
    const erroresPreRepair = [...errores, ...mejorables];
    let repairUsed = false;
    let tokensInput = codigo._tokensInput || 0;
    let tokensOutput = codigo._tokensOutput || 0;
    let modelo = codigo._modelo || null;

    if (errores.length || mejorables.length) {
      try {
        const reparado = await this.solicitarRepairRAG({
          current: codigo, errores: [...errores, ...mejorables], tienda, productos, pageType, producto, comercio,
        });
        repairUsed = true;
        tokensInput += reparado._tokensInput || 0;
        tokensOutput += reparado._tokensOutput || 0;
        modelo = reparado._modelo || modelo;
        const erroresReparado = this.validarTodo(anterior, reparado, instruccion, vista, categoriasReales, contentIdsPermitidos);
        // El repair solo se acepta si no empeoró lo importante: si vuelve
        // con errores reales que antes no estaban, se queda el original.
        if (!erroresReparado.length || errores.length) {
          codigo = reparado;
          errores = erroresReparado;
          mejorables = AICodeValidator.validarCalidad(codigo);
        }
      } catch (err) {
        if (err.status !== 404) throw err;
        // /ai/code/repair todavía no desplegado: se mantienen los errores originales.
      }
    }
    if (mejorables.length) {
      console.warn('[AI Landing] se guarda con observaciones de calidad:', mejorables.join(' | '));
    }

    if (errores.length) {
      const err = new Error(
        'La IA generó un código que Gesicomm no puede publicar, ni siquiera después de un intento de corrección.',
      );
      err.errores = errores;
      err.telemetria = { repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo };
      throw err;
    }
    return { codigo, repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo };
  }

  /**
   * Crea un borrador de landing generado por IA en Gesicomm.
   * La landing se guarda con activo: false (borrador) para revisión previa.
   */
  static async crearDesdeIA({ tienda_id, inquilino_id, prompt, items = [], venta = null }) {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('Escribí una descripción de al menos 5 caracteres para que la IA arme tu landing.');
    }

    const tienda = await Tienda.findByPk(tienda_id);
    if (!tienda) throw new Error('Tienda no encontrada.');

    const ventaLimpia = LandingCodigoService.limpiarVenta(venta);
    const catalogoRAG = await this.catalogoParaRAG(inquilino_id, items);
    // El wizard del chat ya trae la configuración de venta (ofertas que
    // se muestran, combos, recomendados, tipo de venta): con eso el modelo
    // pone los bloques correctos desde la PRIMERA generación, sin que el
    // comercio tenga que pedir un ajuste después. Si viene sin venta
    // (flujos viejos), el contexto sale igual de las ofertas reales que ya
    // tienen los productos elegidos.
    const comercio = this.contextoComercialParaRAG(ventaLimpia, catalogoRAG);

    // Antes se guardaba en pages/page_versions (arquitectura aparte del
    // Page Builder) y esa fila nunca aparecía en /api/mis-landings-simples
    // ni se podía publicar: "Ver página publicada" siempre mostraba la
    // landing vacía. Ahora se guarda como lienzo en blanco — mismo modelo
    // Landing/LandingItem que usa el resto del editor, publicar
    // (cambiarEstado) y la vista pública (LandingCodigoPublica).
    const instruccion = prompt.trim();
    const inicio = Date.now();
    let codigo;
    let titulo = tienda.nombre;
    let repairUsed = false;
    let erroresPreRepair = [];
    let tokensInput = 0;
    let tokensOutput = 0;
    let modelo = null;
    const vistasProductos = {};
    let vistaProductoGeneral = null;
    try {
      const resultado = await this._conRepairAutomatico({
        generar: () => this.solicitarCodigoRAG({ prompt: instruccion, tienda, productos: catalogoRAG, pageType: 'landing', comercio }),
        anterior: null,
        instruccion,
        vista: 'inicio',
        tienda,
        productos: catalogoRAG,
        pageType: 'landing',
        producto: null,
        comercio,
      });
      ({ codigo, repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo } = resultado);
      codigo.design_context = this.designContextDesdeCodigo(codigo, tienda);

      // En paralelo, no en fila: son independientes entre sí y encadenarlas
      // multiplicaba el tiempo total de la request por la cantidad de fichas.
      const fichasIniciales = this.productosParaFichasIniciales(catalogoRAG, ventaLimpia);
      const conFichaPropia = new Set(fichasIniciales.map(p => p.content_id));
      const tareasFichas = fichasIniciales.map(async (productoFicha) => {
        const instruccionFicha = [
          instruccion,
          '',
          `Generá una ficha de producto propia para "${productoFicha.nombre}".`,
          'Si el prompt del comercio menciona este producto o pide timer, urgencia, paquetes, order bump, upsell o una oferta agresiva, aplicalo en esta ficha.',
          'Usá datos reales con data-gesicomm-bind, data-gesicomm-comprar y las listas comerciales disponibles; no inventes precios.',
        ].join('\n');
        try {
          const ficha = await this._conRepairAutomatico({
            generar: () => this.solicitarCodigoRAG({
              prompt: instruccionFicha,
              tienda,
              productos: catalogoRAG,
              pageType: 'product',
              producto: productoFicha,
              comercio,
            }),
            anterior: null,
            instruccion: instruccionFicha,
            vista: 'ficha',
            tienda,
            productos: catalogoRAG,
            pageType: 'product',
            producto: productoFicha,
            comercio,
          });
          const codigoFicha = ficha.codigo;
          // El order bump y los paquetes los pone Gesicomm con su bloque
          // canónico (foto, precio tachado, ahorro, estados): ver
          // bloquesVentaCanonicos. El modelo solo decide dónde van.
          Object.assign(codigoFicha, aplicarBloquesCanonicos(codigoFicha));
          codigoFicha.design_context = this.designContextDesdeCodigo(codigoFicha, tienda);
          vistasProductos[productoFicha.content_id] = codigoFicha;
          tokensInput += ficha.tokensInput || 0;
          tokensOutput += ficha.tokensOutput || 0;
        } catch (errFicha) {
          console.warn('[AI Landing] no se pudo generar ficha inicial IA:', productoFicha.content_id, errFicha.message);
        }
      });

      // Ficha GENERAL: la que usa todo producto que no tiene la suya propia.
      // Sin esto, la landing salía con ficha solo para los destacados y el
      // resto del catálogo no tenía página: el cliente tocaba "Ver" y no
      // llegaba a ningún lado. No depende de las propias, así que se lanza
      // junto con ellas.
      const referencia = catalogoRAG.find(p => !conFichaPropia.has(p.content_id)) || catalogoRAG[0] || null;
      const tareaGeneral = (async () => {
        if (!referencia) return;
        const instruccionGeneral = [
          instruccion,
          '',
          'Generá la ficha de producto GENERAL de esta tienda: la plantilla que se usa para CUALQUIER producto del catálogo.',
          'Todo sale de binds y listas (no menciones un producto puntual por su nombre en los textos fijos).',
          'Tiene que funcionar igual para el producto más caro y el más barato, con y sin ofertas.',
        ].join('\n');
        try {
          const general = await this._conRepairAutomatico({
            generar: () => this.solicitarCodigoRAG({
              prompt: instruccionGeneral, tienda, productos: catalogoRAG,
              pageType: 'product', producto: referencia, comercio,
            }),
            anterior: null, instruccion: instruccionGeneral, vista: 'ficha',
            tienda, productos: catalogoRAG, pageType: 'product', producto: referencia, comercio,
          });
          vistaProductoGeneral = general.codigo;
          Object.assign(vistaProductoGeneral, aplicarBloquesCanonicos(vistaProductoGeneral));
          vistaProductoGeneral.design_context = this.designContextDesdeCodigo(vistaProductoGeneral, tienda);
          tokensInput += general.tokensInput || 0;
          tokensOutput += general.tokensOutput || 0;
        } catch (errGeneral) {
          console.warn('[AI Landing] no se pudo generar la ficha general:', errGeneral.message);
        }
      })();

      await Promise.all([...tareasFichas, tareaGeneral]);
    } catch (err) {
      await AiGenerationLogService.registrar({
        tiendaId: tienda_id, operacion: 'generate', pageType: 'landing', target: 'inicio',
        prompt: instruccion, latenciaMs: Date.now() - inicio, exitoso: false,
        validationErrors: err.status === 404
          ? ['El RAG configurado no tiene /ai/code/generate desplegado. No se usa el fallback PageSchema porque genera landings rígidas.']
          : (err.errores || [err.message]),
        ...(err.status === 404 ? {} : (err.telemetria || {})),
      });
      if (err.status === 404) {
        throw new Error('El motor de código libre del RAG no está disponible (/ai/code/generate). Reiniciá o redeployá el RAG antes de generar landings con IA.');
      }
      throw err;
    }
    // crearLienzoBlanco → resolverItemsCatalogo/sincronizarItems esperan
    // `referencia_id`, no `id` (que es lo que manda el wizard del frontend).
    const itemsLanding = (Array.isArray(items) ? items : [])
      .filter(i => i && (i.tipo === 'producto' || i.tipo === 'combo') && Number(i.id) > 0)
      // El precio ancla es POR LANDING (landing_items.precio_ancla), no del
      // producto: el mismo producto puede tener un precio tachado distinto en
      // cada página, y no le toca el precio real a nadie. Es lo que ya hacen
      // los templates rígidos desde CatalogoPanel.
      .map(i => ({
        tipo: i.tipo,
        referencia_id: Number(i.id),
        precio_ancla: Number(i.precio_ancla) > 0 ? Number(i.precio_ancla) : null,
      }));
    const creada = await LandingSimpleService.crearLienzoBlanco(
      tienda_id,
      inquilino_id,
      tienda.nombre,
      itemsLanding,
      { creationSource: 'ai' },
    );
    const landingModel = await LandingSimpleService.buscarPropia(creada.id, tienda_id);
    const guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
      titulo,
      codigo,
      ...((Object.keys(vistasProductos).length || vistaProductoGeneral)
        ? { vistas: {
            ...(Object.keys(vistasProductos).length ? { productos: vistasProductos } : {}),
            ...(vistaProductoGeneral ? { producto: vistaProductoGeneral } : {}),
          } }
        : {}),
      // Si el wizard ya pasó por el panel de venta, se guarda lo que el
      // comercio eligió ahí. Si no vino nada, la landing queda SIN venta
      // configurada a propósito: el editor abre en "Configurar venta" en
      // vez de saltear ese paso con valores por defecto.
      ...(ventaLimpia ? { venta: ventaLimpia } : {}),
    });
    await AiGenerationLogService.registrar({
      tiendaId: tienda_id, landingId: guardada.id, operacion: 'generate', pageType: 'landing', target: 'inicio',
      prompt: instruccion, modelo, latenciaMs: Date.now() - inicio, tokensInput, tokensOutput,
      repairUsed, exitoso: true, validationErrorsPreRepair: erroresPreRepair,
    });
    return guardada;
  }

  /**
   * Vuelve a pedirle un ajuste al RAG con un prompt nuevo y lo aplica SOBRE
   * la landing que ya existe (misma fila, mismo id, mismo slug) — a
   * diferencia de crearDesdeIA, que siempre arranca una landing nueva. Así
   * el comercio puede seguir hablando con la IA ("hacela más minimalista",
   * "agregá una sección de testimonios") desde el editor completo, sin
   * perder la landing ni volver al asistente inicial.
   *
   * `target`: a CUÁL parte de la landing se le habla. Antes esto siempre
   * tocaba "Inicio" sin importar qué pidiera el comercio.
   *   - 'inicio' → content.codigo (el inicio de la tienda).
   *   - 'producto' → content.vistas.producto (la ficha general, la que usan
   *     todos los productos sin ficha propia).
   *   - 'producto_especifico' → content.vistas.productos[contentId] (la
   *     ficha PROPIA de un producto puntual — requiere `contentId`). Esto
   *     es lo que permite "este termo quiero una ficha outdoor premium" y
   *     "este auricular quiero que se vea tech futurista" sin que
   *     compartan diseño: cada ficha propia vive en su propia clave, y un
   *     producto sin ficha propia sigue cayendo en la ficha general.
   *
   * Reutiliza los productos ya cargados en la landing (los de "Configurar
   * venta"): la IA no vuelve a preguntar qué vender, solo cómo mostrarlo.
   */
  static async regenerarConIA({ tienda_id, inquilino_id, landing_id, prompt, target = 'inicio', contentId = null }) {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('Escribí una descripción de al menos 5 caracteres para que la IA modifique tu landing.');
    }
    const esFichaEspecifica = target === 'producto_especifico';
    const esFicha = target === 'producto' || esFichaEspecifica;
    if (esFichaEspecifica && !contentId) {
      throw new Error('Falta indicar de qué producto es la ficha.');
    }

    const tienda = await Tienda.findByPk(tienda_id);
    if (!tienda) throw new Error('Tienda no encontrada.');

    const landingModel = await LandingSimpleService.buscarPropia(landing_id, tienda_id);
    if (landingModel.template?.kind !== 'codigo') {
      throw new Error('Solo se puede regenerar con IA una landing de lienzo en blanco.');
    }

    const { LandingItem } = require('../models');
    const items = await LandingItem.findAll({ where: { landing_id: landingModel.id }, attributes: ['tipo', 'referencia_id'] });
    const catalogoRAG = await this.catalogoParaRAG(inquilino_id, items.map(i => i.toJSON()));
    // Acá la landing SÍ pasó por "Configurar venta": se respeta lo que el
    // comercio marcó (ventas cruzadas prendidas o apagadas, recomendados,
    // tipo de venta) además de las ofertas reales de sus productos.
    const comercio = this.contextoComercialParaRAG(landingModel.content?.venta, catalogoRAG);

    let productoContexto = null;
    if (esFichaEspecifica) {
      productoContexto = await this.resolverProductoPorContentId(inquilino_id, contentId);
      if (!productoContexto) throw new Error('No se encontró ese producto en esta landing.');
    }

    const actual = esFichaEspecifica
      ? landingModel.content?.vistas?.productos?.[contentId]
      : esFicha
        ? landingModel.content?.vistas?.producto
        : landingModel.content?.codigo;
    const instruccion = prompt.trim();
    const referenciaVisual = esFicha ? this.referenciaVisualInicio(landingModel) : '';
    const instruccionParaRAG = referenciaVisual
      ? `${instruccion}\n\n${referenciaVisual}`
      : instruccion;
    const pageType = esFicha ? 'product' : 'landing';

    const inicio = Date.now();
    let codigo;
    let titulo = landingModel.titulo;
    let repairUsed = false;
    let erroresPreRepair = [];
    let tokensInput = 0;
    let tokensOutput = 0;
    let modelo = null;
    const logBase = { tiendaId: tienda_id, landingId: landing_id, operacion: actual?.html?.trim() ? 'edit' : 'generate', pageType, target, contentId, prompt: instruccion };
    try {
      const resultado = await this._conRepairAutomatico({
        // Sin código previo en esta ficha puntual (primera vez), se genera
        // desde cero; si ya había algo, se edita conservando lo que no
        // haga falta cambiar.
        generar: () => (actual?.html?.trim()
          ? this.solicitarEdicionRAG({ instruction: instruccionParaRAG, current: actual, tienda, productos: catalogoRAG, pageType, producto: productoContexto, comercio })
          : this.solicitarCodigoRAG({ prompt: instruccionParaRAG, tienda, productos: catalogoRAG, pageType, producto: productoContexto, comercio })),
        anterior: actual,
        instruccion,
        vista: esFicha ? 'ficha' : 'inicio',
        tienda,
        productos: catalogoRAG,
        pageType,
        producto: productoContexto,
        comercio,
      });
      ({ codigo, repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo } = resultado);
      codigo.design_context = this.designContextDesdeCodigo(codigo, tienda);
    } catch (err) {
      await AiGenerationLogService.registrar({
        ...logBase, latenciaMs: Date.now() - inicio, exitoso: false,
        validationErrors: err.status === 404
          ? ['El RAG configurado no tiene /ai/code/edit o /ai/code/generate desplegado. No se usa el fallback PageSchema porque genera landings rígidas.']
          : (err.errores || [err.message]),
        ...(err.status === 404 ? {} : (err.telemetria || {})),
      });
      if (err.status === 404) {
        throw new Error('El motor de código libre del RAG no está disponible (/ai/code/edit o /ai/code/generate). Reiniciá o redeployá el RAG antes de editar landings con IA.');
      }
      throw err;
    }

    // Editar una ficha con IA también reinyecta los bloques canónicos: si no,
    // el primer "hacela más linda" se llevaba puesto el bump con su foto.
    if (esFicha || esFichaEspecifica) {
      Object.assign(codigo, aplicarBloquesCanonicos(codigo));
    }

    let guardada;
    if (esFichaEspecifica) {
      guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
        vistas: { productos: { [contentId]: codigo } },
      });
    } else if (esFicha) {
      guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
        vistas: { producto: codigo },
      });
    } else {
      guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
        titulo,
        codigo,
      });
    }
    await AiGenerationLogService.registrar({
      ...logBase, modelo, latenciaMs: Date.now() - inicio, tokensInput, tokensOutput,
      repairUsed, exitoso: true, validationErrorsPreRepair: erroresPreRepair,
    });
    return guardada;
  }
}

module.exports = AILandingService;
