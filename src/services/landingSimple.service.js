'use strict';

/**
 * Servicio de "Landing simple": el modo con 3 templates rígidos (Fitness/
 * Beauty/Tech) — comercio elige un template y solo edita contenido
 * (identidad básica, productos, contacto, FAQ), nunca estructura. Vive
 * aparte de LandingService (sistema flexible/constructor) a propósito:
 * mismas tablas de datos (Landing/LandingItem/Faq), pero un whitelist de
 * escritura totalmente distinto y más chico. Ver LandingSeccion, que este
 * servicio NUNCA toca.
 *
 * Reutiliza de LandingService: generación de slug, resolución/validación
 * de items de catálogo, sincronizarItems/sincronizarFaq (mismo patrón
 * destroy-all + bulkCreate) y el helper de subida de imagen por campo —
 * son utilidades genéricas sobre el mismo modelo Landing, no algo propio
 * del constructor flexible.
 */

const { Op } = require('sequelize');
const { Landing, LandingItem, Faq, LandingBeneficio, LandingTemplate, Testimonio, Producto } = require('../models');
const LandingService = require('./landing.service');
const LandingCodigoService = require('./landingCodigo.service');
const ImagenService = require('./imagen.service');
const PaginaFactory = require('../factories/PaginaFactory');

// Los dos modos que administra este servicio, ambos "una landing por
// tienda, el comercio no arma estructura":
//   - 'rigido' → uno de los 4 templates fijos (Fitness/Beauty/Tech/Básico).
//   - 'codigo' → lienzo en blanco, el HTML/CSS/JS lo escribe el comercio
//     (ver landingCodigo.service.js).
// Todo lo compartido (slug, es_home, publicar/despublicar, borrar) es
// idéntico en los dos; lo único que cambia es qué se puede editar.
const KINDS_EDITOR = ['rigido', 'codigo'];
const SLUG_LIENZO_BLANCO = 'lienzo-blanco';

// Claves que un intento de modificar la ESTRUCTURA de la landing usaría —
// se rechazan explícitamente (400), no se ignoran en silencio. Independiente
// del whitelist de campos editables: aunque ninguna de estas llegue a
// aplicarse igual (nunca están en camposEditablesSimple), acá se corta el
// request entero para que quede claro en la respuesta que fue rechazado.
const CLAVES_ESTRUCTURALES = [
  'sections', 'sectionOrder', 'sectionType', 'layout', 'columns', 'responsive',
  'structure', 'secciones', 'bloques', 'blocks', 'template_id', 'template_version', 'schema',
];

const MAX_BENEFICIOS = 6;

