'use strict';

/**
 * Servicio de Landings públicas — pertenecen a una Tienda (no a un
 * usuario directamente: Tienda es 1:1 con Usuario, pero el tema, contacto
 * y pixel viven en Tienda, compartidos por todas sus landings).
 *
 * CRUD privado (verificarToken + gestionar_landing, scopeado por
 * tienda_id) y resolución pública (obtenerPublica, sin auth, recibe la
 * tienda ya resuelta por middleware/resolverTienda) viven acá porque
 * comparten el mismo modelo de datos y las mismas reglas de qué es "un
 * item válido de catálogo".
 *
 * El backend nunca confía en precios/costos enviados por el cliente —
 * solo acepta tipo+referencia_id y los resuelve contra el catálogo real,
 * igual que combo.service.js.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const slugify = require('slugify');
const {
  Landing, LandingItem, Producto, ProductoCombo, ProductoComboItem, Marca, PrecioUsuario,
  ProductoImagen, ProductoVariante, ProductoFaq, LandingSeccion, LandingEvento, Testimonio, Faq, LandingBeneficio, Envio, EnvioItem,
  Oferta, OfertaComponente, Tienda, LandingTemplate, sequelize
} = require('../models');
const { resolverRangoFechas } = require('../utils/rangoFechas');
const { registrarHistorial } = require('../utils/historial');
const PricingService = require('./pricing.service');

const MAX_ITEMS_POR_LANDING = 40;
const MAX_TESTIMONIOS_POR_LANDING = 20;
const MAX_FAQ_POR_LANDING = 20;
const MAX_SECCIONES_POR_LANDING = 30;
const MAX_ITEMS_CHECKOUT = 40;
// MVP: una sola landing por tienda, siempre en la raíz (es_home=true) — no
// hay UI para elegir slug ni marcar "página principal", así que una
// segunda landing quedaría inaccesible igual. Multi-landing por tienda
// queda para si el negocio lo pide más adelante; multi-TIENDA por cliente
// es el eje que sí está planeado (ver Tienda.js).
const MAX_LANDINGS_POR_TIENDA = 1;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TIPOS_SECCION = new Set([
  'header',
  'announcement_bar',
  'hero',
  'beneficios',
  'categorias',
  'destacados',
  'productos',
  'banner',
  'texto',
  'rich_text',
  'como_funciona',
  'faq',
  'testimonios',
  'redes_sociales',
  'footer',
  'product_detail',
  'cta',
  'image_text',
  'logo_list',
  'before_after',
  'scrolling_text',
  'producto_galeria',
]);

class LandingService {

  // ─── Slug ───────────────────────────────────────────────────────────────

  /**
   * A diferencia de ProductoService.generarSlugUnico (sufijo numérico
   * secuencial -2, -3...), acá el sufijo es aleatorio y se aplica siempre,
   * no solo en colisión: un sufijo secuencial en una URL pública filtra
   * cuántas landings similares existen y vuelve los slugs enumerables.
   * Unicidad POR TIENDA (no global): el hostname ya aísla una tienda de
   * otra, así que dos tiendas distintas pueden compartir slug sin chocar.
   */
  static async generarSlugUnico(nombre, tienda_id) {
    const base = slugify(nombre, { lower: true, strict: true }) || 'landing';
    let slug;
    do {
      slug = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    } while (await Landing.findOne({ where: { slug, tienda_id } }));
    return slug;
  }

  static async asegurarSlugDisponible(slugPropuesto, tienda_id, excluirId = null) {
    const limpio = slugify(slugPropuesto, { lower: true, strict: true });
    if (!limpio) throw new Error('El slug propuesto no es válido.');
    const where = { slug: limpio, tienda_id };
    if (excluirId) where.id = { [Op.ne]: excluirId };
    const existe = await Landing.findOne({ where });
    if (existe) throw new Error('Ese slug ya está en uso en tu tienda. Probá con otro.');
    return limpio;
  }

  // ─── Validación ─────────────────────────────────────────────────────────

  /**
   * El link del botón del banner se renderiza tal cual como href en la
   * landing pública — sin auth, visible a cualquiera. Un esquema como
   * "javascript:" o "data:" ahí es XSS ejecutable con solo compartir el
   * link. Solo se acepta http(s) o una ruta relativa dentro de la misma
   * tienda.
   */
  static linkBannerEsSeguro(link) {
    if (!link) return true;
    const limpio = String(link).trim();
    // "#ancla" (scroll a una sección de la misma página, ej. el CTA del
    // hero apuntando a "#productos" en los templates rígidos) no es una
    // URL ejecutable — mismo criterio de seguridad que "/", solo que sin
    // navegar.
    return /^https?:\/\//i.test(limpio) || limpio.startsWith('/') || limpio.startsWith('#');
  }

  static validarPayload(payload) {
    const errores = [];
    if (Array.isArray(payload.items) && payload.items.length > MAX_ITEMS_POR_LANDING) {
      errores.push(`No se pueden agregar más de ${MAX_ITEMS_POR_LANDING} items a una landing.`);
    }
    if (Array.isArray(payload.testimonios)) {
      if (payload.testimonios.length > MAX_TESTIMONIOS_POR_LANDING) {
        errores.push(`No se pueden agregar más de ${MAX_TESTIMONIOS_POR_LANDING} testimonios a una landing.`);
      }
      payload.testimonios.forEach((tItem, idx) => {
        if (!tItem?.nombre?.trim()) errores.push(`Testimonio #${idx + 1}: el nombre es obligatorio.`);
        if (!tItem?.comentario?.trim()) errores.push(`Testimonio #${idx + 1}: el comentario es obligatorio.`);
        const calificacion = Number(tItem?.calificacion);
        if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
          errores.push(`Testimonio #${idx + 1}: la calificación debe ser un número entero de 1 a 5.`);
        }
      });
    }
    if (Array.isArray(payload.faq)) {
      if (payload.faq.length > MAX_FAQ_POR_LANDING) {
        errores.push(`No se pueden agregar más de ${MAX_FAQ_POR_LANDING} preguntas frecuentes a una landing.`);
      }
      payload.faq.forEach((fItem, idx) => {
        if (!fItem?.pregunta?.trim()) errores.push(`FAQ #${idx + 1}: la pregunta es obligatoria.`);
        if (!fItem?.respuesta?.trim()) errores.push(`FAQ #${idx + 1}: la respuesta es obligatoria.`);
      });
    }
    if (Array.isArray(payload.secciones)) {
      if (payload.secciones.length > MAX_SECCIONES_POR_LANDING) {
        errores.push(`No se pueden agregar mas de ${MAX_SECCIONES_POR_LANDING} secciones a una landing.`);
      }
      payload.secciones.forEach((seccion, idx) => {
        if (!TIPOS_SECCION.has(seccion?.tipo)) {
          errores.push(`Seccion #${idx + 1}: el tipo no es valido.`);
        }
        const config = seccion?.config_json ?? seccion?.config ?? {};
        const contenido = seccion?.contenido_json ?? seccion?.contenido ?? {};
        if (config === null || typeof config !== 'object' || Array.isArray(config)) {
          errores.push(`Seccion #${idx + 1}: la configuracion debe ser un objeto.`);
        }
        if (contenido === null || typeof contenido !== 'object' || Array.isArray(contenido)) {
          errores.push(`Seccion #${idx + 1}: el contenido debe ser un objeto.`);
        }
        for (const link of [contenido.boton_link, contenido.link].filter(Boolean)) {
          if (!this.linkBannerEsSeguro(link)) {
            errores.push(`Seccion #${idx + 1}: el link debe empezar con http://, https:// o /.`);
          }
        }
        if (Array.isArray(contenido.links)) {
          contenido.links.forEach((l, linkIdx) => {
            const href = l?.href;
            if (href && !this.linkBannerEsSeguro(href) && !String(href).startsWith('#')) {
              errores.push(`Seccion #${idx + 1}, link #${linkIdx + 1}: el href no es seguro.`);
            }
          });
        }
      });
    }
    if (payload.banner_boton_link !== undefined && !this.linkBannerEsSeguro(payload.banner_boton_link)) {
      errores.push('El link del botón del banner debe empezar con http://, https:// o /.');
    }
    const NOMBRES_COLOR = {
      color_primario: 'El color principal',
      color_fondo: 'El color de fondo',
      color_texto: 'El color de texto',
      color_tarjeta: 'El color de las tarjetas',
    };
    for (const campo of Object.keys(NOMBRES_COLOR)) {
      const valor = payload[campo];
      if (valor !== undefined && valor !== null && valor !== '' && !HEX_COLOR_RE.test(valor)) {
        errores.push(`${NOMBRES_COLOR[campo]} debe ser un color hexadecimal válido (#rrggbb).`);
      }
    }
    return errores;
  }

  static normalizarEtiqueta(etiqueta) {
    if (!etiqueta) return null;
    const limpio = String(etiqueta).trim().replace(/\s+/g, ' ');
    return limpio || null;
  }

  // calcularPrecioBase/calcularPrecioVariante vivían acá — se movieron a
  // PricingService (src/services/pricing.service.js), el Pricing Engine
  // centralizado que ahora también consumen el endpoint de recálculo de
  // carrito y el simulador de precio del admin. obtenerPublica() (lo que
  // VE el visitante) y crearCheckout() (lo que efectivamente se cobra)
  // siguen usando exactamente la misma fórmula entre sí — solo que ahora
  // vive en un solo lugar en vez de duplicada.

  /** Valida que cada item exista, esté activo y pertenezca al mismo inquilino. */
  static async resolverItemsCatalogo(items, inquilino_id) {
    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => Number(i.referencia_id));
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => Number(i.referencia_id));

    const [productos, combos] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({ where: { id: { [Op.in]: idsProducto }, inquilino_id, activo: true }, attributes: ['id'] })
        : Promise.resolve([]),
      // Igual que listarCatalogo y obtenerPublica: el combo solo es válido si
      // su producto padre está activo. Sin este chequeo se podía guardar un
      // combo que luego nunca aparecería en la landing pública.
      idsCombo.length
        ? ProductoCombo.findAll({
          where: { id: { [Op.in]: idsCombo }, inquilino_id, estado: 'ACTIVO' },
          attributes: ['id'],
          include: [{
            model: Producto,
            as: 'producto_padre',
            attributes: ['id'],
            where: { activo: true },
            required: true,
          }],
        })
        : Promise.resolve([]),
    ]);

    const setProducto = new Set(productos.map(p => p.id));
    const setCombo = new Set(combos.map(c => c.id));

    for (const item of items) {
      const id = Number(item.referencia_id);
      const existe = item.tipo === 'producto' ? setProducto.has(id) : setCombo.has(id);
      if (!existe) {
        throw new Error(`El ${item.tipo} #${item.referencia_id} no existe, no está activo o no pertenece a tu catálogo.`);
      }
    }
  }

  static async sincronizarItems(landing_id, items = []) {
    await LandingItem.destroy({ where: { landing_id } });
    if (!items.length) return;
    await LandingItem.bulkCreate(items.map((item, idx) => ({
      landing_id,
      tipo: item.tipo,
      referencia_id: Number(item.referencia_id),
      etiqueta: this.normalizarEtiqueta(item.etiqueta),
      precio_ancla: item.precio_ancla != null ? Number(item.precio_ancla) : null,
      orden: item.orden !== undefined ? Number(item.orden) : idx,
      mostrar_en_inicio: item.mostrar_en_inicio !== false,
    })));
  }

  /**
   * Reemplazo total, mismo criterio que sincronizarItems: los testimonios
   * no tienen id estable entre guardados (destroy-all + bulkCreate), así
   * que la foto se sube aparte (ver LandingService.subirFotoTestimonio) y
   * viaja como URL de texto dentro del payload, igual que "etiqueta" en
   * los items.
   */
  static async sincronizarTestimonios(landing_id, testimonios = []) {
    await Testimonio.destroy({ where: { landing_id } });
    if (!testimonios.length) return;
    await Testimonio.bulkCreate(testimonios.map((t, idx) => ({
      landing_id,
      nombre: t.nombre.trim(),
      foto: t.foto || null,
      calificacion: Number(t.calificacion),
      comentario: t.comentario.trim(),
      orden: t.orden !== undefined ? Number(t.orden) : idx,
    })));
  }

  static async sincronizarFaq(landing_id, faq = []) {
    await Faq.destroy({ where: { landing_id } });
    if (!faq.length) return;
    await Faq.bulkCreate(faq.map((f, idx) => ({
      landing_id,
      pregunta: f.pregunta.trim(),
      respuesta: f.respuesta.trim(),
      orden: f.orden !== undefined ? Number(f.orden) : idx,
    })));
  }

  static normalizarSeccion(seccion, idx) {
    return {
      tipo: seccion.tipo,
      // Si no viene stable_id se genera acá — nunca se deja en null. Las
      // secciones "base" (getSeccionesBase()/getSeccionesCatalogo()/etc,
      // en el frontend) no traen una hasta el primer Guardar, y sin esto
      // sincronizarSecciones()/guardarSeccionesProducto() no tienen forma
      // de reconocerlas en el SIGUIENTE guardado — las tratan como nuevas
      // y las duplican cada vez (bug real detectado: filas de header/hero/
      // footer repetidas 3-4 veces en una misma landing tras varios
      // guardados). Acá se cierra en la raíz, para ambos callers.
      stable_id: seccion.stable_id || crypto.randomBytes(6).toString('hex'),
      page_type: seccion.page_type || 'landing',
      // NULL = plantilla "Vista de Producto" compartida (comportamiento de
      // siempre). Con valor = diseño exclusivo de ESE producto — ver
      // obtenerProductoPublico(). Solo tiene sentido junto a page_type
      // 'product'; en 'landing' siempre viaja null.
      producto_id: seccion.producto_id ? Number(seccion.producto_id) : null,
      template_id: seccion.template_id || seccion.template || null,
      schema_version: seccion.schema_version || 1,
      nombre_interno: seccion.nombre_interno?.trim ? (seccion.nombre_interno.trim() || null) : null,
      activo: seccion.activo !== false,
      orden: seccion.orden !== undefined ? Number(seccion.orden) : idx,
      content_json: seccion.content_json ?? seccion.contenido_json ?? seccion.contenido ?? {},
      settings_json: seccion.settings_json ?? seccion.config_json ?? seccion.config ?? {},
      responsive_json: seccion.responsive_json ?? {},
      visibility_json: seccion.visibility_json ?? { desktop: true, tablet: true, mobile: true },
      status: seccion.status || 'published',
    };
  }

  static async sincronizarSecciones(landing_id, operaciones = []) {
    // Para simplificar la migración ahora, vamos a soportar tanto el modo array (legacy) como operaciones reales.
    const esArrayClasico = !operaciones.some(op => op.type === 'ADD' || op.type === 'UPDATE' || op.type === 'DELETE');
    
    if (esArrayClasico) {
      // Legacy path, convertir a operaciones:
      //
      // producto_id: null es CRÍTICO acá — guardarSeccionesProducto()
      // cuelga el diseño propio de un producto de este mismo landing_id
      // (ver comentario ahí, es solo bookkeeping porque la columna es NOT
      // NULL). Sin este filtro, cada Guardar de la landing normal detecta
      // esas filas como "no están en mi payload" y las BORRA — bug real
      // que borró el diseño de dos productos durante las pruebas de esta
      // sesión antes de encontrarlo. Este método nunca debe tocar filas
      // con producto_id seteado.
      const existentes = await LandingSeccion.findAll({ where: { landing_id, producto_id: null } });
      const idsPayload = new Set(operaciones.map(s => s.stable_id).filter(Boolean));
      
      const ops = [];
      for (const e of existentes) {
        // Filas viejas sin stable_id (se guardaron antes de que
        // normalizarSeccion lo generara siempre): no hay forma de
        // emparejarlas con el payload, así que el UPDATE nunca las alcanza y
        // el DELETE de abajo las salteaba — quedaban huérfanas mientras el
        // payload volvía a insertar las mismas secciones. Resultado: la
        // página se duplicaba entera al primer Guardar (reproducido: 4
        // secciones -> 8). El payload es la foto completa de la página, así
        // que lo correcto es borrarlas por id.
        if (!e.stable_id) {
          ops.push({ type: 'DELETE_POR_ID', id: e.id });
        } else if (!idsPayload.has(e.stable_id)) {
          ops.push({ type: 'DELETE', stable_id: e.stable_id });
        }
      }
      operaciones.forEach((s, idx) => {
        if (!s.stable_id) ops.push({ type: 'ADD', payload: { ...s, orden: s.orden ?? idx } });
        else if (existentes.some(e => e.stable_id === s.stable_id)) ops.push({ type: 'UPDATE', stable_id: s.stable_id, payload: { ...s, orden: s.orden ?? idx } });
        else ops.push({ type: 'ADD', payload: { ...s, orden: s.orden ?? idx } });
      });
      operaciones = ops;
    }

    const t = await sequelize.transaction();
    try {
      for (const op of operaciones) {
        switch (op.type) {
          case 'ADD':
            await LandingSeccion.create({ landing_id, ...this.normalizarSeccion(op.payload, op.payload.orden || 0) }, { transaction: t });
            break;
          case 'UPDATE':
            await LandingSeccion.update(this.normalizarSeccion(op.payload, op.payload.orden || 0), { where: { landing_id, stable_id: op.stable_id }, transaction: t });
            break;
          case 'MOVE':
            await LandingSeccion.update({ orden: op.orden }, { where: { landing_id, stable_id: op.stable_id }, transaction: t });
            break;
          case 'DELETE':
            await LandingSeccion.destroy({ where: { landing_id, stable_id: op.stable_id }, transaction: t });
            break;
          case 'DELETE_POR_ID':
            // Solo para las filas legacy sin stable_id — ver arriba. Va
            // acotado a producto_id null como todo este método, así que
            // nunca toca el diseño propio de un producto.
            await LandingSeccion.destroy({ where: { landing_id, id: op.id, producto_id: null }, transaction: t });
            break;
        }
      }
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  /**
   * Secciones del diseño propio de UN producto (page_type='product',
   * producto_id=X) — independiente de qué landing/página esté editando el
   * usuario, porque el diseño es una propiedad del producto (ver
   * obtenerProductoPublico). Devuelve [] si el producto todavía usa la
   * plantilla compartida (nunca activó diseño propio).
   */
  static async obtenerSeccionesProducto(producto_id, inquilino_id) {
    const producto = await Producto.findOne({ where: { id: producto_id, inquilino_id }, attributes: ['id'] });
    if (!producto) throw new Error('Producto no encontrado.');

    const secciones = await LandingSeccion.findAll({
      where: { producto_id, page_type: 'product' },
      order: [['orden', 'ASC']],
    });
    return secciones.map(s => this.seccionDto(s));
  }

  /**
   * Reemplaza el diseño propio de un producto — mismo algoritmo de diff
   * por stable_id que sincronizarSecciones() en modo "array clásico", pero
   * scopeado por producto_id en vez de landing_id, así que NUNCA toca la
   * plantilla compartida (producto_id NULL) ni el diseño de otro producto,
   * sin importar qué payload mande el cliente.
   */
  static async guardarSeccionesProducto(producto_id, inquilino_id, tienda_id, secciones = []) {
    const producto = await Producto.findOne({ where: { id: producto_id, inquilino_id }, attributes: ['id'] });
    if (!producto) throw new Error('Producto no encontrado.');

    // landing_id es NOT NULL en el schema, pero para estas filas es solo
    // bookkeeping — la lectura pública nunca filtra por landing_id cuando
    // hay producto_id (ver obtenerProductoPublico). 'inicio' es un ancla
    // estable: toda tienda tiene una vía asegurarPaginasFijas().
    const inicio = await Landing.findOne({ where: { tienda_id, tipo_pagina: 'inicio' }, attributes: ['id'] });
    if (!inicio) throw new Error('La tienda todavía no tiene una página de Inicio.');

    const existentes = await LandingSeccion.findAll({ where: { producto_id, page_type: 'product' } });
    const idsPayload = new Set(secciones.map(s => s.stable_id).filter(Boolean));

    const t = await sequelize.transaction();
    try {
      for (const e of existentes) {
        if (e.stable_id && !idsPayload.has(e.stable_id)) {
          await LandingSeccion.destroy({ where: { producto_id, stable_id: e.stable_id }, transaction: t });
        }
      }
      for (let idx = 0; idx < secciones.length; idx++) {
        const s = secciones[idx];
        const normalizado = { ...this.normalizarSeccion(s, idx), page_type: 'product', producto_id };
        const yaExiste = s.stable_id && existentes.some(e => e.stable_id === s.stable_id);
        if (yaExiste) {
          await LandingSeccion.update(normalizado, { where: { producto_id, stable_id: s.stable_id }, transaction: t });
        } else {
          await LandingSeccion.create({ landing_id: inicio.id, ...normalizado }, { transaction: t });
        }
      }
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    return this.obtenerSeccionesProducto(producto_id, inquilino_id);
  }

  static seccionDto(seccion, extra = {}) {
    return {
      id: seccion.id || null,
      stable_id: seccion.stable_id || null,
      page_type: seccion.page_type || 'landing',
      producto_id: seccion.producto_id || null,
      template_id: seccion.template_id || null,
      schema_version: seccion.schema_version || 1,
      tipo: seccion.tipo,
      nombre_interno: seccion.nombre_interno || null,
      activo: seccion.activo !== false,
      orden: Number(seccion.orden) || 0,
      content_json: seccion.content_json || seccion.contenido_json || {},
      settings_json: seccion.settings_json || seccion.config_json || {},
      responsive_json: seccion.responsive_json || {},
      visibility_json: seccion.visibility_json || { desktop: true, tablet: true, mobile: true },
      status: seccion.status || 'published',
      // Mantenemos estas temporalmente para no romper frontends viejos:
      config: seccion.settings_json || seccion.config_json || {},
      contenido: seccion.content_json || seccion.contenido_json || {},
      template: seccion.template_id || seccion.template || null,
      ...extra,
    };
  }

  static construirSeccionesPublicas(landing, { items, testimonios, faq, banner }) {
    // FASE 5: Commerce Engine para Funnels
    // Si la landing es un funnel impulsado por schema, ignoramos LandingSeccion y mapeamos el esquema virtual
    if (landing.tipo_pagina === 'funnel' && landing.template?.schema) {
      const mapeadas = landing.template.schema.map((bloque, idx) => {
        const content = landing.content?.[bloque.id] || {};
        return {
          id: `virtual-${idx}`,
          tipo: bloque.type,
          page_type: 'landing', // En funnels toda la página es el funnel
          nombre_interno: bloque.id,
          activo: true,
          orden: idx,
          config: { ...(bloque.config || {}), ...(content.config || {}) },
          contenido: { ...(bloque.contenido || {}), ...(content.contenido || {}) },
          ancho_mitad: content.ancho_mitad !== undefined ? content.ancho_mitad : (bloque.ancho_mitad || false)
        };
      });
      return { secciones: mapeadas, secciones_producto: [] };
    }

    const guardadas = [...(landing.secciones || [])]
      .sort((a, b) => a.orden - b.orden)
      .filter(s => s.activo !== false && (s.status === 'published' || !s.status));

    if (guardadas.length) {
      const mapeadas = guardadas.map(seccion => {
        if (seccion.tipo === 'productos') return this.seccionDto(seccion, { items });
        if (seccion.tipo === 'testimonios') return this.seccionDto(seccion, { items: testimonios });
        if (seccion.tipo === 'faq') return this.seccionDto(seccion, { items: faq });
        if (seccion.tipo === 'banner') {
          return this.seccionDto(seccion, {
            contenido: {
              ...(seccion.contenido_json || {}),
              ...(banner || {}),
            },
          });
        }
        return this.seccionDto(seccion);
      });
      return {
        secciones: mapeadas.filter(s => s.page_type === 'landing'),
        secciones_producto: mapeadas.filter(s => s.page_type === 'product'),
      };
    }

    const secciones = [
      this.seccionDto({ tipo: 'header', page_type: 'landing', nombre_interno: 'Header principal', activo: true, orden: 0, config_json: { sticky: true, mostrar_busqueda: true, mostrar_carrito: true }, contenido_json: { logo_texto: landing.titulo || landing.nombre } }),
      this.seccionDto({ tipo: 'hero', page_type: 'landing', nombre_interno: 'Hero', activo: true, orden: 10, config_json: {}, contenido_json: { titulo: landing.titulo, descripcion: landing.descripcion } }),
      this.seccionDto({ tipo: 'beneficios', page_type: 'landing', nombre_interno: 'Beneficios', activo: true, orden: 20, config_json: {}, contenido_json: {} }),
      this.seccionDto({ tipo: 'categorias', page_type: 'landing', nombre_interno: 'Categorias', activo: true, orden: 30, config_json: {}, contenido_json: {} }),
      this.seccionDto({ tipo: 'destacados', page_type: 'landing', nombre_interno: 'Productos destacados', activo: true, orden: 40, config_json: {}, contenido_json: {} }),
    ];
    if (banner) {
      secciones.push(this.seccionDto({ tipo: 'banner', page_type: 'landing', nombre_interno: 'Banner', activo: true, orden: 50, config_json: {}, contenido_json: banner }));
    }
    secciones.push(
      this.seccionDto({ tipo: 'productos', page_type: 'landing', nombre_interno: 'Catalogo', activo: true, orden: 60, config_json: {}, contenido_json: { titulo: 'Todos los productos' } }, { items }),
      this.seccionDto({ tipo: 'testimonios', page_type: 'landing', nombre_interno: 'Opiniones', activo: testimonios.length > 0, orden: 70, config_json: {}, contenido_json: { titulo: 'Opiniones de clientes' } }, { items: testimonios }),
      this.seccionDto({ tipo: 'faq', page_type: 'landing', nombre_interno: 'Preguntas frecuentes', activo: faq.length > 0, orden: 80, config_json: {}, contenido_json: { titulo: 'Preguntas frecuentes' } }, { items: faq }),
      this.seccionDto({ tipo: 'footer', page_type: 'landing', nombre_interno: 'Footer', activo: true, orden: 90, config_json: {}, contenido_json: { titulo: landing.titulo, descripcion: landing.descripcion } })
    );

    return {
      secciones: secciones.filter(s => s.activo !== false),
      secciones_producto: [],
    };
  }

  // ─── Campos simples (comunes a crear/actualizar) ────────────────────────

  static camposEditables(payload) {
    const campos = {};
    for (const campo of ['nombre', 'titulo', 'descripcion', 'content']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo] || null;
    }
    for (const flag of [
      'mostrar_filtro_categoria', 'mostrar_filtro_marca', 'mostrar_filtro_etiqueta',
      'mostrar_buscador', 'mostrar_orden_precio', 'mostrar_banner', 'mostrar_whatsapp',
      'whatsapp_incluir_precio', 'whatsapp_incluir_url',
      'mostrar_testimonios', 'mostrar_faq', 'checkout_redirigir_whatsapp',
    ]) {
      if (payload[flag] !== undefined) campos[flag] = !!payload[flag];
    }
    // ENUMs (Sequelize valida el valor permitido al guardar — no hace
    // falta duplicar la whitelist acá, un valor inválido tira 400 igual).
    for (const campo of ['tema_modo', 'radio_bordes', 'fuente']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo];
    }
    // banner_imagen / seo_og_imagen no se incluyen acá: las escriben
    // únicamente los endpoints de subida (subirBanner/subirSeoImagen), que
    // además borran el archivo viejo del disco — aceptarlas en este
    // payload de texto permitiría "pisar" el valor con cualquier string
    // sin pasar por esa limpieza.
    for (const campo of [
      'banner_titulo', 'banner_subtitulo', 'banner_boton_texto', 'banner_boton_link',
      'color_primario', 'color_fondo', 'color_texto', 'color_tarjeta', 'seo_titulo', 'seo_descripcion', 'seo_keywords',
    ]) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    return campos;
  }

  // ─── CRUD privado (scopeado por tienda_id) ──────────────────────────────

  static async crear(tienda_id, inquilino_id, payload) {
    // Con páginas fijas por rol (ver asegurarPaginasFijas), el cap es "una
    // por tipo_pagina" — no un total global de 1. En la práctica este
    // método casi no se llama más: MiLandingEntry.jsx asegura las 3
    // páginas al entrar al editor, así que siempre hay un :id para editar.
    // Queda como resguardo si algo llega a pedir crear una landing suelta.
    const tipoPagina = payload.tipo_pagina || 'inicio';
    const cantidadActual = await Landing.count({ where: { tienda_id, tipo_pagina: tipoPagina } });
    if (cantidadActual >= MAX_LANDINGS_POR_TIENDA) {
      throw new Error(`Ya existe una página de tipo "${tipoPagina}" para esta tienda.`);
    }

    if (!payload.nombre?.trim()) throw new Error('El nombre es obligatorio.');

    const errores = this.validarPayload(payload);
    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    const items = payload.items || [];
    await this.resolverItemsCatalogo(items, inquilino_id);

    const slug = payload.slug?.trim()
      ? await this.asegurarSlugDisponible(payload.slug.trim(), tienda_id)
      : await this.generarSlugUnico(payload.nombre, tienda_id);

    const landing = await Landing.create({
      inquilino_id,
      tienda_id,
      ...this.camposEditables(payload),
      nombre: payload.nombre.trim(),
      titulo: payload.titulo?.trim() || payload.nombre.trim(),
      slug,
      tipo_pagina: tipoPagina,
      // Solo la página 'inicio' es la raíz del hostname — ver
      // asegurarPaginasFijas() para el alta normal de las 3 páginas fijas.
      es_home: tipoPagina === 'inicio',
      activo: false,
    });

    await this.sincronizarItems(landing.id, items);
    if (payload.testimonios !== undefined) await this.sincronizarTestimonios(landing.id, payload.testimonios);
    if (payload.faq !== undefined) await this.sincronizarFaq(landing.id, payload.faq);
    if (payload.secciones !== undefined) await this.sincronizarSecciones(landing.id, payload.secciones);

    return this.obtener(landing.id, tienda_id);
  }

  static async actualizar(id, tienda_id, inquilino_id, payload) {
    const landing = await Landing.findOne({ where: { id, tienda_id } });
    if (!landing) throw new Error('Landing no encontrada.');

    const errores = this.validarPayload(payload);
    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    if (payload.items !== undefined) {
      await this.resolverItemsCatalogo(payload.items, inquilino_id);
    }

    if (payload.slug !== undefined && payload.slug?.trim() && payload.slug.trim() !== landing.slug) {
      landing.slug = await this.asegurarSlugDisponible(payload.slug.trim(), tienda_id, landing.id);
    }

    // es_home ya no se acepta por payload: con el cap de 1 landing por
    // tienda, siempre es true desde que se crea — no hay una segunda
    // landing con la que negociar cuál es la raíz.

    Object.assign(landing, this.camposEditables(payload));
    await landing.save();

    if (payload.items !== undefined) {
      await this.sincronizarItems(landing.id, payload.items);
    }
    if (payload.testimonios !== undefined) {
      await this.sincronizarTestimonios(landing.id, payload.testimonios);
    }
    if (payload.faq !== undefined) {
      await this.sincronizarFaq(landing.id, payload.faq);
    }
    if (payload.secciones !== undefined) {
      await this.sincronizarSecciones(landing.id, payload.secciones);
    }

    return this.obtener(landing.id, tienda_id);
  }

  /**
   * Setea/quita un campo de imagen directo (fuera de camposEditables — ver
   * el comentario ahí). Devuelve la URL vieja para que el controller borre
   * ese archivo del disco; landing.service.js no toca el filesystem.
   * @returns {{landing: object, anterior: string|null}}
   */
  static async _actualizarImagenCampo(id, tienda_id, campo, url) {
    const landing = await Landing.findOne({ where: { id, tienda_id } });
    if (!landing) throw new Error('Landing no encontrada.');
    const anterior = landing[campo];
    landing[campo] = url;
    await landing.save();
    return { landing: await this.obtener(id, tienda_id), anterior };
  }

  static actualizarImagenBanner(id, tienda_id, url) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', url);
  }

  static quitarImagenBanner(id, tienda_id) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', null);
  }

  static actualizarImagenSeo(id, tienda_id, url) {
    return this._actualizarImagenCampo(id, tienda_id, 'seo_og_imagen', url);
  }

  static quitarImagenSeo(id, tienda_id) {
    return this._actualizarImagenCampo(id, tienda_id, 'seo_og_imagen', null);
  }

  static async listar(tienda_id) {
    const landings = await Landing.findAll({
      where: { tienda_id },
      include: [{ model: LandingItem, as: 'items', attributes: ['id'] }],
      order: [['created_at', 'DESC']],
    });
    return landings.map(l => l.toJSON());
  }

  /**
   * Garantiza las 3 páginas fijas del sitio (Inicio/Catálogo/Contacto) —
   * `findOrCreate` por rol, nunca duplica. Se llama al entrar al armador
   * (ver GET /mis-landings/paginas), así que una tienda vieja (con su
   * única landing ya existente, migrada a tipo_pagina='inicio' por
   * migrate-landing-tipo-pagina.js) termina con Catálogo y Contacto
   * creadas recién la primera vez que alguien abre el editor después de
   * este cambio — no hace falta un backfill masivo aparte.
   *
   * Bypassa crear()/validarPayload() a propósito: estas filas nacen sin
   * items ni secciones (el editor las completa con getSeccionesBase() /
   * getSeccionesCatalogo() / getSeccionesContacto() del lado del cliente
   * recién al guardar), así que la validación de "al menos un item" de
   * crear() no aplica acá.
   */
  // Campos de identidad visual: las 3 páginas fijas son EL MISMO sitio,
  // así que Catálogo/Contacto nunca tienen tema propio — siempre reflejan
  // el de Inicio. No son editables de forma independiente por diseño (ver
  // asegurarPaginasFijas más abajo, que los re-sincroniza en cada carga).
  static CAMPOS_TEMA = ['tema_modo', 'color_primario', 'color_fondo', 'color_texto', 'color_tarjeta', 'radio_bordes', 'fuente'];

  static async asegurarPaginasFijas(tienda_id, inquilino_id) {
    const ROLES = [
      { tipo_pagina: 'inicio', nombre: 'Inicio', es_home: true },
      { tipo_pagina: 'catalogo', nombre: 'Catálogo', es_home: false },
      { tipo_pagina: 'contacto', nombre: 'Contacto', es_home: false },
    ];

    const existentes = await Landing.findAll({ where: { tienda_id } });
    const porTipo = new Map(existentes.map(l => [l.tipo_pagina, l]));
    const inicioExistente = porTipo.get('inicio');
    const temaInicio = inicioExistente
      ? Object.fromEntries(this.CAMPOS_TEMA.map(c => [c, inicioExistente[c]]))
      : {};

    for (const rol of ROLES) {
      if (porTipo.has(rol.tipo_pagina)) continue;
      const slug = await this.generarSlugUnico(rol.nombre, tienda_id);
      await Landing.create({
        inquilino_id,
        tienda_id,
        nombre: rol.nombre,
        titulo: rol.nombre,
        slug,
        tipo_pagina: rol.tipo_pagina,
        es_home: rol.es_home,
        activo: false,
        // Catálogo/Contacto nacen con el tema vigente de Inicio, no con
        // el default del schema — si Inicio todavía no existe (primera
        // vez que se llama, se crea antes en este mismo loop por el orden
        // de ROLES) usan el default, y quedan sincronizadas igual en el
        // paso de abajo la próxima vez que se llame esta función.
        ...(rol.tipo_pagina !== 'inicio' ? temaInicio : {}),
      });
    }

    // Re-sincroniza SIEMPRE (no solo al crear): si la dueña cambia colores/
    // fuente desde Inicio, Catálogo y Contacto tienen que reflejarlo la
    // próxima vez que se abra el armador — no son un tema independiente.
    const inicioActual = porTipo.get('inicio') || await Landing.findOne({ where: { tienda_id, tipo_pagina: 'inicio' } });
    if (inicioActual) {
      const temaActual = Object.fromEntries(this.CAMPOS_TEMA.map(c => [c, inicioActual[c]]));
      await Landing.update(temaActual, { where: { tienda_id, tipo_pagina: { [Op.in]: ['catalogo', 'contacto'] } } });
    }

    const paginas = await Landing.findAll({
      where: { tienda_id },
      attributes: ['id', 'tipo_pagina', 'slug', 'nombre', 'titulo', 'activo'],
      order: [['tipo_pagina', 'ASC']],
    });
    return paginas.map(p => p.toJSON());
  }

  static async obtener(id, tienda_id) {
    const landing = await Landing.findOne({
      where: { id, tienda_id },
      include: [
        { model: LandingItem, as: 'items' },
        // producto_id: null — SOLO las secciones de la landing en sí. El
        // diseño propio de cada producto cuelga de este MISMO landing_id
        // (ver guardarSeccionesProducto: landing_id ahí es bookkeeping,
        // la columna es NOT NULL), así que sin este filtro el editor de
        // "Mi landing" cargaba las secciones de TODOS los productos como
        // si fueran suyas y al guardar las re-creaba como copias —
        // duplicando header/detalle/beneficios una tanda por guardado.
        // Ese era el origen real de los duplicados.
        { model: LandingSeccion, as: 'secciones', required: false, where: { producto_id: null } },
        { model: Testimonio, as: 'testimonios' },
        { model: Faq, as: 'faq' },
      ],
      // El orden de una asociación se declara acá arriba, no dentro del
      // include: ahí Sequelize lo ignora en silencio y los items vuelven
      // en orden de inserción, perdiendo el orden que definió el usuario.
      order: [
        [{ model: LandingItem, as: 'items' }, 'orden', 'ASC'],
        [{ model: LandingSeccion, as: 'secciones' }, 'orden', 'ASC'],
        [{ model: Testimonio, as: 'testimonios' }, 'orden', 'ASC'],
        [{ model: Faq, as: 'faq' }, 'orden', 'ASC'],
      ],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    const json = landing.toJSON();
    // Mapear secciones: content_json/settings_json → contenido/config para compatibilidad con frontend
    if (Array.isArray(json.secciones)) {
      json.secciones = json.secciones.map(s => ({
        ...s,
        contenido_json: s.content_json,
        config_json: s.settings_json,
        contenido: s.content_json,
        config: s.settings_json,
      }));
    }
    return json;
  }

  /**
   * Solo confirma pertenencia (usado por subirTestimonioFoto, que no
   * necesita el resto del detalle) — mismo mensaje de error que el resto
   * del CRUD para que manejarError() lo mapee a 404 sin casos especiales.
   */
  static async verificarPertenece(id, tienda_id) {
    const landing = await Landing.findOne({ where: { id, tienda_id }, attributes: ['id'] });
    if (!landing) throw new Error('Landing no encontrada.');
  }

  static async eliminar(id, tienda_id) {
    const landing = await Landing.findOne({ where: { id, tienda_id } });
    if (!landing) throw new Error('Landing no encontrada.');
    await landing.destroy();
    return true;
  }

  static async cambiarEstado(id, tienda_id, activo) {
    const landing = await Landing.findOne({ where: { id, tienda_id } });
    if (!landing) throw new Error('Landing no encontrada.');

    // Contacto es la única de las 3 páginas fijas sin catálogo propio.
    // Un funnel de producto individual (FunnelSelector/MerchantEditor)
    // nunca tiene LandingItem — su producto vive en Landing.producto_id
    // directo — así que se valida aparte, o "publicar" siempre fallaría
    // con "sin productos" aunque sí tenga uno.
    if (activo && landing.tipo_pagina === 'funnel') {
      if (!landing.producto_id) throw new Error('No se puede publicar un funnel sin producto.');
    } else if (activo && landing.tipo_pagina !== 'contacto') {
      const cantidadItems = await LandingItem.count({ where: { landing_id: landing.id } });
      if (cantidadItems === 0) throw new Error('No se puede publicar una landing sin productos.');
    }

    landing.activo = !!activo;
    await landing.save();
    return landing.toJSON();
  }

  /**
   * Versión liviana de la búsqueda de landing pública — solo lo necesario
   * para registrar un evento (id, si está activa), sin resolver todo el
   * catálogo/precios como obtenerPublica.
   */
  static async obtenerIdParaEvento(tienda, slug) {
    const where = { tienda_id: tienda.id };
    if (slug) where.slug = slug; else where.es_home = true;
    const landing = await Landing.findOne({ where, attributes: ['id', 'activo'] });
    if (!landing || !landing.activo) return null;
    return landing.id;
  }

  /**
   * Catálogo real de una landing, indexado por el content_id PÚBLICO — el
   * mismo identificador que obtenerPublica() le entrega al navegador (el slug
   * del item, o "<tipo>-<id>" si no tiene). Lo usa registrarEvento() para no
   * guardar nombres de producto inventados: /eventos es público y sin auth, y
   * lo que se guarda en LandingEvento.payload termina renderizado en
   * "productos más consultados" del panel de la dueña de la tienda.
   *
   * A propósito NO filtra por activo/estado_venta como obtenerPublica: si la
   * dueña despublica un producto mientras alguien tiene la landing abierta,
   * el evento de esa persona sigue siendo legítimo y no hay que perderlo. Acá
   * se valida la IDENTIDAD del item, no su estado.
   *
   * @returns {Promise<Map<string, {nombre: string, variantes: Set<string>}>>}
   */
  static async obtenerCatalogoParaEvento(landing_id) {
    const items = await LandingItem.findAll({
      where: { landing_id },
      attributes: ['tipo', 'referencia_id'],
    });
    if (!items.length) return new Map();

    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);

    const [productos, combos, variantes] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({ where: { id: { [Op.in]: idsProducto } }, attributes: ['id', 'slug', 'nombre'] })
        : Promise.resolve([]),
      idsCombo.length
        ? ProductoCombo.findAll({ where: { id: { [Op.in]: idsCombo } }, attributes: ['id', 'nombre'] })
        : Promise.resolve([]),
      idsProducto.length
        ? ProductoVariante.findAll({ where: { producto_id: { [Op.in]: idsProducto } }, attributes: ['producto_id', 'nombre'] })
        : Promise.resolve([]),
    ]);

    const variantesPorProducto = new Map();
    variantes.forEach(v => {
      const set = variantesPorProducto.get(v.producto_id) || new Set();
      set.add(v.nombre);
      variantesPorProducto.set(v.producto_id, set);
    });

    const catalogo = new Map();
    productos.forEach(p => {
      catalogo.set(p.slug || `producto-${p.id}`, {
        nombre: p.nombre,
        variantes: variantesPorProducto.get(p.id) || new Set(),
      });
    });
    // Los combos no tienen slug propio — obtenerPublica cae al mismo fallback.
    combos.forEach(c => {
      catalogo.set(`combo-${c.id}`, { nombre: c.nombre, variantes: new Set() });
    });

    return catalogo;
  }

  /**
   * Fire-and-forget: nunca se awaitea desde el caller (ver obtenerPublica)
   * — una landing pública no puede tardar más ni romperse porque falló un
   * INSERT de tracking. Sin filtro de bots: cada GET exitoso cuenta como
   * visita, aceptado como límite conocido de esta primera versión.
   */
  static registrarVisita(landing_id) {
    LandingEvento.create({ landing_id, tipo_evento: 'visita', payload: null, enviado_capi: false })
      .catch(err => console.error('[landing] No se pudo registrar la visita:', err.message));
  }

  /**
   * Estadísticas agregadas de una landing a partir de LandingEvento.
   * Deliberadamente NO incluye "más vendidos" ni "pedidos generados": no
   * existe todavía ningún módulo de Pedido/Checkout en el sistema (ver
   * memoria del proyecto) — no hay de dónde sacar esos números sin
   * inventarlos. Solo se reportan métricas respaldadas por eventos reales:
   * visitas (GET exitoso a la landing) y clics de "Consultar" (evento
   * "Contact", el mismo que alimenta Meta Pixel/CAPI cuando está activo).
   */
  static async estadisticas(id, tienda_id, dias = 30) {
    const landing = await Landing.findOne({ where: { id, tienda_id }, attributes: ['id'] });
    if (!landing) throw new Error('Landing no encontrada.');

    const diasNum = Math.min(Math.max(parseInt(dias, 10) || 30, 7), 90);
    const desde = new Date();
    desde.setUTCHours(0, 0, 0, 0);
    desde.setUTCDate(desde.getUTCDate() - (diasNum - 1));

    const eventos = await LandingEvento.findAll({
      where: { landing_id: id, created_at: { [Op.gte]: desde } },
      attributes: ['tipo_evento', 'payload', 'created_at'],
      order: [['created_at', 'ASC']],
    });

    const visitas = eventos.filter(e => e.tipo_evento === 'visita');
    // 'InitiateCheckout' NO cuenta como conversación de WhatsApp: un checkout
    // de carrito emite InitiateCheckout Y Contact por el mismo envío (ver
    // checkoutCarrito en LandingPublica.jsx), así que incluirlo contaba dos
    // veces la misma conversación e inflaba el CTR. Mismo criterio que
    // estadisticasRango(), que ya filtraba solo por Contact/Lead.
    const contactos = eventos.filter(e => ['Contact', 'Lead'].includes(e.tipo_evento));
    const todosEventosConversion = eventos.filter(e => ['Contact', 'InitiateCheckout', 'AddToCart', 'Lead'].includes(e.tipo_evento));

    const serieMap = new Map();
    for (let i = 0; i < diasNum; i++) {
      const dia = new Date(desde.getTime() + i * 86400000).toISOString().slice(0, 10);
      serieMap.set(dia, 0);
    }
    visitas.forEach(v => {
      const dia = v.created_at.toISOString().slice(0, 10);
      if (serieMap.has(dia)) serieMap.set(dia, serieMap.get(dia) + 1);
    });

    // payload.items trae el detalle por producto de un checkout de carrito o AddToCart
    // (varios productos en un solo evento o individuales).
    const productosMap = new Map();
    // Misma deduplicación que estadisticasRango(): el par
    // InitiateCheckout+Contact de un checkout de carrito comparte el event_id
    // base y no puede contar sus productos dos veces.
    const intencionesYaContadas = new Set();
    todosEventosConversion.forEach(c => {
      const intencion = String(c.payload?.event_id || '').replace(/-contact$/, '');
      if (intencion) {
        if (intencionesYaContadas.has(intencion)) return;
        intencionesYaContadas.add(intencion);
      }
      const items = Array.isArray(c.payload?.items) ? c.payload.items : null;
      if (items) {
        items.forEach(it => {
          if (!it?.nombre) return;
          productosMap.set(it.nombre, (productosMap.get(it.nombre) || 0) + (it.cantidad || 1));
        });
        return;
      }
      const nombre = c.payload?.custom_data?.content_name;
      if (nombre) productosMap.set(nombre, (productosMap.get(nombre) || 0) + 1);
    });
    const productos_mas_consultados = [...productosMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([nombre, consultas]) => ({ nombre, consultas }));

    const totalVisitas = visitas.length;
    const totalContactos = contactos.length;

    return {
      dias: diasNum,
      visitas: totalVisitas,
      conversaciones_whatsapp: totalContactos,
      ctr: totalVisitas > 0 ? totalContactos / totalVisitas : 0,
      serie_visitas: [...serieMap.entries()].map(([fecha, cantidad]) => ({ fecha, cantidad })),
      productos_mas_consultados,
    };
  }

  /**
   * Igual que estadisticas() pero por rango de calendario en vez de ventana
   * rodante de N días — mismos presets que pedidosAnalyticsService (ver
   * utils/rangoFechas), para que en el dashboard del usuario el filtro de
   * fechas sea un solo control compartido con las métricas de Ventas
   * confirmadas (Envio/EnvioItem).
   *
   * valor_carritos: suma de precio×cantidad de los items de cada checkout
   * de carrito ("Contact" con payload.items[].precio) o AddToCart — es el valor
   * de lo que se consultó o mandó por WhatsApp, NO una venta confirmada.
   */
  static async estadisticasRango(id, tienda_id, filtros = {}) {
    const landing = await Landing.findOne({ where: { id, tienda_id }, attributes: ['id'] });
    if (!landing) throw new Error('Landing no encontrada.');

    const { desde, hasta } = resolverRangoFechas(filtros);
    const desdeDate = new Date(`${desde}T00:00:00`);
    const hastaDate = new Date(`${hasta}T23:59:59.999`);

    const MAX_DIAS_RANGO = 400;
    if ((hastaDate - desdeDate) / 86400000 > MAX_DIAS_RANGO) {
      hastaDate.setTime(desdeDate.getTime() + MAX_DIAS_RANGO * 86400000);
    }

    const eventos = await LandingEvento.findAll({
      where: { landing_id: id, created_at: { [Op.between]: [desdeDate, hastaDate] } },
      attributes: ['tipo_evento', 'payload', 'created_at'],
      order: [['created_at', 'ASC']],
    });

    const visitas = eventos.filter(e => e.tipo_evento === 'visita');
    const todosEventos = eventos.filter(e => ['Contact', 'InitiateCheckout', 'AddToCart', 'Lead'].includes(e.tipo_evento));

    const pad = (n) => String(n).padStart(2, '0');
    const formatYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const serieMap = new Map();
    for (const cursor = new Date(desdeDate); cursor <= hastaDate; cursor.setDate(cursor.getDate() + 1)) {
      const dia = formatYMD(cursor);
      serieMap.set(dia, {
        fecha: dia,
        visitas: 0,
        añadidos_carrito: 0,
        checkouts_iniciados: 0,
        contactos: 0,
        valor_carritos: 0,
      });
    }

    visitas.forEach(v => {
      const dia = formatYMD(v.created_at);
      if (serieMap.has(dia)) serieMap.get(dia).visitas += 1;
    });

    let valorCarritosTotal = 0;
    let totalAñadidosCarrito = 0;
    let totalCheckoutsIniciados = 0;
    let totalContactos = 0;
    
    const productosMap = new Map();

    /**
     * Un checkout de carrito emite DOS eventos con exactamente los mismos
     * items: InitiateCheckout y Contact (ver checkoutCarrito en
     * LandingPublica.jsx). Meta los necesita separados —son dos eventos
     * distintos de su embudo—, pero para el negocio son UNA sola intención de
     * compra: el mismo carrito, mandado una vez por WhatsApp.
     *
     * Sin deduplicar, cada checkout sumaba su valor DOS veces a
     * valor_carritos y contaba sus productos dos veces en "más consultados".
     * El par comparte el event_id base ("<uuid>" y "<uuid>-contact"), que es
     * lo que se usa para agruparlos.
     *
     * Los contadores del embudo (arriba) NO se deduplican a propósito: ahí sí
     * corresponde contar 1 checkout y 1 contacto por separado, que es lo que
     * pasó de verdad.
     */
    const intencionesYaValorizadas = new Set();

    todosEventos.forEach(c => {
      const dia = formatYMD(c.created_at);
      const diaStat = serieMap.get(dia);

      if (c.tipo_evento === 'AddToCart') {
        totalAñadidosCarrito += 1;
        if (diaStat) diaStat.añadidos_carrito += 1;
      } else if (c.tipo_evento === 'InitiateCheckout') {
        totalCheckoutsIniciados += 1;
        if (diaStat) diaStat.checkouts_iniciados += 1;
      } else if (['Contact', 'Lead'].includes(c.tipo_evento)) {
        totalContactos += 1;
        if (diaStat) diaStat.contactos += 1;
      }

      // Las filas viejas sin event_id en el payload no se deduplican (quedan
      // como estaban): sin identificador no hay forma de saber cuál era el par.
      const intencion = String(c.payload?.event_id || '').replace(/-contact$/, '');
      if (intencion) {
        if (intencionesYaValorizadas.has(intencion)) return;
        intencionesYaValorizadas.add(intencion);
      }

      const items = Array.isArray(c.payload?.items) ? c.payload.items : null;
      if (items) {
        let valorEvento = 0;
        items.forEach(it => {
          if (!it?.nombre) return;
          productosMap.set(it.nombre, (productosMap.get(it.nombre) || 0) + (it.cantidad || 1));
          if (Number.isFinite(it.precio)) valorEvento += it.precio * (it.cantidad || 1);
        });
        
        // Sumamos a valor_carritos el valor de las intenciones de compra firmes
        if (['Contact', 'InitiateCheckout', 'Lead'].includes(c.tipo_evento)) {
          valorCarritosTotal += valorEvento;
          if (diaStat) diaStat.valor_carritos += valorEvento;
        }
        return;
      }
      
      const nombre = c.payload?.custom_data?.content_name;
      if (nombre) productosMap.set(nombre, (productosMap.get(nombre) || 0) + 1);
      const val = c.payload?.custom_data?.value;
      if (['Contact', 'InitiateCheckout', 'Lead'].includes(c.tipo_evento) && Number.isFinite(val)) {
        valorCarritosTotal += val;
        if (diaStat) diaStat.valor_carritos += val;
      }
    });

    const productos_mas_consultados = [...productosMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([nombre, consultas]) => ({ nombre, consultas }));

    const totalVisitas = visitas.length;

    return {
      rango_fechas: { desde, hasta, periodo: filtros.periodo || 'este_mes' },
      visitas: totalVisitas,
      añadidos_carrito: totalAñadidosCarrito,
      checkouts_iniciados: totalCheckoutsIniciados,
      contactos_whatsapp: totalContactos, // kept naming for backwards compatibility just in case
      conversaciones_whatsapp: totalContactos, // legacy
      ctr: totalVisitas > 0 ? totalContactos / totalVisitas : 0,
      valor_carritos: valorCarritosTotal,
      serie: [...serieMap.values()],
      productos_mas_consultados,
    };
  }

  // ─── Resolución pública (sin auth) ───────────────────────────────────────

  /**
   * Serializa la vista PÚBLICA (render final) de una Landing.
   * - Solo incluye productos activos y con precio definido.
   * - Solo incluye combos activos, y donde producto_padre esté activo.
   * - Resuelve el precio final (usuario vs base).
   * - Resuelve el carrito_config de la tienda (minimos, recargos, etc).
   *
   * @param {Object} tienda - Tienda completa
   * @param {string|null} slug - identificador, o null si es la "home"
   * @param {boolean} preview - true si el admin está viéndola desde el editor
   * @returns {{disponible:true, ...}} landing pública lista para renderizar
   */
  static async obtenerPublica(tienda, slug, preview = false) {
    const where = { tienda_id: tienda.id };
    if (slug) where.slug = slug; else where.es_home = true;

    const landing = await Landing.findOne({
      where,
      include: [
        { model: LandingItem, as: 'items' },
        // producto_id: null por el mismo motivo que en obtener() — el
        // diseño propio de un producto lo resuelve obtenerProductoPublico()
        // aparte, nunca se mezcla con las secciones de la landing.
        { model: LandingSeccion, as: 'secciones', required: false, where: { producto_id: null } },
        { model: LandingTemplate, as: 'template', required: false },
      ],
      // Ver nota en obtener(): el orden va acá, no dentro del include.
      order: [
        [{ model: LandingItem, as: 'items' }, 'orden', 'ASC'],
        [{ model: LandingSeccion, as: 'secciones' }, 'orden', 'ASC'],
      ],
    });
    if (!landing) return null;

    if (!tienda.activo || !tienda.Usuario?.activo) return { disponible: false };
    if (!landing.activo && !preview) return { disponible: false };

    // No se awaitea — ver comentario en registrarVisita(). Una landing
    // pública nunca debe tardar más porque falló (o tardó) un INSERT de
    // tracking.
    this.registrarVisita(landing.id);

    // Un funnel nunca tiene LandingItem: su único producto vive en
    // Landing.producto_id (ver cambiarEstado()). Se sintetiza acá el
    // LandingItem que le faltaría para que todo el pipeline de abajo
    // (precios, variantes, ofertas, imágenes, FAQ) lo resuelva igual que a
    // cualquier producto de una landing normal, sin duplicar esa lógica.
    const items = (landing.tipo_pagina === 'funnel' && landing.producto_id && !(landing.items || []).length)
      ? [{
        tipo: 'producto',
        referencia_id: landing.producto_id,
        precio_ancla: null,
        etiqueta: null,
        mostrar_en_inicio: true,
        createdAt: landing.createdAt,
      }]
      : (landing.items || []);
    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);
    // Templates rígidos (Fitness/Beauty/Tech/Básico) — ver landingSimple.
    // service.js. "Beneficios" es contenido propio de ESAS landings, el
    // sistema flexible nunca escribe filas ahí.
    const esRigida = landing.template?.kind === 'rigido';
    // Embudo de un solo producto (ver funnel.service.js). También escribe
    // beneficios propios, así que entra en la misma consulta que las
    // rígidas — sin esto la sección "Beneficios rápidos" del embudo
    // llegaba siempre vacía al frontend.
    const esFunnel = landing.template?.kind === 'funnel';

    const [productos, combos, ofertas, testimonios, faqs, beneficios] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({
          where: { id: { [Op.in]: idsProducto }, activo: true, estado_venta: 'en_venta' },
          include: [{ association: 'categoria', attributes: ['nombre'] }, { model: Marca, attributes: ['nombre'] }],
        })
        : Promise.resolve([]),
      idsCombo.length
        ? ProductoCombo.findAll({
          where: { id: { [Op.in]: idsCombo }, estado: 'ACTIVO' },
          include: [
            {
              model: Producto,
              as: 'producto_padre',
              where: { activo: true },
              include: [{ association: 'categoria', attributes: ['nombre'] }, { model: Marca, attributes: ['nombre'] }],
            },
            {
              model: ProductoComboItem,
              as: 'items',
              attributes: ['id'],
              include: [{ model: Producto, as: 'producto_incluido', attributes: ['id', 'nombre'] }],
            },
          ],
        })
        : Promise.resolve([]),
      // Ofertas activas de los productos de esta landing — pack/combo ×
      // normal/order_bump/upsell. Igual que Producto arriba, no se
      // re-filtra por inquilino_id: los ids ya vienen acotados al
      // catálogo de esta landing/tienda.
      idsProducto.length
        ? Oferta.findAll({
          where: { producto_ancla_id: { [Op.in]: idsProducto }, activo: true },
          include: [{ 
            model: OfertaComponente, 
            as: 'componentes', 
            attributes: ['producto_id', 'cantidad'],
            include: [{
              model: Producto,
              as: 'producto',
              attributes: ['id', 'nombre', 'sku', 'precio_costo', 'cantidad_disponible'],
              include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }]
            }]
          }],
          order: [['orden', 'ASC']],
        })
        : Promise.resolve([]),
      landing.mostrar_testimonios
        ? Testimonio.findAll({ where: { landing_id: landing.id }, order: [['orden', 'ASC']] })
        : Promise.resolve([]),
      landing.mostrar_faq
        ? Faq.findAll({ where: { landing_id: landing.id }, order: [['orden', 'ASC']] })
        : Promise.resolve([]),
      (esRigida || esFunnel)
        ? LandingBeneficio.findAll({ where: { landing_id: landing.id }, order: [['orden', 'ASC']] })
        : Promise.resolve([]),
    ]);

    const mapaOfertas = new Map(); // producto_ancla_id -> Oferta[]
    // Solo las que están corriendo hoy: `activo` ya viene filtrado por la
    // consulta, pero una oferta con ventana de fechas puede estar activa y
    // aun así no corresponder todavía (o haber vencido). Ver
    // PricingService.ofertaVigente.
    ofertas.filter(o => PricingService.ofertaVigente(o)).forEach(o => {
      const lista = mapaOfertas.get(o.producto_ancla_id) || [];
      lista.push(o);
      mapaOfertas.set(o.producto_ancla_id, lista);
    });

    const referenciasProducto = productos.map(p => p.id);
    const referenciasCombo = combos.map(c => c.id);
    // Imagen/galería: para combos se usa la del producto_padre (los combos no tienen imagen propia).
    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
    ];

    // precios, imagenes y variantes solo dependen de los IDs ya resueltos
    // arriba, no entre sí — en paralelo en vez de uno atrás del otro.
    const [precios, imagenes, variantes, preguntas] = await Promise.all([
      PrecioUsuario.findAll({
        where: {
          usuario_id: tienda.usuario_id,
          [Op.or]: [
            { tipo: 'producto', referencia_id: { [Op.in]: referenciasProducto.length ? referenciasProducto : [-1] } },
            { tipo: 'combo', referencia_id: { [Op.in]: referenciasCombo.length ? referenciasCombo : [-1] } },
          ],
        },
      }),
      idsParaImagen.length
        // Antes solo se traía la principal (para la tarjeta de la grilla).
        // La vista de detalle necesita la galería completa, incluidas las
        // imágenes propias de cada variante.
        ? ProductoImagen.findAll({
          where: { producto_id: { [Op.in]: idsParaImagen } },
          attributes: ['producto_id', 'variante_id', 'url', 'es_principal'],
          order: [['es_principal', 'DESC'], ['orden', 'ASC']],
        })
        : Promise.resolve([]),
      // Los combos no tienen selector de variante propio (son un bundle
      // fijo armado por el admin) — solo se resuelven para productos.
      idsProducto.length
        ? ProductoVariante.findAll({
          where: { producto_id: { [Op.in]: idsProducto }, activo: true },
          order: [['id', 'ASC']],
        })
        : Promise.resolve([]),
      // FAQ propia de cada Producto ("Todo lo que necesitas saber") — los
      // combos no tienen, solo productos individuales.
      idsProducto.length
        ? ProductoFaq.findAll({
          where: { producto_id: { [Op.in]: idsProducto } },
          order: [['orden', 'ASC']],
        })
        : Promise.resolve([]),
    ]);
    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));

    const mapaFaq = new Map(); // producto_id -> {pregunta, respuesta}[]
    preguntas.forEach(f => {
      const lista = mapaFaq.get(f.producto_id) || [];
      lista.push({ pregunta: f.pregunta, respuesta: f.respuesta });
      mapaFaq.set(f.producto_id, lista);
    });

    const mapaImagenes = new Map(); // producto_id -> [{url, variante_id, es_principal}]
    imagenes.forEach(img => {
      const lista = mapaImagenes.get(img.producto_id) || [];
      lista.push({ url: img.url, variante_id: img.variante_id, es_principal: img.es_principal });
      mapaImagenes.set(img.producto_id, lista);
    });

    const mapaVariantes = new Map(); // producto_id -> ProductoVariante[]
    variantes.forEach(v => {
      const lista = mapaVariantes.get(v.producto_id) || [];
      lista.push(v);
      mapaVariantes.set(v.producto_id, lista);
    });

    const mapaProducto = new Map(productos.map(p => [p.id, p]));
    const mapaCombo = new Map(combos.map(c => [c.id, c]));

    // Los componentes de una oferta de checkout (el producto que suma un
    // order bump, o los que arma un combo) casi nunca están curados en la
    // landing — el comercio elige el bump de TODO su catálogo. Sin esto la
    // casilla del checkout salía sin nombre ni foto del producto ofrecido,
    // porque `mapaProducto`/`mapaImagenes` solo tienen los items de la
    // landing. Se traen solo nombre e imagen: nada de precios ni stock, que
    // no se muestran y no hace falta exponer.
    const idsComponentesAjenos = [...new Set(
      ofertas.flatMap(o => (o.componentes || []).map(c => c.producto_id))
    )].filter(id => !mapaProducto.has(id));

    if (idsComponentesAjenos.length) {
      const [productosAjenos, imagenesAjenas] = await Promise.all([
        Producto.findAll({ where: { id: { [Op.in]: idsComponentesAjenos } }, attributes: ['id', 'nombre'] }),
        ProductoImagen.findAll({
          where: { producto_id: { [Op.in]: idsComponentesAjenos }, variante_id: null },
          attributes: ['producto_id', 'variante_id', 'url', 'es_principal'],
          order: [['es_principal', 'DESC'], ['orden', 'ASC']],
        }),
      ]);
      productosAjenos.forEach(p => mapaProducto.set(p.id, p));
      imagenesAjenas.forEach(img => {
        const lista = mapaImagenes.get(img.producto_id) || [];
        lista.push({ url: img.url, variante_id: img.variante_id, es_principal: img.es_principal });
        mapaImagenes.set(img.producto_id, lista);
      });
    }

    const itemsDto = [];
    for (const item of items) {
      const entidad = item.tipo === 'producto' ? mapaProducto.get(item.referencia_id) : mapaCombo.get(item.referencia_id);
      if (!entidad) continue; // desactivado / borrado desde que se agregó a la landing

      const esCombo = item.tipo === 'combo';
      const productoParaFiltros = esCombo ? entidad.producto_padre : entidad;
      const precioBase = parseFloat(esCombo ? entidad.precio_total : entidad.precio_base);
      const precioMinimo = entidad.precio_minimo !== null && entidad.precio_minimo !== undefined ? parseFloat(entidad.precio_minimo) : null;
      const precioUsuario = mapaPrecios.get(`${item.tipo}:${entidad.id}`);
      // Nunca se confía en el precio guardado: se recalcula contra el piso VIGENTE,
      // por si precio_minimo subió después de que el usuario fijó su precio.
      // Descuento por fecha (Producto.descuento_porcentaje + ventana) — un
      // combo no tiene ventana propia, ya trae precio_total fijo.
      const precioBaseConDescuento = esCombo
        ? precioBase
        : PricingService.aplicarDescuentoFecha(precioBase, entidad.descuento_porcentaje, entidad.descuento_inicio, entidad.descuento_fin);
      const { base: precioBaseEfectivo, efectivo: precioEfectivo } = PricingService.calcularPrecioBase(precioBaseConDescuento, precioMinimo, precioUsuario);

      const galeriaFuente = productoParaFiltros ? (mapaImagenes.get(productoParaFiltros.id) || []) : [];
      // Galería general: todas las imágenes que no son de una variante
      // puntual. Si un producto no tiene ninguna imagen "general" (todas
      // están atadas a variantes), se usan todas igual — mejor mostrar
      // algo que una galería vacía.
      const galeriaGeneral = galeriaFuente.filter(i => !i.variante_id);
      const imagenesDto = (galeriaGeneral.length ? galeriaGeneral : galeriaFuente).map(i => i.url);

      // Variantes: precio_diferencial es un delta ABSOLUTO que fijó el
      // admin sobre precio_base (ej: "el talle XL cuesta 10.000 más"). Ese
      // delta se aplica sobre el precio ya efectivo (precio propio de la
      // vendedora si lo tiene, si no precio_base) y se vuelve a pisar por
      // precio_minimo — ninguna variante puede venderse por debajo del piso.
      const variantesDto = !esCombo ? (mapaVariantes.get(entidad.id) || []).map(v => {
        const precioVariante = PricingService.calcularPrecioVariante(precioBaseEfectivo, v.precio_diferencial, precioMinimo);
        return {
          id: v.id,
          nombre: v.nombre,
          stock: v.stock,
          precio_efectivo: precioVariante,
          imagenes: galeriaFuente.filter(i => i.variante_id === v.id).map(i => i.url),
        };
      }) : [];

      // Ofertas comerciales del producto (individual siempre es precioEfectivo;
      // acá van las adicionales: pack x2/x3, order bump, upsell, combo). No se
      // exponen ni el código interno ni la receta de stock — el checkout solo
      // necesita el id para volver a resolver todo eso del lado del servidor.
      const ofertasDto = !esCombo ? (mapaOfertas.get(entidad.id) || []).map(o => {
        // "unidades" es SOLO para packs (nunca combos, misma razón que ya
        // documenta el comentario de arriba: no filtrar la receta) — se
        // deriva del componente que apunta al producto ancla ("Earplugs x3"
        // = 1 componente {producto_id: earplugs, cantidad: 3}, ver
        // OfertaComponente.js). Con esto el frontend puede calcular el %
        // de ahorro (1 - precio/(precio_individual*unidades)) sin que el
        // backend le mande la receta completa de componentes.
        let unidades = null;
        if (o.tipo_contenido === 'pack') {
          const propio = (o.componentes || []).find(c => c.producto_id === entidad.id);
          unidades = propio?.cantidad || (o.componentes || []).reduce((s, c) => s + (c.cantidad || 0), 0) || null;
        }
        // Ofertas de checkout (order bump / combo): a diferencia de un pack,
        // acá SÍ hace falta mostrar QUÉ se está ofreciendo de más (ej.
        // "Agregá el Mouse por Gs 15.000" con su propia foto) — sin esto la
        // casilla del checkout no tendría nombre ni imagen que mostrar. Se
        // exponen solo nombre/imagen, nunca cantidades ni la receta completa
        // (mismo criterio de privacidad que "unidades" arriba).
        // Un order bump se ofrece DENTRO del checkout; un combo se elige
        // antes, en la ficha del producto. Los dos necesitan mostrar qué
        // traen, pero solo el bump cobra el precio promocional.
        const esOrderBump = o.estrategia === 'order_bump';
        let productoComplementario = null;
        let productosIncluidos = [];
        if (esOrderBump || o.estrategia === 'combo') {
          const resolverProducto = (productoId) => {
            const prod = mapaProducto.get(productoId);
            if (!prod) return null;
            const imgs = mapaImagenes.get(prod.id) || [];
            const principal = imgs.find(i => i.es_principal) || imgs[0];
            return { nombre: prod.nombre, imagen: principal?.url || null };
          };
          // Un combo se muestra como paquete completo ("3 productos x
          // 120.000"), así que lista TODOS sus productos — el ancla incluido.
          // Un order bump es un agregado, así que muestra solo lo que suma.
          const componentes = o.estrategia === 'combo'
            ? (o.componentes || [])
            : (o.componentes || []).filter(c => c.producto_id !== entidad.id);
          productosIncluidos = componentes.map(c => resolverProducto(c.producto_id)).filter(Boolean);
          productoComplementario = productosIncluidos[0] || null;
        }
        // Los DOS precios (ver Oferta.js). `precio` se mantiene por
        // compatibilidad con lecturas viejas, pero apunta al normal: el
        // promocional del bump nunca debe pisar el precio de venta normal.
        const precioNormal = parseFloat(o.precio_normal ?? o.precio) || 0;
        const precioBump = (o.precio_order_bump === null || o.precio_order_bump === undefined)
          ? null : (parseFloat(o.precio_order_bump) || 0);
        return {
          id: o.id,
          nombre: o.nombre,
          tipo_contenido: o.tipo_contenido,
          estrategia: o.estrategia,
          precio: precioNormal,
          precio_normal: precioNormal,
          precio_order_bump: precioBump,
          // Lo que se cobra realmente si el visitante la acepta por su canal
          // — el frontend muestra ESTO, no adivina cuál de los dos aplica.
          precio_efectivo: esOrderBump ? (precioBump ?? precioNormal) : precioNormal,
          descripcion: o.descripcion || null,
          // Imagen propia de la oferta; si no tiene, el frontend cae a la del
          // producto (no se resuelve acá para no inventar una que no eligió).
          imagen: o.imagen_url || null,
          vigencia: { desde: o.fecha_inicio || null, hasta: o.fecha_fin || null },
          unidades,
          producto_complementario: productoComplementario,
          productos_incluidos: productosIncluidos,
        };
      }) : [];

      // Lo que el comercio personalizó de este producto EN ESTA LANDING
      // (ver overrideDeProducto). Pisa el catálogo global sin tocarlo.
      const override = esCombo ? null : this.overrideDeProducto(landing.content, entidad.id);

      itemsDto.push({
        // ID público estable — nunca LandingItem.id (cambiaría entre landings para el mismo producto).
        content_id: entidad.slug || `${item.tipo}-${entidad.id}`,
        tipo: item.tipo,
        nombre: entidad.nombre,
        descripcion: esCombo ? entidad.descripcion : (override?.descripcion || entidad.descripcion_corta),
        descripcion_larga: esCombo ? null : (override?.descripcion || entidad.descripcion_larga),
        precio: precioEfectivo,
        // Precio fantasía: si está seteado en la landing por el usuario, o en el producto, aparece tachado
        // en la landing indicando el precio original / "antes".
        precio_antes: item.precio_ancla ? parseFloat(item.precio_ancla) : (!esCombo && entidad.precio_tachado ? parseFloat(entidad.precio_tachado) : null),
        // % de descuento calculado desde precio_antes vs precio efectivo.
        // Si no hay precio_antes, descuento_pct = 0 (no se muestra badge).
        descuento_pct: ((item.precio_ancla ? parseFloat(item.precio_ancla) : (!esCombo && entidad.precio_tachado ? parseFloat(entidad.precio_tachado) : null)) > precioEfectivo)
          ? Math.round((1 - precioEfectivo / (item.precio_ancla ? parseFloat(item.precio_ancla) : (!esCombo && entidad.precio_tachado ? parseFloat(entidad.precio_tachado) : null))) * 100)
          : 0,
        imagen: imagenesDto[0] || null,
        imagenes: imagenesDto,
        stock: esCombo ? (productoParaFiltros?.cantidad_disponible ?? null) : entidad.cantidad_disponible,
        variantes: variantesDto,
        ofertas: ofertasDto,
        faq: !esCombo ? (override?.faq || mapaFaq.get(entidad.id) || []) : [],
        faq_titulo: !esCombo ? (override?.faq_titulo || entidad.faq_titulo || null) : null,
        productos_incluidos: esCombo ? (entidad.items || []).map(i => i.producto_incluido?.nombre).filter(Boolean) : undefined,
        // Campos de marketing — solo aplica a productos simples (no combos)
        propuesta_valor: !esCombo ? (entidad.propuesta_valor || null) : null,
        beneficios: !esCombo ? (entidad.beneficios || []) : [],
        confianza: !esCombo ? (entidad.confianza || []) : [],
        preguntas_frecuentes: !esCombo ? (entidad.preguntas_frecuentes || []) : [],
        sobre_este_producto: !esCombo ? (override?.descripcion || entidad.sobre_este_producto || null) : null,
        categoria: productoParaFiltros?.categoria?.nombre || null,
        marca: productoParaFiltros?.Marca?.nombre || null,
        etiqueta: item.etiqueta,
        // Producto.destacado ya existe en el catálogo (lo marca la dueña
        // en el picker de la landing) — los combos nunca son destacados.
        destacado: esCombo ? false : !!entidad.destacado,
        // Fecha real (LandingItem.created_at) para el badge "Nuevo".
        creado: item.createdAt,
        // Solo decide si aparece en "Productos destacados" del home — la
        // página de Catálogo completo (/catalogo) siempre muestra TODOS los
        // items de la landing sin importar este flag (ver más abajo,
        // catalogo_items vs items).
        mostrar_en_inicio: item.mostrar_en_inicio !== false,
      });
    }

    const bannerDto = (landing.mostrar_banner && (landing.banner_titulo || landing.banner_imagen)) ? {
      imagen: landing.banner_imagen,
      titulo: landing.banner_titulo,
      subtitulo: landing.banner_subtitulo,
      boton_texto: landing.banner_boton_texto,
      boton_link: landing.banner_boton_link,
    } : null;
    const testimoniosDto = testimonios.map(t => ({
      nombre: t.nombre,
      foto: t.foto,
      calificacion: t.calificacion,
      comentario: t.comentario,
    }));
    const faqDto = faqs.map(f => ({
      pregunta: f.pregunta,
      respuesta: f.respuesta,
    }));
    const beneficiosDto = beneficios.map(b => ({
      titulo: b.titulo,
      texto: b.texto,
      icono: b.icono || null,
    }));
    // "Productos destacados" del home = solo los items marcados
    // mostrar_en_inicio (default true al agregarlos). La página de
    // Catálogo completo (/catalogo) siempre muestra TODOS los items de la
    // landing — el comercio puede agregar productos que aparezcan solo ahí
    // desde el picker, sin que se cuelen en el home.
    const itemsHomeDto = itemsDto.filter(i => i.mostrar_en_inicio);
    // Los templates rígidos (Fitness/Beauty/Tech/Básico) no usan el
    // constructor de secciones (LandingSeccion) — el render lo decide el
    // frontend público por template.slug, con un componente fijo. Evita el
    // cómputo (y el acoplamiento) del árbol de secciones flexible para
    // esas landings.
    const { secciones, secciones_producto } = esRigida
      ? { secciones: [], secciones_producto: [] }
      : this.construirSeccionesPublicas(landing, {
        items: itemsDto,
        testimonios: testimoniosDto,
        faq: faqDto,
        banner: bannerDto,
      });

    return {
      disponible: true,
      slug: landing.slug,
      es_home: landing.es_home,
      // El front lo usa para saber que en un funnel la landing ES la página
      // del producto (no hay :productId en la URL) — ver LandingPublica.jsx.
      tipo_pagina: landing.tipo_pagina,
      // Contenido propio del embudo (propuesta de valor, CTA, franja de
      // confianza) — ver funnel.service.js#normalizarContent. En el resto
      // de las landings va vacío.
      // Un funnel publica su `content` entero: ahí vive la estructura de
      // bloques del armador que el navegador tiene que renderizar.
      //
      // Una plantilla rígida NO lo publica (es estado del editor: overrides
      // por producto, borradores) — pero sí necesita la configuración de
      // ofertas de checkout. Sin esto `ofertas_carrito`/`ofertas_producto_
      // vista` nunca llegaban al navegador en plantillas rígidas, así que el
      // order bump no aparecía jamás en el checkout ni como sugerencia del
      // carrito, por más que estuviera bien configurado y activo.
      content: esFunnel ? (landing.content || {}) : {
        ofertas_carrito: landing.content?.ofertas_carrito || [],
        ofertas_producto_vista: landing.content?.ofertas_producto_vista || [],
      },
      titulo: landing.titulo,
      descripcion: landing.descripcion,
      // Identidad/contacto propios de los templates rígidos — ver
      // landingSimple.service.js. En landings del sistema flexible quedan
      // en null (columnas nunca escritas ahí). Nombre distinto de
      // "contacto" (más abajo, el contacto heredado de Tienda) a propósito:
      // son dos conceptos distintos, no se pueden fusionar en una clave.
      logo_imagen: landing.logo_imagen || null,
      contacto_landing: {
        whatsapp: landing.contacto_whatsapp || null,
        telefono: landing.contacto_telefono || null,
        email: landing.contacto_email || null,
        direccion: landing.contacto_direccion || null,
        ciudad: landing.contacto_ciudad || null,
        pais: landing.contacto_pais || null,
        horarios: landing.contacto_horarios || null,
        instagram: landing.contacto_instagram || null,
        facebook: landing.contacto_facebook || null,
        tiktok: landing.contacto_tiktok || null,
        youtube: landing.contacto_youtube || null,
        twitter: landing.contacto_twitter || null,
      },
      contenido_titulo: landing.contenido_titulo || null,
      contenido_texto: landing.contenido_texto || null,
      // Título de "Productos destacados" (home) — también lo usa la página
      // de Catálogo completo si el comercio lo personalizó (ver
      // CatalogoPublico.jsx). Faltaba en este DTO: el campo existía en el
      // modelo/editor pero nunca llegaba a la landing pública.
      productos_titulo: landing.productos_titulo || null,
      catalogo_titulo: landing.catalogo_titulo || null,
      catalogo_descripcion: landing.catalogo_descripcion || null,
      beneficios: beneficiosDto,
      template: landing.template ? { slug: landing.template.slug, kind: landing.template.kind } : null,
      tienda: {
        nombre: tienda.nombre,
        subdominio: tienda.subdominio,
      },
      // primario/fondo: null en la landing = hereda el default de Tienda.
      // "claro" nunca hereda el fondo oscuro de la tienda (pensado para
      // dark mode) — si no hay override, usa un neutro claro razonable.
      // Para landings rígidas NUNCA se hereda el color de Tienda: cada una
      // de las 4 tiene su propia paleta por defecto (ver DEFAULT_TEMA en
      // templates/*.jsx del frontend) que el frontend aplica cuando estos
      // 3 campos vienen null. Heredar de Tienda acá mezclaría el branding
      // del sistema flexible con el de un template que nunca lo pidió.
      // Un embudo (esFunnel) es rígido igual que las landings de tienda: su
      // paleta default vive en el FRONTEND por slug de template (ver
      // funnelThemeUtils.js), nunca en Tienda.color_fondo — antes caía en
      // la rama de abajo (pensada para el sistema flexible), que sin
      // landing.tema_modo='claro' terminaba heredando el fondo oscuro de
      // la tienda y el embudo salía negro sin que el comercio lo pidiera.
      tema: (esRigida || esFunnel) ? {
        modo: landing.tema_modo,
        primario: landing.color_primario || null,
        secundario: null,
        fondo: landing.color_fondo || null,
        texto: landing.color_texto || null,
        tarjeta: landing.color_tarjeta || null,
      } : {
        modo: landing.tema_modo,
        primario: landing.color_primario || tienda.color_primario,
        secundario: tienda.color_secundario,
        fondo: landing.color_fondo || (landing.tema_modo === 'claro' ? '#f8fafc' : tienda.color_fondo),
        // texto/tarjeta: sin equivalente en Tienda — null = hereda el
        // default de tema_modo (ver MODOS en landingDiseno.js).
        texto: landing.color_texto || null,
        tarjeta: landing.color_tarjeta || null,
      },
      diseno: {
        radio_bordes: landing.radio_bordes,
        fuente: landing.fuente,
      },
      filtros: {
        categoria: landing.mostrar_filtro_categoria,
        marca: landing.mostrar_filtro_marca,
        etiqueta: landing.mostrar_filtro_etiqueta,
        buscador: landing.mostrar_buscador,
        orden_precio: landing.mostrar_orden_precio,
      },
      contacto: {
        // mostrar_whatsapp=false apaga el botón de contacto de ESTA
        // landing puntual sin tocar el número configurado a nivel tienda
        // (que puede seguir usándose en las demás landings).
        whatsapp: landing.mostrar_whatsapp ? (tienda.whatsapp || null) : null,
        telefono: tienda.telefono,
        mensaje: tienda.mensaje_contacto,
        incluir_precio: !!landing.whatsapp_incluir_precio,
        incluir_url: !!landing.whatsapp_incluir_url,
      },
      // Qué pasa después de crear el pedido — ver CartDrawer.jsx.
      checkout: {
        redirigir_whatsapp: !!landing.checkout_redirigir_whatsapp,
      },
      // null si está apagado o si no se cargó ni imagen ni título — así el
      // frontend público no tiene que repetir esa condición.
      banner: bannerDto,
      seo: {
        titulo: landing.seo_titulo || landing.titulo,
        descripcion: landing.seo_descripcion || landing.descripcion || null,
        keywords: landing.seo_keywords || null,
        // Sin imagen OG propia, usa el banner — casi siempre es la imagen
        // más representativa que ya cargó la usuaria para esta landing.
        og_imagen: landing.seo_og_imagen || landing.banner_imagen || null,
      },
      // Solo lo que necesita el navegador para inicializar pixels y
      // decidir si vale la pena llamar a /eventos — nunca meta_access_token
      // ni meta_test_event_code (ese es un dato de depuración de la dueña
      // de la tienda, no del visitante público).
      //
      // test_event_code se devolvía acá pese a lo que decía este mismo
      // comentario: cualquiera que abriera la landing lo leía y podía
      // inyectar eventos falsos al stream de Test Events de la tienda. El
      // lado CAPI lo sigue mandando desde el servidor (metaCapi.service.js),
      // que es donde corresponde: la herramienta de prueba de Meta funciona
      // igual, sin que el código viaje al navegador.
      meta: {
        pixel_id: tienda.meta_pixel_id || null,
        capi_activo: !!tienda.meta_capi_activo,
        google_analytics_id: tienda.google_analytics_id || null,
        tiktok_pixel_id: tienda.tiktok_pixel_id || null,
      },
      items: esRigida ? itemsHomeDto : itemsDto,
      catalogo_items: itemsDto,
      secciones: secciones,
      secciones_producto: secciones_producto,
      testimonios: testimoniosDto,
      faq: faqDto,
      // Para que el header pueda armar links tipo "Página" entre Inicio/
      // Catálogo/Contacto (ver HeaderInspector.jsx/HeaderBlock.jsx) — solo
      // lo mínimo para resolver un href, nada de contenido de la otra
      // página. slug=null en 'inicio' a propósito: la home se resuelve
      // siempre en la raíz del hostname (GET /api/l/ sin slug), nunca por
      // su propio slug — igual que el resto de esta función.
      paginas_hermanas: (await Landing.findAll({
        where: { tienda_id: tienda.id, activo: true },
        attributes: ['tipo_pagina', 'slug', 'titulo', 'nombre'],
      })).map(p => ({
        tipo_pagina: p.tipo_pagina,
        slug: p.tipo_pagina === 'inicio' ? null : p.slug,
        titulo: p.titulo || p.nombre,
      })),
    };
  }

  /**
   * Personalización de un producto hecha DENTRO de esta landing.
   *
   * Vive en Landing.content.productos["<id>"] y pisa lo que trae el catálogo
   * global. Existe porque un Producto es compartido por todo el inquilino:
   * si el armador de landings escribiera la descripción/FAQ/relacionados
   * sobre el Producto, un comercio le cambiaría la ficha a todos los demás
   * (y encima chocaba con la regla de "solo podés editar productos que
   * creaste", que dejaba a medio mundo sin poder tocar su propia landing).
   *
   * Forma: { descripcion, faq_titulo, faq: [{pregunta,respuesta}],
   *          relacionados_titulo, relacionados: [productoId] }
   * Cualquier clave ausente cae al valor del producto.
   */
  static overrideDeProducto(contenidoLanding, productoId) {
    const porProducto = contenidoLanding?.productos;
    if (!porProducto || typeof porProducto !== 'object' || Array.isArray(porProducto)) return null;
    return porProducto[String(productoId)] || null;
  }

  static async obtenerProductoPublico(tienda, slug, productoSlug) {
    const landing = await this.obtenerPublica(tienda, slug);
    if (landing === null) return null;
    if (!landing.disponible) return landing;

    // catalogo_items, no items: en las plantillas rígidas `items` son solo
    // los destacados del home y `catalogo_items` el catálogo completo (ver
    // obtenerPublica). Buscar acá contra `items` devolvía 404 en la página de
    // cualquier producto que estuviera en el catálogo sin estar destacado —
    // justo los que el catálogo linkea. mostrar_en_inicio decide dónde
    // aparece un producto, nunca si su página existe.
    const catalogoCompleto = landing.catalogo_items?.length ? landing.catalogo_items : (landing.items || []);
    const item = catalogoCompleto.find(i => i.content_id === productoSlug);
    if (!item) return null;

    // Diseño propio del producto (ver LandingSeccion.producto_id): es una
    // propiedad DEL PRODUCTO, no de la página/landing desde la que se
    // navegó a él — por eso se busca sin filtrar por landing_id. Si no
    // existe ninguna, se deja `secciones_producto` tal cual vino de
    // obtenerPublica() (la plantilla compartida de siempre).
    let seccionesProducto = landing.secciones_producto;
    // "Productos relacionados" — manual (productos_relacionados) o
    // automático por categoria_id si no hay curación (ver
    // ProductoService.listarRelacionados). Antes esta tabla solo se
    // escribía al crear el producto y nunca llegaba a ningún lado.
    let relacionados = { titulo: null, automatico: false, items: [] };
    if (item.tipo === 'producto') {
      const producto = await Producto.findOne({
        where: { slug: productoSlug, inquilino_id: tienda.inquilino_id },
        attributes: ['id'],
      });
      if (producto) {
        // Los relacionados elegidos EN ESTA LANDING mandan sobre la curación
        // global del producto — ver overrideDeProducto().
        const override = this.overrideDeProducto(landing.content, producto.id);
        const [propias, relacionadosDto] = await Promise.all([
          LandingSeccion.findAll({
            where: { producto_id: producto.id, page_type: 'product', activo: true },
            order: [['orden', 'ASC']],
          }),
          require('./producto.service').listarRelacionados(producto.id, tienda.inquilino_id, {
            idsForzados: Array.isArray(override?.relacionados) ? override.relacionados : null,
            titulo: override?.relacionados_titulo || null,
          }).catch(() => relacionados),
        ]);
        if (propias.length > 0) {
          seccionesProducto = propias.map(s => this.seccionDto(s));
        }
        relacionados = relacionadosDto;
        
        // Inyectar el precio ancla y etiqueta de la landing actual a los productos relacionados
        if (relacionados && relacionados.items && landing.items) {
          relacionados.items = relacionados.items.filter(relItem => 
            landing.items.some(i => i.content_id === relItem.slug || (Number(i.referencia_id) === Number(relItem.id) && i.tipo === 'producto'))
          ).map(relItem => {
            const lItem = landing.items.find(i => i.content_id === relItem.slug || (Number(i.referencia_id) === Number(relItem.id) && i.tipo === 'producto'));
            if (lItem) {
              return {
                ...relItem,
                precio_ancla: lItem.precio_ancla || relItem.precio_tachado || null,
                etiqueta: lItem.etiqueta || null
              };
            }
            return relItem;
          });
        }
      }
    }

    return {
      ...landing,
      secciones_producto: seccionesProducto,
      producto: item,
      relacionados,
      seo: {
        titulo: item.nombre,
        descripcion: item.descripcion_larga || item.descripcion || landing.seo?.descripcion || null,
        keywords: landing.seo?.keywords || null,
        og_imagen: item.imagen || landing.seo?.og_imagen || null,
      },
    };
  }

  /**
   * Núcleo de resolución de carrito compartido por crearCheckout() (crea
   * el Envío) y recalcularCarrito() (solo lectura, para el recálculo en
   * vivo del carrito/checkout del frontend) — una sola implementación
   * para que "lo que se muestra" y "lo que se cobra" nunca puedan
   * desincronizarse. Nunca se confía en precio/monto que mande el
   * cliente: todo se resuelve contra el catálogo real vía PricingService
   * (mismo motor que usa obtenerPublica()).
   *
   * Tampoco se acepta cualquier content_id: solo los que están curados de
   * verdad en ESTA landing (mismo principio que ya aplica
   * obtenerCatalogoParaEvento()/limpiarItems() para el tracking de eventos)
   * — lo que mande el cliente fuera de ese conjunto se ignora en silencio.
   *
   * @param {object} tienda - instancia de Tienda ya resuelta (con Usuario incluido).
   * @param {string|null} slug - null/undefined → landing es_home de la tienda.
   * @param {Array} items - [{content_id, variante_id?, oferta_id?, cantidad}]
   * @param {boolean} throwOnStockInsuficiente - true en crearCheckout (corta
   *   con 409); false en recalcularCarrito (informa stock_suficiente:false
   *   en el item sin bloquear, para que el frontend avise sin interrumpir).
   * @returns {{landing, itemsResueltos}}
   */
  static async resolverCarrito(tienda, slug, items, throwOnStockInsuficiente = false) {
    const where = { tienda_id: tienda.id };
    if (slug) where.slug = slug; else where.es_home = true;

    const landing = await Landing.findOne({ where, include: [{ model: LandingItem, as: 'items' }] });
    if (!landing) throw new Error('Landing no encontrada.');
    if (!landing.activo || !tienda.activo || !tienda.Usuario?.activo) throw new Error('Esta landing no está disponible.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('El carrito está vacío.');
    if (items.length > MAX_ITEMS_CHECKOUT) throw new Error(`No se pueden pedir más de ${MAX_ITEMS_CHECKOUT} ítems distintos.`);

    const landingItems = landing.items || [];
    
    // FASE 5: Commerce Engine Integration para Funnels
    // Inyectamos el producto principal del funnel para que el motor valide y
    // apruebe tanto el producto ancla como sus Order Bumps agregados al carrito.
    if (landing.tipo_pagina === 'funnel' && landing.producto_id) {
      if (!landingItems.find(i => i.tipo === 'producto' && i.referencia_id === landing.producto_id)) {
        landingItems.push({ tipo: 'producto', referencia_id: landing.producto_id, createdAt: landing.createdAt });
      }
    }
    
    const idsProducto = landingItems.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = landingItems.filter(i => i.tipo === 'combo').map(i => i.referencia_id);

    const [productos, combos, ofertasDisponibles] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({ where: { id: { [Op.in]: idsProducto }, activo: true, estado_venta: 'en_venta' } })
        : Promise.resolve([]),
      idsCombo.length
        ? ProductoCombo.findAll({
          where: { id: { [Op.in]: idsCombo }, estado: 'ACTIVO' },
          include: [{ model: Producto, as: 'producto_padre', where: { activo: true } }],
        })
        : Promise.resolve([]),
      idsProducto.length
        ? Oferta.findAll({
          where: { producto_ancla_id: { [Op.in]: idsProducto }, activo: true },
          include: [{ 
            model: OfertaComponente, 
            as: 'componentes',
            include: [{
              model: Producto,
              as: 'producto',
              attributes: ['id', 'nombre', 'sku', 'precio_costo', 'cantidad_disponible'],
              include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }]
            }]
          }],
        })
        : Promise.resolve([]),
    ]);

    const referenciasProducto = productos.map(p => p.id);
    const referenciasCombo = combos.map(c => c.id);

    const [precios, variantes] = await Promise.all([
      PrecioUsuario.findAll({
        where: {
          usuario_id: tienda.usuario_id,
          [Op.or]: [
            { tipo: 'producto', referencia_id: { [Op.in]: referenciasProducto.length ? referenciasProducto : [-1] } },
            { tipo: 'combo', referencia_id: { [Op.in]: referenciasCombo.length ? referenciasCombo : [-1] } },
          ],
        },
      }),
      idsProducto.length
        ? ProductoVariante.findAll({ where: { producto_id: { [Op.in]: idsProducto }, activo: true } })
        : Promise.resolve([]),
    ]);

    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));
    const mapaVariantes = new Map();
    variantes.forEach(v => {
      const lista = mapaVariantes.get(v.producto_id) || [];
      lista.push(v);
      mapaVariantes.set(v.producto_id, lista);
    });
    const mapaProducto = new Map(productos.map(p => [p.id, p]));
    const mapaCombo = new Map(combos.map(c => [c.id, c]));

    // Mapa SOLO para chequear stock. Va aparte de `mapaProducto` a
    // propósito: ese decide qué se puede comprar en esta landing y no puede
    // crecer, o un visitante podría pedir un producto que no está curado
    // acá. Este, en cambio, tiene que incluir los componentes de las ofertas
    // — un order bump ofrece cualquier producto del catálogo, no solo los de
    // la landing, y sin esto su stock no se validaba contra nada. Los
    // productos ya vienen cargados en el include de las ofertas, así que no
    // cuesta ninguna consulta extra.
    const mapaStock = new Map(mapaProducto);
    ofertasDisponibles.forEach(o => (o.componentes || []).forEach(c => {
      if (c.producto && !mapaStock.has(c.producto.id)) mapaStock.set(c.producto.id, c.producto);
    }));

    // content_id público (slug || "<tipo>-<id>") → item real de ESTA
    // landing — mismo identificador que le entrega obtenerPublica() al
    // navegador, así el carrito arma sus items con el mismo id que acá.
    const mapaPorContentId = new Map();
    for (const li of landingItems) {
      const entidad = li.tipo === 'producto' ? mapaProducto.get(li.referencia_id) : mapaCombo.get(li.referencia_id);
      if (!entidad) continue;
      mapaPorContentId.set(entidad.slug || `${li.tipo}-${entidad.id}`, { entidad, esCombo: li.tipo === 'combo' });
    }

    const itemsResueltos = [];
    for (const pedido of items) {
      const itemLanding = mapaPorContentId.get(pedido?.content_id);
      if (!itemLanding) continue; // no está curado en esta landing — se descarta, nunca se inventa.
      const { entidad, esCombo } = itemLanding;

      const precioUsuario = mapaPrecios.get(`${esCombo ? 'combo' : 'producto'}:${entidad.id}`);
      // "La cantidad decide el precio" (ver PricingService.mejorOfertaParaCantidad):
      // si no vino oferta_id explícita, el motor busca solo si la cantidad
      // matchea un pack existente de este producto.
      const ofertasDelProducto = esCombo ? [] : ofertasDisponibles.filter(o => o.producto_ancla_id === entidad.id);
      const variantesDelProducto = esCombo ? [] : (mapaVariantes.get(entidad.id) || []);

      const resuelto = PricingService.resolverPrecioItem({
        entidad,
        esCombo,
        cantidad: pedido.cantidad,
        ofertaId: !esCombo ? pedido.oferta_id : null,
        varianteId: !esCombo ? pedido.variante_id : null,
        precioUsuario,
        ofertasDelProducto,
        variantesDelProducto,
      });

      // La "oferta" tiene una receta completa de componentes (puede tocar
      // más de un producto), por eso usa su propio chequeo en vez del
      // genérico de cantidad simple.
      const { suficiente, faltantes } = PricingService.validarStock(resuelto, { mapaProducto: mapaStock });
      if (!suficiente && throwOnStockInsuficiente) {
        const primero = faltantes[0];
        const err = new Error(`"${resuelto.nombre_final}" no tiene stock suficiente (disponible: ${primero.disponible}).`);
        err.status = 409;
        throw err;
      }

      itemsResueltos.push({
        content_id: pedido.content_id,
        // Se hace eco de lo que pidió el cliente (no de lo resuelto) para
        // que el frontend pueda correlacionar la respuesta con SU línea de
        // carrito exacta — un mismo content_id puede tener varias líneas
        // con distinta variante (ver claveCarrito en LandingPublica.jsx).
        variante_id_solicitada: !esCombo && pedido.variante_id ? Number(pedido.variante_id) : null,
        oferta_id_solicitada: !esCombo && pedido.oferta_id ? Number(pedido.oferta_id) : null,
        // Los combos no tienen fila propia en Producto — igual que ya pasa
        // con los pedidos cargados a mano (ver envioController.js), un
        // EnvioItem sin producto_id no participa del descuento de stock al
        // confirmar (el "stock" de un combo lo da su producto_padre, no
        // hay campo propio que descontar).
        producto_id: esCombo ? null : entidad.id,
        oferta_id: resuelto.oferta_aplicada ? resuelto.oferta_aplicada.id : null,
        oferta_codigo: resuelto.oferta_aplicada ? resuelto.oferta_aplicada.codigo : null,
        oferta_nombre: resuelto.oferta_aplicada ? resuelto.oferta_aplicada.nombre : null,
        nombre_producto: resuelto.nombre_final,
        cantidad: resuelto.cantidad,
        precio_unitario: resuelto.precio_unitario,
        // Canal y precio de referencia — con esto la reportería separa la
        // venta incremental (order bump / combo de checkout) de la venta
        // normal sin volver a unir contra la oferta, que puede editarse o
        // darse de baja después (ver migrations/add_precios_order_bump.sql).
        origen_venta: resuelto.origen_venta,
        precio_normal: resuelto.precio_normal,
        subtotal: resuelto.subtotal,
        stock_suficiente: suficiente,
      });
    }

    if (!itemsResueltos.length) throw new Error('Ningún producto del carrito está disponible en esta landing.');

    return { landing, itemsResueltos };
  }

  /**
   * Recálculo de carrito en vivo — SOLO LECTURA, no crea ningún Envío. Lo
   * usa el frontend cada vez que cambia cantidad/variante/oferta, para
   * mostrar el precio real (mismo PricingService que crearCheckout) antes
   * de llegar al submit final del formulario.
   *
   * @returns {{items: Array, subtotal: number, total: number}}
   */
  static async recalcularCarrito(tienda, slug, items) {
    const { itemsResueltos } = await this.resolverCarrito(tienda, slug, items, false);
    const subtotal = itemsResueltos.reduce((s, i) => s + i.subtotal, 0);
    return { items: itemsResueltos, subtotal, total: subtotal };
  }

  /**
   * Checkout público — crea un Envío (Pedido) real en estado "Pendiente" a
   * partir de lo que completó un visitante anónimo. Es un endpoint sin
   * autenticación, por eso resolverCarrito() nunca confía en precio/monto
   * del cliente.
   *
   * No descuenta stock acá — recién se compromete al pasar a "Confirmado"
   * (ver envioController.updateEstado), porque este endpoint es público y
   * sin ninguna verificación: descontar al crear expondría el stock real a
   * cualquiera que complete el formulario sin intención de compra.
   *
   * @param {object} tienda - instancia de Tienda ya resuelta (con Usuario incluido).
   * @param {string|null} slug - null/undefined → landing es_home de la tienda.
   * @param {object} datosCliente - { nombre_cliente, ruc, telefono, ciudad, departamento, direccion, referencia, items }
   * @returns {{pedido_id: number, monto: number, redirigir_whatsapp: boolean}}
   */
  static async crearCheckout(tienda, slug, datosCliente) {
    const { nombre_cliente, ruc, razon_social, quiere_factura, telefono, ciudad, departamento, direccion, referencia, items } = datosCliente || {};

    if (!nombre_cliente?.trim()) throw new Error('El nombre y apellido es obligatorio.');
    if (!telefono?.trim()) throw new Error('El celular es obligatorio.');
    if (!ciudad?.trim()) throw new Error('La ciudad es obligatoria.');
    if (!direccion?.trim()) throw new Error('La dirección es obligatoria.');

    const { landing, itemsResueltos } = await this.resolverCarrito(tienda, slug, items, true);

    const monto = itemsResueltos.reduce((s, i) => s + i.subtotal, 0);
    const ahora = new Date();
    // Fechas y horas en zona horaria de Paraguay (America/Asuncion)
    const fechaPy = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' }); // YYYY-MM-DD
    const horaPy = ahora.toLocaleTimeString('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit' });

    const tieneFactura = Boolean(quiere_factura || (ruc && String(ruc).trim()));
    const rucLimpio = ruc?.trim() || null;
    const razonSocialLimpia = razon_social?.trim() || (tieneFactura ? nombre_cliente.trim() : null);

    // itemsResueltos trae content_id/stock_suficiente además de los campos
    // de EnvioItem — se filtran acá para que el nested-create no dependa
    // de que Sequelize ignore claves extra en silencio.
    const itemsParaEnvio = itemsResueltos.map(({ producto_id, oferta_id, oferta_codigo, oferta_nombre, nombre_producto, cantidad, precio_unitario, precio_normal, origen_venta, subtotal }) => ({
      producto_id, oferta_id, oferta_codigo, oferta_nombre, nombre_producto, cantidad, precio_unitario, precio_normal, origen_venta, subtotal,
    }));

    const nuevoEnvio = await Envio.create({
      usuario_id: tienda.usuario_id,
      cliente: nombre_cliente.trim(),
      nombre_cliente: nombre_cliente.trim(),
      apellido_cliente: null,
      quiere_factura: tieneFactura,
      ruc: rucLimpio,
      razon_social: razonSocialLimpia,
      telefono: telefono.trim(),
      ciudad: ciudad.trim(),
      departamento: departamento?.trim() || null,
      direccion: direccion.trim(),
      referencia: referencia?.trim() || null,
      monto,
      costo_envio: 0,
      metodo_pago: 'Efectivo',
      estado: 'Pendiente',
      estado_logistico: 'Pendiente',
      // No 'Confirmado' (el default del modelo, pensado para carga manual
      // por personal de confianza) — acá nadie revisó todavía el pedido.
      estado_comercial: 'Pendiente',
      origen: 'LANDING',
      fecha: fechaPy,
      // El Kanban de Courier filtra "envíos del día" por ESTE campo, no por
      // "fecha" — sin setearlo, el pedido queda invisible en el tablero
      // sin importar qué fecha se elija (bug real: así se creó el #46).
      dispatchedAt: fechaPy,
      hora: horaPy,
      items: itemsParaEnvio,
    }, { include: [{ model: EnvioItem, as: 'items' }] });

    await registrarHistorial(nuevoEnvio.id, null, 'Pedido creado automáticamente');

    return {
      pedido_id: nuevoEnvio.id,
      monto,
      redirigir_whatsapp: !!landing.checkout_redirigir_whatsapp,
    };
  }

  /**
   * Fase 2: Instanciar Landing desde Template
   */
  static async instanciarDesdeTemplate(inquilinoId, tiendaId, productoId, templateId) {
    const { LandingTemplate } = require('../models');
    const template = await LandingTemplate.findByPk(templateId);
    if (!template) {
      throw new Error('El template seleccionado no existe.');
    }

    // tiendaId ya viene resuelto por usuario_id (resolverTiendaPropia en el
    // controller) — buscar de nuevo solo por inquilino_id acá sería volver
    // a introducir el bug: un tenant puede tener más de una Tienda.
    const tienda = await Tienda.findOne({ where: { id: tiendaId, inquilino_id: inquilinoId } });
    if (!tienda) {
      throw new Error('Tienda no encontrada.');
    }

    const producto = await Producto.findOne({ where: { id: productoId, inquilino_id: inquilinoId } });
    if (!producto) {
      throw new Error('Producto no encontrado.');
    }

    // Idempotencia: Verificar si ya existe una landing para este producto
    let landing = await Landing.findOne({
      where: { tienda_id: tienda.id, producto_id: productoId }
    });

    if (landing) {
      // Actualizar la existente (si el comercio cambia de idea y elige otro funnel)
      await landing.update({
        template_id: template.id,
        template_version: template.version,
        tipo_pagina: 'funnel',
        content: landing.template_id !== template.id ? {} : landing.content,
      });
    } else {
      // Crear nueva instancia de landing
      const slugBase = `p-${producto.id}-${crypto.randomBytes(3).toString('hex')}`;
      
      landing = await Landing.create({
        inquilino_id: inquilinoId,
        tienda_id: tienda.id,
        producto_id: producto.id,
        nombre: `Funnel: ${producto.nombre} (${template.name})`,
        slug: slugify(slugBase, { lower: true, strict: true }),
        es_home: false,
        tipo_pagina: 'funnel',
        template_id: template.id,
        template_version: template.version,
        activo: false, // Inicia como borrador
        content: {}, // Contenido vacío que llenará el wizard
      });
    }

    return {
      message: 'Funnel configurado con éxito',
      landing_id: landing.id,
      slug: landing.slug,
      template_id: template.id,
      schema: template.schema,
      content: landing.content
    };
  }

  // Phase 4: Schema-driven endpoints for Merchant Editor
  static async obtenerLandingProducto(producto_id, tienda_id) {
    const { LandingTemplate } = require('../models');
    const landing = await Landing.findOne({
      where: { producto_id, tienda_id },
      include: [{
        model: LandingTemplate,
        as: 'template',
        attributes: ['id', 'name', 'funnel_type', 'schema', 'design_tokens']
      }]
    });
    return landing;
  }

  static async guardarLandingProducto(producto_id, tienda_id, content) {
    const landing = await Landing.findOne({ where: { producto_id, tienda_id } });
    if (!landing) throw new Error('Landing no encontrada para este producto.');
    
    // Solo permitimos actualizar el content
    landing.content = content || {};
    await landing.save();
    return landing;
  }
}

module.exports = LandingService;