// Copy inicial de "Beneficios" y "Contenido adicional" por template — se
// siembra al crear() para que la landing se vea completa desde el primer
// momento (mismo texto que antes estaba hardcodeado en cada componente de
// React). De ahí en adelante es contenido editable como cualquier otro.
const DEFAULTS_POR_TEMPLATE = {
  'fitness-suplementos': {
    contenido_titulo: 'Nutrición pensada para tu objetivo',
    contenido_texto: 'Ya sea que busques ganar masa, definir o mejorar tu rendimiento, tenemos la combinación de suplementos justa para vos.',
    beneficios: [
      { titulo: 'Calidad certificada', texto: 'Fórmulas probadas, sin rellenos.', icono: 'shield' },
      { titulo: 'Envío rápido', texto: 'Recibilo en la puerta de tu casa.', icono: 'truck' },
      { titulo: 'Resultados reales', texto: 'Pensado para quien entrena en serio.', icono: 'flame' },
    ],
  },
  'beauty-skincare': {
    contenido_titulo: 'Rituales de belleza que se disfrutan',
    contenido_texto: 'Seleccionamos cada producto pensando en rutinas simples, efectivas y que te hagan sentir bien con vos misma.',
    beneficios: [
      { titulo: 'Ingredientes naturales', texto: 'Fórmulas suaves, libres de crueldad animal.', icono: 'leaf' },
      { titulo: 'Para cada tipo de piel', texto: 'Rutinas pensadas a tu medida.', icono: 'heart' },
      { titulo: 'Envío a domicilio', texto: 'Recibí tu pedido sin salir de casa.', icono: 'truck' },
    ],
  },
  'tech-electronica': {
    contenido_titulo: 'Innovación a un clic de distancia',
    contenido_texto: 'Seleccionamos los mejores gadgets y accesorios para que siempre estés a la vanguardia.',
    beneficios: [
      { titulo: 'Garantía oficial', texto: 'Productos originales, con respaldo.', icono: 'badge' },
      { titulo: 'Envío asegurado', texto: 'Seguimiento en tiempo real de tu pedido.', icono: 'truck' },
      { titulo: 'Última generación', texto: 'Lo nuevo en tecnología, siempre.', icono: 'zap' },
    ],
  },
  'basico': {
    contenido_titulo: 'Pensado para vos',
    contenido_texto: 'Seleccionamos cuidadosamente cada producto para que encuentres justo lo que necesitás, sin vueltas.',
    beneficios: [
      { titulo: 'Compra segura', texto: 'Pagos y datos siempre protegidos.', icono: 'shield' },
      { titulo: 'Envío a domicilio', texto: 'Recibilo donde estés.', icono: 'truck' },
      { titulo: 'Atención personalizada', texto: 'Te ayudamos en cada paso.', icono: 'headphones' },
    ],
  },
};

/**
 * Punto de partida del lienzo en blanco — deliberadamente mínimo: una
 * sección y tres reglas de CSS, lo justo para que el comercio vea de una
 * dónde escribe y cómo se refleja. No es un template: se puede borrar
 * entero sin romper nada.
 */
function codigoInicial(nombreTienda) {
  const nombre = (nombreTienda || 'Tu marca').trim();
  return {
    html: [
      '<section class="hero">',
      `  <h1>${nombre}</h1>`,
      '  <p>Escribí acá el HTML de tu landing. El CSS y el JavaScript van en las otras pestañas.</p>',
      '  <a class="cta" href="#productos-seleccionados">Ver productos</a>',
      '</section>',
    ].join('\n'),
    // Las variables --gc-* son el contrato con Gesicom: el carrito/checkout
    // y las secciones de contacto/footer que se agregan solas las leen para
    // pintarse con los colores de la landing (ver el prompt de generación
    // en LandingCodigoEditor.jsx del frontend).
    css: [
      ':root {',
      '  --gc-primario: #2563eb;',
      '  --gc-texto-sobre-primario: #ffffff;',
      '  --gc-fondo: #ffffff;',
      '  --gc-texto: #0f172a;',
      '}',
      'body { margin: 0; font-family: system-ui, sans-serif; background: var(--gc-fondo); color: var(--gc-texto); }',
      '.hero { min-height: 70vh; display: grid; place-content: center; gap: 16px; text-align: center; padding: 48px 24px; }',
      '.hero h1 { font-size: clamp(32px, 6vw, 64px); margin: 0; }',
      '.hero p { margin: 0; opacity: .7; max-width: 46ch; }',
      '.cta { justify-self: center; padding: 14px 28px; border-radius: 999px; background: var(--gc-primario); color: var(--gc-texto-sobre-primario); font-weight: 700; text-decoration: none; }',
    ].join('\n'),
    js: [
      '// Tu JavaScript corre aislado en un iframe: no ve la sesión de la',
      '// tienda ni puede llamar a servidores externos.',
      "document.querySelector('.cta')?.addEventListener('click', () => {",
      "  console.log('clic en el CTA');",
      '});',
    ].join('\n'),
  };
}

class LandingSimpleService {

  static rechazarClavesEstructurales(payload) {
    const encontradas = Object.keys(payload || {}).filter(k => CLAVES_ESTRUCTURALES.includes(k));
    if (encontradas.length) {
      throw new Error(`No se puede modificar la estructura de la landing (campos no permitidos: ${encontradas.join(', ')}).`);
    }
  }

  /**
   * Único whitelist de escritura de este módulo — nunca
   * Object.assign(landing, payload).
   *
   * @param {string} kind 'rigido' | 'codigo'. En el lienzo en blanco casi
   *   nada de esto aplica (no hay hero, ni beneficios, ni colores de tema:
   *   los pinta el CSS del comercio) y sobre todo NO se acepta `content`
   *   crudo — el código entra por la clave `codigo` de actualizar(), que
   *   es la que pasa por LandingCodigoService.
   */
  static camposEditables(payload, kind = 'rigido') {
    if (kind === 'codigo') {
      const campos = {};
      for (const campo of ['titulo', 'descripcion', 'seo_titulo', 'seo_descripcion']) {
        if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim() || null;
      }
      return campos;
    }
    const campos = {};
    // Identidad — "titulo" es el nombre público del comercio, reutilizado
    // tal cual como en el sistema flexible.
    for (const campo of ['titulo', 'descripcion']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Hero — reutiliza las columnas banner_* ya existentes en Landing.
    for (const campo of ['banner_titulo', 'banner_subtitulo', 'banner_boton_texto', 'banner_boton_link', 'banner_opacidad']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Contacto — propio de cada landing rígida, no compartido con Tienda.
    for (const campo of [
      // Datos de contacto reales (página de Contacto)
      'contacto_whatsapp', 'contacto_telefono', 'contacto_email',
      'contacto_direccion', 'contacto_ciudad', 'contacto_pais', 'contacto_horarios',
      // Redes sociales (pie de la landing)
      'contacto_instagram', 'contacto_facebook', 'contacto_tiktok', 'contacto_youtube', 'contacto_twitter',
    ]) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Contenido adicional (título + párrafo, sección fija antes de Contacto),
    // productos (título de "Productos destacados") y catálogo (subtítulo de
    // la página /catalogo completa).
    for (const campo of ['contenido_titulo', 'contenido_texto', 'productos_titulo', 'catalogo_titulo', 'catalogo_descripcion']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Colores — tema único para toda la landing (no por sección), reutiliza
    // las columnas color_primario/fondo/texto ya existentes en Landing.
    // La validación de formato hexadecimal ya la hace
    // LandingService.validarPayload (ver actualizar() acá abajo).
    for (const campo of ['color_primario', 'color_fondo', 'color_texto', 'content']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo] || null;
    }
    return campos;
  }

  /** Mismo patrón que sincronizarItems/sincronizarFaq: reemplazo total. */
  static async sincronizarBeneficios(landing_id, beneficios = []) {
    await LandingBeneficio.destroy({ where: { landing_id } });
    if (!beneficios.length) return;
    await LandingBeneficio.bulkCreate(beneficios.map((b, idx) => ({
      landing_id,
      titulo: b.titulo.trim(),
      texto: b.texto.trim(),
      icono: b.icono || null,
      orden: b.orden !== undefined ? Number(b.orden) : idx,
    })));
  }

  static validarBeneficios(beneficios) {
    const errores = [];
    if (!Array.isArray(beneficios)) return errores;
    if (beneficios.length > MAX_BENEFICIOS) {
      errores.push(`No se pueden agregar más de ${MAX_BENEFICIOS} beneficios.`);
    }
    beneficios.forEach((b, idx) => {
      if (!b?.titulo?.trim()) errores.push(`Beneficio #${idx + 1}: el título es obligatorio.`);
      if (!b?.texto?.trim()) errores.push(`Beneficio #${idx + 1}: el texto es obligatorio.`);
    });
    return errores;
  }

  static async obtenerTemplateRigido(template_id) {
    const template = await LandingTemplate.findOne({ where: { id: template_id, kind: 'rigido', status: 'published' } });
    if (!template) throw new Error('Template no encontrado.');
    return template;
  }

  /** El template del lienzo en blanco es único y global (lo siembra
   * scripts/seed-landing-lienzo-blanco.js) — no se elige de una grilla,
   * así que se resuelve por slug y no por id. */
  static async obtenerTemplateLienzoBlanco() {
    const template = await LandingTemplate.findOne({ where: { slug: SLUG_LIENZO_BLANCO, kind: 'codigo' } });
    if (!template) {
      throw new Error('El lienzo en blanco todavía no está disponible. Ejecutá scripts/seed-landing-lienzo-blanco.js.');
    }
    return template;
  }

  /**
   * Todas las lecturas/escrituras de acá exigen kind 'rigido' o 'codigo'
   * en el join con el template — defensa en profundidad: aunque la tabla
   * "landings" sea compartida con el sistema flexible, esta clase nunca
   * puede tocar una fila que no haya nacido de uno de esos dos modos.
   */
  static async buscarPropia(id, tienda_id) {
    const landing = await Landing.findOne({
      where: { id, tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: { [Op.in]: KINDS_EDITOR } } }],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    return landing;
  }

  static async listar(tienda_id) {
    const landings = await Landing.findAll({
      where: { tienda_id },
      include: [
        { model: LandingTemplate, as: 'template', required: true, where: { kind: { [Op.in]: KINDS_EDITOR } } },
        { model: LandingItem, as: 'items', attributes: ['id'] },
      ],
      order: [['created_at', 'DESC']],
    });
    return landings.map(l => l.toJSON());
  }

  /**
   * Parte común de crear() y crearLienzoBlanco(): la landing de este
   * módulo ES la landing principal de la tienda — se sirve en la raíz del
   * subdominio (https://sub.gesicomm.com/), no en /l/:slug (ver
   * resolverTienda.js / LandingService.obtenerPublica: es_home=true es lo
   * que resuelve GET /api/l/ sin slug). es_home es única por tienda a
   * nivel aplicación (sin constraint de DB) — se desactiva cualquier otra
   * landing que la tuviera antes de crear esta.
   */
  static async _crearFila(tienda_id, inquilino_id, template, extra = {}) {
    await this._eliminarLandingsEditorDeTienda(tienda_id);
    const slug = await LandingService.generarSlugUnico(template.name, tienda_id);
    await Landing.update({ es_home: false }, { where: { tienda_id, es_home: true } });
    return PaginaFactory.crearInicio({
      inquilino_id,
      tienda_id,
      template_id: template.id,
      nombre: template.name,
      titulo: template.name,
      slug,
      activo: false,
      ...extra,
    });
  }

  static async crear(tienda_id, inquilino_id, template_id) {
    const template = await this.obtenerTemplateRigido(template_id);
    const defaults = DEFAULTS_POR_TEMPLATE[template.slug];

    const landing = await this._crearFila(tienda_id, inquilino_id, template, {
      // FAQ y Hero(banner) son secciones fijas en los 4 templates rígidos
      // (no un toggle opcional como en el sistema flexible) — se activan
      // siempre al crear, así obtenerPublica() nunca las omite.
      mostrar_faq: true,
      mostrar_banner: true,
      contenido_titulo: defaults?.contenido_titulo || null,
      contenido_texto: defaults?.contenido_texto || null,
    });

    if (defaults?.beneficios?.length) {
      await this.sincronizarBeneficios(landing.id, defaults.beneficios);
    }

    return this.obtener(landing.id, tienda_id);
  }

  static async crearDesdeOnboarding(tienda_id, inquilino_id, template_slug, items = []) {
    const template = await LandingTemplate.findOne({
      where: { slug: template_slug, kind: 'rigido', status: 'published' },
    });
    if (!template) throw new Error('Template no encontrado.');
    if (!Array.isArray(items) || !items.length) {
      throw new Error('Seleccioná al menos un producto para generar la landing.');
    }

    await LandingService.resolverItemsCatalogo(items, inquilino_id);

    const landing = await this.crear(tienda_id, inquilino_id, template.id);
    await LandingService.sincronizarItems(landing.id, items.map((item, idx) => ({
      tipo: item.tipo,
      referencia_id: item.referencia_id,
      etiqueta: item.etiqueta || '',
      orden: item.orden !== undefined ? item.orden : idx,
      precio_ancla: item.precio_ancla || null,
      envio_incluido: item.envio_incluido === true,
      mostrar_en_inicio: item.mostrar_en_inicio !== false,
    })));
    return this.obtener(landing.id, tienda_id);
  }

  /**
   * Lienzo en blanco: misma fila Landing que el modo rígido (mismo slug,
   * mismo es_home, mismo publicar/despublicar), pero sin nada de la
   * estructura fija — ni banner, ni FAQ, ni beneficios, ni items. Todo lo
   * que se ve sale de content.codigo, que el comercio escribe a mano.
   */
  static async crearLienzoBlanco(tienda_id, inquilino_id, nombreTienda, items = []) {
    const template = await this.obtenerTemplateLienzoBlanco();
    if (Array.isArray(items) && items.length) {
      await LandingService.resolverItemsCatalogo(items, inquilino_id);
    }
    const landing = await this._crearFila(tienda_id, inquilino_id, template, {
      titulo: nombreTienda || template.name,
      mostrar_faq: false,
      mostrar_banner: false,
      content: { codigo: codigoInicial(nombreTienda) },
    });
    if (Array.isArray(items) && items.length) {
      await LandingService.sincronizarItems(landing.id, items.map((item, idx) => ({
        tipo: item.tipo,
        referencia_id: item.referencia_id,
        etiqueta: item.etiqueta || '',
        orden: item.orden !== undefined ? item.orden : idx,
        precio_ancla: item.precio_ancla || null,
        envio_incluido: item.envio_incluido === true,
        mostrar_en_inicio: item.mostrar_en_inicio !== false,
      })));
    }
    return this.obtener(landing.id, tienda_id);
  }

  static async obtener(id, tienda_id) {
    const landing = await Landing.findOne({
      where: { id, tienda_id },
      include: [
        { model: LandingTemplate, as: 'template', required: true, where: { kind: { [Op.in]: KINDS_EDITOR } } },
        { model: LandingItem, as: 'items' },
        { model: Faq, as: 'faq' },
        { model: LandingBeneficio, as: 'beneficios' },
      ],
      order: [
        [{ model: LandingItem, as: 'items' }, 'orden', 'ASC'],
        [{ model: Faq, as: 'faq' }, 'orden', 'ASC'],
        [{ model: LandingBeneficio, as: 'beneficios' }, 'orden', 'ASC'],
      ],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    return landing.toJSON();
  }

  /**
   * Guardado del lienzo en blanco. La estructura visual sigue siendo
   * exactamente lo que el comercio escribió, pero los items seleccionados
   * sí se sincronizan como catálogo curado de la landing para que la capa
   * pública pueda mostrar productos y abrir el checkout real.
   *
   * Las advertencias ("te saqué los <script> del HTML") viajan en el DTO
   * como `codigo_advertencias`; no se guardan, son del guardado que las
   * generó.
   */
  /**
   * Configuración de "Configurar venta" (paso 1 del lienzo en blanco).
   * Se guarda una copia normalizada: solo claves conocidas, tipos
   * esperados y listas acotadas, porque vuelve tal cual en la landing
   * pública y la lee el runtime del iframe.
   */
  static normalizarVenta(venta) {
    if (!venta || typeof venta !== 'object') return null;
    const texto = (v, max = 80) => String(v ?? '').trim().slice(0, max);
    const ids = (lista, max = 200) => (Array.isArray(lista) ? lista : [])
      .map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, max);
    const claves = (lista, max = 200) => (Array.isArray(lista) ? lista : [])
      .map(v => texto(v, 120)).filter(Boolean).slice(0, max);
    const TIPOS = ['catalogo', 'producto_unico', 'combos'];
    const SELECCIONES = ['manual', 'todos', 'categoria'];
    const reco = venta.recomendados && typeof venta.recomendados === 'object' ? venta.recomendados : {};
    return {
      configurado: venta.configurado === true,
      tipo: TIPOS.includes(venta.tipo) ? venta.tipo : 'catalogo',
      seleccion: SELECCIONES.includes(venta.seleccion) ? venta.seleccion : 'manual',
      categorias: claves(venta.categorias, 50),
      incluir_combos: venta.incluir_combos !== false,
      cross_sell: {
        activo: venta.cross_sell?.activo !== false,
        ofertas: ids(venta.cross_sell?.ofertas),
      },
      recomendados: {
        ...Object.fromEntries(Object.entries(reco)
          .filter(([k, v]) => ['activo', 'modo', 'max', 'titulo'].includes(k) && ['string', 'number', 'boolean'].includes(typeof v))
          .map(([k, v]) => [k, typeof v === 'string' ? texto(v, 120) : v])),
        // Ids de recomendados tal cual los arma el panel (número o clave).
        items: (Array.isArray(reco.items) ? reco.items : [])
          .filter(v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 120))
          .slice(0, 50),
      },
    };
  }

  static async actualizarCodigo(landing, tienda_id, inquilino_id, payload) {
    let advertencias = [];
    if (payload.items !== undefined) {
      // El lienzo admite listas mucho más largas que un template (ver
      // MAX_ITEMS_LIENZO); con "todos"/"por categoría" ni siquiera hay lista.
      const errores = Array.isArray(payload.items) && payload.items.length > LandingService.MAX_ITEMS_LIENZO
        ? [`Una lista elegida a mano admite hasta ${LandingService.MAX_ITEMS_LIENZO} productos. Para vender todo el catálogo usá "Todos" o "Por categoría".`]
        : [];
      if (errores.length) {
        const err = new Error('Validación fallida.');
        err.errores = errores;
        throw err;
      }
      await LandingService.resolverItemsCatalogo(payload.items, inquilino_id);
    }
    // Cada vista se sanea por separado y ANTES de tocar content: si la de
    // producto no pasa, no se guarda a medias la de inicio.
    const limpioInicio = payload.codigo !== undefined ? LandingCodigoService.sanitizar(payload.codigo) : null;
    const limpioProducto = payload.vistas?.producto !== undefined
      ? this.sanitizarVista(payload.vistas.producto, 'Vista de producto')
      : null;
    const content = { ...(landing.content || {}) };
    if (limpioInicio) {
      advertencias = limpioInicio.advertencias;
      content.codigo = { html: limpioInicio.html, css: limpioInicio.css, js: limpioInicio.js };
    }
    if (limpioProducto) {
      advertencias = [...advertencias, ...limpioProducto.advertencias.map(a => `Vista de producto: ${a}`)];
      content.vistas = {
        ...(content.vistas || {}),
        producto: { html: limpioProducto.html, css: limpioProducto.css, js: limpioProducto.js },
      };
    }
    if (payload.venta !== undefined) {
      content.venta = LandingCodigoService.limpiarVenta(payload.venta);
    }
    if (limpioInicio || limpioProducto || payload.venta !== undefined) {
      landing.content = content;
      landing.changed('content', true);
    }
    // Ficha de producto del lienzo: una sola plantilla que el runtime llena
    // con el producto de la URL. Pasa por el mismo sanitizador que el inicio.
    if (payload.vistas?.producto !== undefined) {
      const limpioFicha = LandingCodigoService.sanitizar(payload.vistas.producto || {});
      advertencias = [...advertencias, ...limpioFicha.advertencias.map(a => `Ficha de producto: ${a}`)];
      landing.content = {
        ...(landing.content || {}),
        vistas: { ...(landing.content?.vistas || {}), producto: { html: limpioFicha.html, css: limpioFicha.css, js: limpioFicha.js } },
      };
      landing.changed('content', true);
    }
    if (payload.venta !== undefined) {
      landing.content = { ...(landing.content || {}), venta: this.normalizarVenta(payload.venta) };
      landing.changed('content', true);
    }
    Object.assign(landing, this.camposEditables(payload, 'codigo'));
    await landing.save();
    if (payload.items !== undefined) {
      await LandingService.sincronizarItems(landing.id, payload.items);
    }
    const dto = await this.obtener(landing.id, tienda_id);
    return { ...dto, codigo_advertencias: advertencias };
  }

  /** sanitizar() con el nombre de la vista en cada error, para que el editor diga en cuál está. */
  static sanitizarVista(codigo, nombre) {
    try {
      return LandingCodigoService.sanitizar(codigo);
    } catch (err) {
      if (Array.isArray(err.errores)) err.errores = err.errores.map(e => `${nombre}: ${e}`);
      throw err;
    }
  }

  static async actualizar(id, tienda_id, inquilino_id, payload) {
    this.rechazarClavesEstructurales(payload);

    const landing = await this.buscarPropia(id, tienda_id);

    if (landing.template?.kind === 'codigo') {
      return this.actualizarCodigo(landing, tienda_id, inquilino_id, payload);
    }
    if (payload.codigo !== undefined || payload.vistas !== undefined || payload.venta !== undefined) {
      const err = new Error('Validación fallida.');
      err.errores = ['Esta landing usa un template: el código a mano solo existe en el lienzo en blanco.'];
      throw err;
    }

    const errores = [
      ...LandingService.validarPayload(payload),
      ...this.validarBeneficios(payload.beneficios),
    ];
    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    if (payload.items !== undefined) {
      await LandingService.resolverItemsCatalogo(payload.items, inquilino_id);
    }

    Object.assign(landing, this.camposEditables(payload));
    await landing.save();

    if (payload.items !== undefined) {
      await LandingService.sincronizarItems(landing.id, payload.items);
    }
    if (payload.faq !== undefined) {
      await LandingService.sincronizarFaq(landing.id, payload.faq);
    }
    if (payload.beneficios !== undefined) {
      await this.sincronizarBeneficios(landing.id, payload.beneficios);
    }

    return this.obtener(landing.id, tienda_id);
  }

  static async cambiarEstado(id, tienda_id, activo) {
    const landing = await this.buscarPropia(id, tienda_id);

    if (activo && landing.tipo_pagina === 'funnel') {
      if (!landing.producto_id) throw new Error('No se puede publicar un funnel sin producto.');
      const producto = await Producto.findByPk(landing.producto_id, { attributes: ['cantidad_disponible'] });
      if (producto && Number(producto.cantidad_disponible) <= 0) {
        throw new Error('No se puede publicar: el producto no tiene stock disponible.');
      }
    } else if (activo && landing.tipo_pagina !== 'contacto') {
      const items = await LandingItem.findAll({ where: { landing_id: landing.id }, attributes: ['tipo', 'referencia_id'] });
      // Si TODOS los productos (no combos, que tienen su propio cálculo de
      // stock) están sin stock, se bloquea. Si hay al menos un producto con
      // stock, o hay algún combo en el medio, se deja publicar: no vale la
      // pena bloquear un catálogo grande por un ítem agotado suelto.
      const idsProducto = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
      const tieneCombo = items.some(i => i.tipo === 'combo');
      if (idsProducto.length && !tieneCombo) {
        const productos = await Producto.findAll({ where: { id: idsProducto }, attributes: ['cantidad_disponible'] });
        const hayStock = productos.some(p => Number(p.cantidad_disponible) > 0);
        if (!hayStock) throw new Error('No se puede publicar: ninguno de los productos incluidos tiene stock disponible.');
      }
    }

    landing.activo = !!activo;
    await landing.save();
    return landing.toJSON();
  }

  /**
   * Borra la landing y, si era la principal del sitio, se lleva también sus
   * páginas satélite. Catálogo y Contacto no existen por sí solas: las crea
   * LandingService.asegurarPaginasFijas junto a la home y solo se sirven
   * como parte de ese mismo sitio. Al borrar únicamente la home quedaban
   * colgadas, apuntando a una tienda que ya no tiene página principal — y
   * como `listar()` de LandingService devuelve todas, después reaparecían
   * como si el comercio todavía tuviera una landing.
   *
   * Los funnels (tipo_pagina 'funnel') NO se tocan: son páginas de producto
   * con vida propia, no satélites de la home.
   */
  /**
   * Borra de R2 (o disco legacy) banner/seo/logo de la landing y las fotos
   * de sus testimonios — la fila se borra sola en cascada (FK), esto no.
   */
  static async _limpiarImagenesLanding(landing) {
    for (const campo of ['banner_imagen', 'seo_og_imagen', 'logo_imagen']) {
      if (landing[campo]) {
        await ImagenService.eliminarObjetoStorage({ url: landing[campo], storage_key: landing[`${campo}_storage_key`] });
      }
    }
    const testimonios = await Testimonio.findAll({ where: { landing_id: landing.id }, attributes: ['foto'] });
    for (const foto of new Set(testimonios.map(t => t.foto).filter(Boolean))) {
      await ImagenService.eliminarObjetoStorage({ url: foto });
    }
  }

  /**
   * Este módulo funciona como "una landing editable por tienda". Antes se
   * podían acumular filas rigido/codigo viejas; entonces al borrar la landing
   * actual, /landing encontraba otra fila residual y abría su template en vez
   * de volver al selector.
   */
  static async _eliminarLandingsEditorDeTienda(tienda_id) {
    const landings = await Landing.findAll({
      where: { tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: { [Op.in]: KINDS_EDITOR } } }],
    });
    if (!landings.length) return 0;

    for (const landing of landings) {
      await this._limpiarImagenesLanding(landing);
    }

    const ids = landings.map(l => l.id);
    await Landing.destroy({ where: { id: { [Op.in]: ids }, tienda_id } });
    return ids.length;
  }

  static async eliminar(id, tienda_id) {
    await this.buscarPropia(id, tienda_id);
    await this._eliminarLandingsEditorDeTienda(tienda_id);
    return true;
  }

  /**
   * @returns {{landing: object, anterior: {url: string, storage_key: string|null}|null}}
   * anterior = imagen vieja, para que el controller borre ese objeto de R2
   * (o el archivo legacy en disco) (mismo contrato que
   * LandingService._actualizarImagenCampo, sin reusarlo directamente: acá
   * el DTO de retorno debe ser el de landingSimple, con template incluido
   * y sin secciones/testimonios del sistema flexible). `imagenData` es el
   * objeto de ImagenService.procesarArchivoParaR2 o null para quitar.
   */
  static async _actualizarImagenCampo(id, tienda_id, campo, imagenData) {
    const landing = await this.buscarPropia(id, tienda_id);
    const claveStorage = `${campo}_storage_key`;
    const anteriorUrl = landing[campo];
    const anterior = anteriorUrl ? { url: anteriorUrl, storage_key: landing[claveStorage] } : null;

    landing[campo] = imagenData ? imagenData.url : null;
    landing[claveStorage] = imagenData ? imagenData.storage_key : null;
    landing[`${campo}_mime_type`] = imagenData ? imagenData.mime_type : null;
    landing[`${campo}_size`] = imagenData ? imagenData.size : null;
    landing[`${campo}_width`] = imagenData ? imagenData.width : null;
    landing[`${campo}_height`] = imagenData ? imagenData.height : null;
    await landing.save();
    return { landing: await this.obtener(id, tienda_id), anterior };
  }

  static actualizarImagenLogo(id, tienda_id, imagenData) {
    return this._actualizarImagenCampo(id, tienda_id, 'logo_imagen', imagenData);
  }

  static quitarImagenLogo(id, tienda_id) {
    return this._actualizarImagenCampo(id, tienda_id, 'logo_imagen', null);
  }

  static actualizarImagenHero(id, tienda_id, imagenData) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', imagenData);
  }

  static quitarImagenHero(id, tienda_id) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', null);
  }
}

module.exports = LandingSimpleService;
