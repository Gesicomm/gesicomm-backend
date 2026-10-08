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
  ProductoComboImagen, ProductoImagen, ProductoVariante, ProductoOpcion, ProductoOpcionValor, ProductoFaq, LandingSeccion, LandingEvento, Testimonio, Faq, LandingBeneficio, Envio, EnvioItem,
  Oferta, OfertaComponente, Tienda, LandingTemplate, Categoria, sequelize
} = require('../models');
const { resolverRangoFechas } = require('../utils/rangoFechas');
const { registrarHistorial } = require('../utils/historial');
const PricingService = require('./pricing.service');
const TarifaDeliveryService = require('./tarifaDelivery.service');
const FulfillmentService = require('./fulfillment.service');
const PaymentService = require('./payments/paymentService');
const CanalVentaService = require('./canalVenta.service');
const CuponService = require('./cupon.service');
const PedidoNumeracion = require('./pedidoNumeracion.service');
const MetaCapiService = require('./metaCapi.service');
const ImagenService = require('./imagen.service');
const PrecioUsuarioService = require('./precioUsuario.service');
const TypographyService = require('./typography.service');
const PaymentLogoService = require('./paymentLogo.service');

const MAX_ITEMS_POR_LANDING = 40;
const MAX_TESTIMONIOS_POR_LANDING = 20;
const MAX_FAQ_POR_LANDING = 20;
const MAX_SECCIONES_POR_LANDING = 30;
const MAX_ITEMS_CHECKOUT = 40;
// Lienzo en blanco (landing HTML): la lista MANUAL puede ser mucho más
// larga que la de un template, porque la landing ya no la arma entera en
// cada visita — ver PRIMERA_PAGINA_LIENZO. Con "todos" o "por categoría"
// no hay lista: es una regla y no tiene tope (ver itemsDelLienzo).
const MAX_ITEMS_LIENZO = 500;
// Cuántos productos del lienzo se arman COMPLETOS (galería, variantes,
// ofertas, FAQ) en la respuesta de la landing. El resto se pide paginado a
// obtenerCatalogoPublico, que trae imágenes solo de la página pedida.
const PRIMERA_PAGINA_LIENZO = 24;
const ATRIBUTOS_IMAGEN_PRODUCTO = [
  'id', 'producto_id', 'variante_id', 'url', 'storage_key', 'es_principal', 'orden',
  'width', 'height', 'visual_modo', 'focal_x', 'focal_y', 'optimizacion_json',
];
// MVP: una sola landing por tienda, siempre en la raíz (es_home=true) — no
// hay UI para elegir slug ni marcar "página principal", así que una
// segunda landing quedaría inaccesible igual. Multi-landing por tienda
// queda para si el negocio lo pide más adelante; multi-TIENDA por cliente
// es el eje que sí está planeado (ver Tienda.js).
const MAX_LANDINGS_POR_TIENDA = 1;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_ID_RE = /^(outfit|inter|poppins|roboto|montserrat|lato|playfair-display|custom:\d+)$/;
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
  'productos_recomendados',
  'cta',
  'image_text',
  'logo_list',
  'before_after',
  'scrolling_text',
  'producto_galeria',
]);

const SECCIONES_PRODUCTO_DEFECTO = [
  { tipo: 'announcement_bar', nombre_interno: 'Barra superior', activo: true, orden: 0, config_json: {}, contenido_json: { texto: 'Bienvenidos a nuestra tienda!' } },
  { tipo: 'header', nombre_interno: 'Header', activo: true, orden: 10, config_json: {}, contenido_json: {} },
  { tipo: 'product_detail', nombre_interno: 'Detalle de Producto', activo: true, orden: 20, config_json: {}, contenido_json: {} },
  { tipo: 'testimonios', nombre_interno: 'Opiniones', activo: true, orden: 30, config_json: {}, contenido_json: { titulo: 'Opiniones de clientes' } },
  {
    tipo: 'productos_recomendados',
    nombre_interno: 'Productos recomendados',
    activo: true,
    orden: 40,
    config_json: {},
    contenido_json: {
      titulo: 'También te puede interesar',
      subtitulo: 'Productos elegidos para complementar esta compra.',
      cta_texto: 'Ver producto',
    },
  },
  { tipo: 'footer', nombre_interno: 'Footer', activo: true, orden: 50, config_json: {}, contenido_json: {} },
];

const SECCIONES_CATALOGO_DEFECTO = [
  { tipo: 'announcement_bar', nombre_interno: 'Barra superior', activo: true, orden: 0, config_json: {}, contenido_json: { texto: 'Bienvenidos a nuestra tienda!' } },
  { tipo: 'header', nombre_interno: 'Header', activo: true, orden: 10, config_json: { sticky: true, mostrar_busqueda: true, mostrar_carrito: true }, contenido_json: {} },
  { tipo: 'productos', nombre_interno: 'Productos', activo: true, orden: 20, config_json: {}, contenido_json: { titulo: 'Todos los productos' } },
  { tipo: 'footer', nombre_interno: 'Footer', activo: true, orden: 30, config_json: {}, contenido_json: {} },
];

/** Los colores de Branding de Mi Tienda, para las landings HTML. */
function coloresDeTienda(tienda) {
  return {
    primario: tienda.color_primario || null,
    secundario: tienda.color_secundario || null,
    fondo: tienda.color_fondo || null,
  };
}

function normalizarTipografiaLanding(value) {
  if (!value || typeof value !== 'object' || value.mode === 'inherit') {
    return null;
  }
  const headingFont = String(value.headingFont || '').trim();
  const bodyFont = String(value.bodyFont || '').trim();
  if (!FONT_ID_RE.test(headingFont) || !FONT_ID_RE.test(bodyFont)) {
    const err = new Error('Validación fallida.');
    err.errores = ['La tipografía de la landing no es válida.'];
    throw err;
  }
  return { mode: 'custom', headingFont, bodyFont };
}

class LandingService {

  /**
   * Contacto público de una landing: lo propio de la landing y, campo por
   * campo, lo de la Tienda (onboarding / Configurar tienda) donde la
   * landing no cargó nada. Así una landing nueva — o una de "Lienzo en
   * blanco", que no tiene panel de contacto — sale con las redes de la
   * tienda sin volver a tipearlas.
   */
  static contactoLandingDto(landing, tienda) {
    const de = (propio, heredado) => propio || heredado || null;
    return {
      whatsapp: de(landing.contacto_whatsapp, tienda?.whatsapp),
      telefono: de(landing.contacto_telefono, tienda?.telefono),
      email: de(landing.contacto_email, tienda?.email),
      direccion: de(landing.contacto_direccion, tienda?.direccion_publica),
      ciudad: de(landing.contacto_ciudad, tienda?.ciudad_publica),
      pais: landing.contacto_pais || null,
      horarios: de(landing.contacto_horarios, tienda?.horario_atencion),
      instagram: de(landing.contacto_instagram, tienda?.instagram),
      facebook: de(landing.contacto_facebook, tienda?.facebook),
      tiktok: de(landing.contacto_tiktok, tienda?.tiktok),
      youtube: de(landing.contacto_youtube, tienda?.youtube),
      twitter: de(landing.contacto_twitter, tienda?.twitter),
      nombre: tienda?.nombre_contacto || null,
      canal: tienda?.canal_contacto || null,
    };
  }

  // Las tarifas de delivery se resuelven en un \u00fanico lugar
  // (TarifaDeliveryService). Ac\u00e1 quedan s\u00f3lo los puentes para no cambiar los
  // call sites internos de este service.
  static normalizarTextoDelivery(valor) {
    return TarifaDeliveryService.normalizarTexto(valor);
  }

  // Pasa por el fulfillment, no directo al motor de tarifas: según la
  // modalidad del comercio la cobertura sale de sus propios couriers o de los
  // de Gesicomm (ver fulfillment.service).
  static async obtenerOpcionesDelivery(usuarioId, opciones = {}) {
    return FulfillmentService.resolverOpcionesDeEntrega(usuarioId, opciones);
  }

  static buscarOpcionDelivery(opciones, ciudad, departamento) {
    return TarifaDeliveryService.buscarOpcion(opciones, ciudad, departamento);
  }

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
      envio_incluido: item.envio_incluido === true,
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
    // Reemplazo en bloque = cualquier foto que tenía un testimonio viejo y
    // no sobrevive en el payload nuevo queda huérfana en R2 si no se limpia
    // acá — es el único lugar por donde pasan todos los cambios (reemplazar
    // la foto de un testimonio existente, o sacarlo de la lista).
    const nuevasFotos = new Set(testimonios.map(t => t.foto).filter(Boolean));
    const actuales = await Testimonio.findAll({ where: { landing_id }, attributes: ['foto'] });
    const fotosHuerfanas = [...new Set(actuales.map(t => t.foto).filter(foto => foto && !nuevasFotos.has(foto)))];

    await Testimonio.destroy({ where: { landing_id } });
    if (testimonios.length) {
      await Testimonio.bulkCreate(testimonios.map((t, idx) => ({
        landing_id,
        nombre: t.nombre.trim(),
        foto: t.foto || null,
        calificacion: Number(t.calificacion),
        comentario: t.comentario.trim(),
        orden: t.orden !== undefined ? Number(t.orden) : idx,
      })));
    }

    for (const foto of fotosHuerfanas) {
      await ImagenService.eliminarObjetoStorage({ url: foto });
    }
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

  static completarSeccionesProductoPublicas(secciones = [], fuenteLanding = []) {
    const lista = Array.isArray(secciones) ? [...secciones] : [];
    const tipos = new Set(lista.map(s => s.tipo));
    const heredables = new Map((fuenteLanding || [])
      .filter(s => ['announcement_bar', 'header', 'footer'].includes(s.tipo))
      .map(s => [s.tipo, s]));
    const faltantes = SECCIONES_PRODUCTO_DEFECTO
      .filter(s => !tipos.has(s.tipo))
      .map((s, idx) => {
        const heredada = heredables.get(s.tipo);
        return this.seccionDto({
          ...s,
          ...(heredada ? {
            config_json: heredada.config || heredada.config_json || {},
            contenido_json: heredada.contenido || heredada.content_json || heredada.contenido_json || {},
            activo: heredada.activo !== false,
            nombre_interno: heredada.nombre_interno || s.nombre_interno,
            template_id: heredada.template || heredada.template_id || s.template_id,
          } : {}),
          id: null,
          stable_id: `producto-default-${s.tipo}`,
          orden: 1000 + idx,
          page_type: 'product',
        });
      });

    if (!faltantes.length) return lista;

    const indiceFooter = lista.findIndex(s => s.tipo === 'footer');
    const destino = indiceFooter >= 0 ? indiceFooter : lista.length;
    lista.splice(destino, 0, ...faltantes);
    return lista.map((s, idx) => ({ ...s, orden: idx }));
  }

  static completarSeccionesCatalogoPublicas(secciones = [], fuenteInicio = []) {
    const lista = Array.isArray(secciones) ? [...secciones] : [];
    const existentes = new Map(lista.map(s => [s.tipo, s]));
    const tiposDefault = new Set(SECCIONES_CATALOGO_DEFECTO.map(s => s.tipo));
    const heredables = new Map((fuenteInicio || [])
      .filter(s => !s.page_type || s.page_type === 'landing')
      .filter(s => ['announcement_bar', 'header', 'footer'].includes(s.tipo))
      .map(s => [s.tipo, s]));

    const resultado = SECCIONES_CATALOGO_DEFECTO.map((def, idx) => {
      const actual = existentes.get(def.tipo) || this.seccionDto({
        ...def,
        id: null,
        stable_id: `catalogo-default-${def.tipo}`,
        page_type: 'landing',
        orden: idx,
      });
      const heredada = heredables.get(def.tipo);
      if (!heredada) return actual;
      return {
        ...actual,
        config: heredada.config || heredada.config_json || {},
        contenido: heredada.contenido || heredada.content_json || heredada.contenido_json || {},
        settings_json: heredada.settings_json || heredada.config_json || heredada.config || {},
        content_json: heredada.content_json || heredada.contenido_json || heredada.contenido || {},
        activo: heredada.activo !== false,
        nombre_interno: heredada.nombre_interno || actual.nombre_interno,
        template: heredada.template || heredada.template_id || actual.template,
        template_id: heredada.template_id || heredada.template || actual.template_id,
      };
    });

    const extras = lista.filter(s => !tiposDefault.has(s.tipo));
    const indiceFooter = resultado.findIndex(s => s.tipo === 'footer');
    const destino = indiceFooter >= 0 ? indiceFooter : resultado.length;
    resultado.splice(destino, 0, ...extras);
    return resultado.map((s, idx) => ({ ...s, orden: idx }));
  }

  // La seccion `productos` NO lleva el catalogo embebido: el render publico lo
  // toma de la raiz de la respuesta (items/catalogo_items) via
  // data.itemsFiltrados — ver legacyBlocks.jsx#ProductsAdapter. Inyectarlo aca
  // serializaba el mismo array de 40 productos una tercera vez: 137 KB de los
  // 498 KB que pesaba la respuesta, el 27,7%, que nadie leia.
  static construirSeccionesPublicas(landing, { testimonios, faq, banner }) {
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
      this.seccionDto({ tipo: 'productos', page_type: 'landing', nombre_interno: 'Catalogo', activo: true, orden: 60, config_json: {}, contenido_json: { titulo: 'Todos los productos' } }),
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
    if (payload.typography !== undefined) {
      campos.typography = normalizarTipografiaLanding(payload.typography);
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
    await this.sincronizarTemaConTienda(landing, payload);
    await this.sincronizarTemaPaginasFijas(landing, payload);

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
    await this.sincronizarTemaConTienda(landing, payload);
    await this.sincronizarTemaPaginasFijas(landing, payload);

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
   * el comentario ahí). `imagenData` es el objeto devuelto por
   * ImagenService.procesarArchivoParaR2 ({url, storage_key, mime_type,
   * size, width, height}) o null para quitar. Devuelve el valor anterior
   * ({url, storage_key}) para que el controller borre ese objeto de R2 (o
   * el archivo legacy en disco); landing.service.js no toca storage.
   * @returns {{landing: object, anterior: {url: string, storage_key: string|null}|null}}
   */
  static async _actualizarImagenCampo(id, tienda_id, campo, imagenData) {
    const landing = await Landing.findOne({ where: { id, tienda_id } });
    if (!landing) throw new Error('Landing no encontrada.');
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

  static actualizarImagenBanner(id, tienda_id, imagenData) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', imagenData);
  }

  static quitarImagenBanner(id, tienda_id) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', null);
  }

  static actualizarImagenSeo(id, tienda_id, imagenData) {
    return this._actualizarImagenCampo(id, tienda_id, 'seo_og_imagen', imagenData);
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

  static serializarImagenProducto(img) {
    if (!img) return null;
    const data = img.toJSON ? img.toJSON() : img;
    return {
      tipo: 'imagen',
      id: data.id || null,
      imagen_id: data.id || data.imagen_id || null,
      producto_id: data.producto_id || null,
      variante_id: data.variante_id || null,
      url: data.url || null,
      es_principal: !!data.es_principal,
      orden: data.orden || 0,
      width: data.width || null,
      height: data.height || null,
      visual_modo: data.visual_modo || 'contain',
      focal_x: data.focal_x != null ? Number(data.focal_x) : 50,
      focal_y: data.focal_y != null ? Number(data.focal_y) : 50,
      optimizacion: data.optimizacion_json || null,
    };
  }

  static async sincronizarTemaConTienda(landing, payload = {}) {
    const camposTienda = {};
    if (payload.color_primario !== undefined && landing.color_primario) camposTienda.color_primario = landing.color_primario;
    if (payload.color_texto !== undefined && landing.color_texto) camposTienda.color_secundario = landing.color_texto;
    if (payload.color_fondo !== undefined && landing.color_fondo) camposTienda.color_fondo = landing.color_fondo;
    if (!Object.keys(camposTienda).length) return;
    await Tienda.update(camposTienda, { where: { id: landing.tienda_id } });
  }

  static TIPOS_SIN_CATALOGO = [
    'contacto',
  ];

  static TIPOS_PAGINA_PERSISTIDOS = new Set(['inicio', 'catalogo', 'contacto', 'funnel']);

  static async sincronizarTemaPaginasFijas(landing, payload = {}) {
    const tocoTema = this.CAMPOS_TEMA.some(campo => payload[campo] !== undefined);
    if (!tocoTema || landing.tipo_pagina !== 'inicio') return;
    const temaActual = Object.fromEntries(this.CAMPOS_TEMA.map(c => [c, landing[c]]));
    await Landing.update(temaActual, {
      where: { tienda_id: landing.tienda_id, tipo_pagina: { [Op.in]: ['catalogo', ...this.TIPOS_SIN_CATALOGO] } },
    });
  }

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
        activo: rol.activo === true,
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
      await Landing.update(temaActual, { where: { tienda_id, tipo_pagina: { [Op.in]: ['catalogo', ...this.TIPOS_SIN_CATALOGO] } } });
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
    const tienda = await Tienda.findByPk(tienda_id, { attributes: ['id', 'typography'] });
    if (tienda) {
      json.typography = {
        ...(json.typography || { mode: 'inherit' }),
        resolved: await TypographyService.resolver(tienda, landing),
      };
    }
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

    if (landing.banner_imagen) {
      await ImagenService.eliminarObjetoStorage({ url: landing.banner_imagen, storage_key: landing.banner_imagen_storage_key });
    }
    if (landing.seo_og_imagen) {
      await ImagenService.eliminarObjetoStorage({ url: landing.seo_og_imagen, storage_key: landing.seo_og_imagen_storage_key });
    }
    if (landing.logo_imagen) {
      await ImagenService.eliminarObjetoStorage({ url: landing.logo_imagen, storage_key: landing.logo_imagen_storage_key });
    }

    // testimonios se borran en cascada (FK) al destruir la landing — eso
    // limpia la fila, no el objeto en R2, así que hay que hacerlo acá.
    const testimonios = await Testimonio.findAll({ where: { landing_id: landing.id }, attributes: ['foto'] });
    const fotos = [...new Set(testimonios.map(t => t.foto).filter(Boolean))];
    for (const foto of fotos) {
      await ImagenService.eliminarObjetoStorage({ url: foto });
    }

    await landing.destroy();
    return true;
  }

  static async cambiarEstado(id, tienda_id, activo) {
    const landing = await Landing.findOne({ where: { id, tienda_id } });
    if (!landing) throw new Error('Landing no encontrada.');

    // Las páginas informativas fijas no tienen catálogo propio.
    // Una landing legacy de producto nunca tiene LandingItem — su producto
    // vive en Landing.producto_id directo — así que se valida aparte para
    // no romper datos publicados antes de retirar el flujo de creación.
    if (activo && landing.tipo_pagina === 'funnel') {
      if (!landing.producto_id) throw new Error('No se puede publicar un funnel sin producto.');
      const producto = await Producto.findByPk(landing.producto_id, { attributes: ['cantidad_disponible'] });
      if (producto && Number(producto.cantidad_disponible) <= 0) {
        throw new Error('No se puede publicar: el producto no tiene stock disponible.');
      }
    } else if (activo && !this.TIPOS_SIN_CATALOGO.includes(landing.tipo_pagina)) {
      const items = await LandingItem.findAll({ where: { landing_id: landing.id }, attributes: ['tipo', 'referencia_id'] });
      if (items.length === 0) throw new Error('No se puede publicar una landing sin productos.');

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
  /**
   * @param {string[]|null} contentIds - los que trae el evento. En un lienzo
   *   en blanco el catálogo puede ser de miles de productos: se valida solo
   *   contra estos, no se arma el catálogo entero en cada PageView.
   */
  static async obtenerCatalogoParaEvento(landing_id, contentIds = null) {
    const landing = await Landing.findByPk(landing_id, {
      attributes: ['id', 'content'],
      include: [
        { model: LandingItem, as: 'items', attributes: ['tipo', 'referencia_id', 'orden'] },
        { model: LandingTemplate, as: 'template', required: false, attributes: ['kind'] },
        // usuario_id: el catálogo por regla se acota al dueño (visibilidadDeTienda).
        { model: Tienda, attributes: ['inquilino_id', 'usuario_id'] },
      ],
    });
    if (!landing) return new Map();
    let items;
    if (landing.template?.kind === 'codigo' && landing.Tienda) {
      items = contentIds?.length
        ? await this.itemsDelLienzo(landing, landing.Tienda, { contentIds })
        : [];
    } else {
      items = landing.items || [];
    }
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

    const visitasLegacy = eventos.filter(e => e.tipo_evento === 'visita');
    const pageviews = eventos.filter(e => e.tipo_evento === 'PageView');
    // 'InitiateCheckout' NO cuenta como conversación de WhatsApp: un checkout
    // de carrito emite InitiateCheckout Y Contact por el mismo envío (ver
    // checkoutCarrito en LandingPublica.jsx), así que incluirlo contaba dos
    // veces la misma conversación e inflaba el CTR. Mismo criterio que
    // estadisticasRango(), que ya filtraba solo por Contact/Lead.
    const contactos = eventos.filter(e => ['Contact', 'Lead'].includes(e.tipo_evento));
    const todosEventosConversion = eventos.filter(e => ['Contact', 'Lead'].includes(e.tipo_evento));

    const serieMap = new Map();
    const visitasPorDia = new Map();
    for (let i = 0; i < diasNum; i++) {
      const dia = new Date(desde.getTime() + i * 86400000).toISOString().slice(0, 10);
      serieMap.set(dia, 0);
      visitasPorDia.set(dia, { legacy: 0, pageview: 0 });
    }
    visitasLegacy.forEach(v => {
      const dia = v.created_at.toISOString().slice(0, 10);
      if (visitasPorDia.has(dia)) visitasPorDia.get(dia).legacy += 1;
    });
    pageviews.forEach(v => {
      const dia = v.created_at.toISOString().slice(0, 10);
      if (visitasPorDia.has(dia)) visitasPorDia.get(dia).pageview += 1;
    });
    visitasPorDia.forEach((conteo, dia) => {
      serieMap.set(dia, Math.max(conteo.legacy, conteo.pageview));
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

    const totalVisitas = [...serieMap.values()].reduce((acc, n) => acc + n, 0);
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
    // `id` puede ser 'todas': el dashboard tiene un selector de landing y su
    // opción por defecto suma el tráfico de TODAS las páginas de la tienda
    // (home, catálogo, contacto y funnels). Sin esto, la vista "Todas"
    // tendría visitas de una sola página contra pedidos de todo el negocio
    // — la mezcla de alcances que hacía leer "0 visitas → 3 formularios".
    const esTodas = String(id).toUpperCase() === 'TODAS';
    let landingIds;
    if (esTodas) {
      const todas = await Landing.findAll({ where: { tienda_id }, attributes: ['id'], raw: true });
      landingIds = todas.map(l => l.id);
    } else {
      const landing = await Landing.findOne({ where: { id, tienda_id }, attributes: ['id'] });
      if (!landing) throw new Error('Landing no encontrada.');
      landingIds = [landing.id];
    }

    // Filtro por producto: solo aplica a los eventos con items[] (AddToCart,
    // InitiateCheckout, Contact/Lead) o custom_data.content_name — un
    // 'visita' es un pageview de la landing completa, sin producto asociado,
    // así que ese total queda sin filtrar (ver visitas_sin_filtrar abajo).
    let productoNombreFiltro = null;
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      const producto = await Producto.findOne({ where: { id: filtros.producto_id }, attributes: ['nombre'] });
      productoNombreFiltro = producto ? producto.nombre.trim().toLowerCase() : '__sin_coincidencia__';
    }

    const { desde, hasta } = resolverRangoFechas(filtros);
    const desdeDate = new Date(`${desde}T00:00:00`);
    const hastaDate = new Date(`${hasta}T23:59:59.999`);

    const MAX_DIAS_RANGO = 400;
    if ((hastaDate - desdeDate) / 86400000 > MAX_DIAS_RANGO) {
      hastaDate.setTime(desdeDate.getTime() + MAX_DIAS_RANGO * 86400000);
    }

    const eventos = await LandingEvento.findAll({
      where: { landing_id: { [Op.in]: landingIds }, created_at: { [Op.between]: [desdeDate, hastaDate] } },
      attributes: ['tipo_evento', 'payload', 'created_at'],
      order: [['created_at', 'ASC']],
    });

    const visitasLegacy = eventos.filter(e => e.tipo_evento === 'visita');
    const pageviews = eventos.filter(e => e.tipo_evento === 'PageView');
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

    const visitasPorDia = new Map([...serieMap.keys()].map(dia => [dia, { legacy: 0, pageview: 0 }]));
    visitasLegacy.forEach(v => {
      const dia = formatYMD(v.created_at);
      if (visitasPorDia.has(dia)) visitasPorDia.get(dia).legacy += 1;
    });
    pageviews.forEach(v => {
      const dia = formatYMD(v.created_at);
      if (visitasPorDia.has(dia)) visitasPorDia.get(dia).pageview += 1;
    });
    visitasPorDia.forEach((conteo, dia) => {
      if (serieMap.has(dia)) serieMap.get(dia).visitas = Math.max(conteo.legacy, conteo.pageview);
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
      if (productoNombreFiltro) {
        const items = Array.isArray(c.payload?.items) ? c.payload.items : null;
        const nombreSuelto = c.payload?.custom_data?.content_name;
        const coincide = items
          ? items.some(it => (it?.nombre || '').trim().toLowerCase() === productoNombreFiltro)
          : (nombreSuelto || '').trim().toLowerCase() === productoNombreFiltro;
        if (!coincide) return;
      }

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
          if (['Contact', 'Lead'].includes(c.tipo_evento)) {
            productosMap.set(it.nombre, (productosMap.get(it.nombre) || 0) + (it.cantidad || 1));
          }
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
      if (nombre && ['Contact', 'Lead'].includes(c.tipo_evento)) {
        productosMap.set(nombre, (productosMap.get(nombre) || 0) + 1);
      }
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

    const totalVisitas = [...visitasPorDia.values()].reduce((acc, conteo) => acc + Math.max(conteo.legacy, conteo.pageview), 0);

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
      // Con filtro de producto activo, "visitas" sigue siendo el total de la
      // landing completa — un pageview no lleva producto asociado, no hay
      // forma honesta de partirlo. El frontend lo aclara con esta bandera.
      visitas_sin_filtrar: Boolean(productoNombreFiltro),
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
  /**
   * Qué productos y combos puede vender una tienda por REGLA (todo el
   * catálogo / por categoría / fallback). Con tenant único, filtrar solo por
   * inquilino_id metía en la landing de una tienda lo que cargaron otros
   * usuarios. Mismas reglas que la Vitrina de su dueño (precioUsuario.service):
   *   - productos: creado_por NULL, del dueño o de un admin;
   *   - combos: del dueño o de un admin. NULL (anteriores a 2026-09-24) es
   *     solo del admin, así que entra únicamente si el dueño es admin.
   * Devuelve fragmentos de where envueltos en Op.and para combinarlos con el
   * Op.or de los content_ids sin pisarlo.
   */
  static async visibilidadDeTienda(tienda) {
    const administradoresIds = await PrecioUsuarioService.obtenerIdsAdministradores(tienda.inquilino_id);
    const duenoId = tienda.usuario_id ?? null;
    const duenoEsAdmin = duenoId != null && administradoresIds.includes(duenoId);
    const producto = PrecioUsuarioService.visibilidadCatalogoWhere(duenoId, false, false, administradoresIds);
    const combo = duenoEsAdmin
      ? { [Op.or]: [{ creado_por: null }, { creado_por: { [Op.in]: administradoresIds } }] }
      : PrecioUsuarioService.visibilidadComboWhere(duenoId, false, false, administradoresIds);
    return { producto: { [Op.and]: [producto] }, combo: { [Op.and]: [combo] } };
  }

  /**
   * Un lienzo en blanco sin productos elegidos vende los últimos
   * MAX_ITEMS_POR_LANDING productos en venta de la tienda. Vive en un solo
   * lugar porque lo usan tres caminos que TIENEN que coincidir: lo que se
   * muestra (obtenerPublica), lo que se puede comprar (resolverCarrito) y lo
   * que se acepta como evento (obtenerCatalogoParaEvento). Antes solo lo
   * aplicaba obtenerPublica: el visitante veía el producto, tocaba
   * "Comprar" y el checkout respondía "carrito vacío".
   */
  static async itemsFallbackLienzo(tienda, visibilidad = null) {
    const { producto: visibles } = visibilidad || await this.visibilidadDeTienda(tienda);
    const productos = await Producto.findAll({
      where: { inquilino_id: tienda.inquilino_id, activo: true, estado_venta: 'en_venta', ...visibles },
      attributes: ['id', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: MAX_ITEMS_POR_LANDING,
    });
    return productos.map((p, idx) => ({
      tipo: 'producto',
      referencia_id: p.id,
      precio_ancla: null,
      etiqueta: null,
      orden: idx,
      mostrar_en_inicio: true,
      envio_incluido: false,
      createdAt: p.created_at,
    }));
  }

  /**
   * content_ids públicos → ids. "combo-12" y "producto-7" se resuelven
   * directo; cualquier otro es el slug de un producto.
   */
  static separarContentIds(contentIds = []) {
    const slugs = [];
    const idsProducto = [];
    const idsCombo = [];
    for (const crudo of contentIds) {
      if (typeof crudo !== 'string' || !crudo) continue;
      const combo = crudo.match(/^combo-(\d+)$/);
      const producto = crudo.match(/^producto-(\d+)$/);
      if (combo) idsCombo.push(Number(combo[1]));
      else if (producto) idsProducto.push(Number(producto[1]));
      else slugs.push(crudo);
    }
    return { slugs, idsProducto, idsCombo };
  }

  static aItemSintetico(tipo, entidad, orden) {
    return {
      tipo,
      referencia_id: entidad.id,
      precio_ancla: null,
      etiqueta: null,
      orden,
      mostrar_en_inicio: true,
      envio_incluido: false,
      createdAt: entidad.created_at || entidad.createdAt || null,
    };
  }

  /**
   * "Todos" / "por categoría" del lienzo: una REGLA, no una lista. Vende
   * todo lo que esté en venta hoy y lo que se cargue mañana, sin tope.
   *
   * @param {object} opciones
   * @param {string[]|null} opciones.contentIds - solo estos (carrito, eventos, ficha).
   * @param {number|null} opciones.limite - los primeros N (destacados y más nuevos primero).
   */
  static async itemsPorReglaLienzo(tienda, venta, { contentIds = null, limite = null } = {}, visibilidad = null) {
    const categorias = venta.seleccion === 'categoria' ? (venta.categorias || []) : null;
    if (categorias && !categorias.length) return [];
    const filtroCategoria = categorias
      ? [{ association: 'categoria', attributes: [], where: { nombre: { [Op.in]: categorias } }, required: true }]
      : [];

    const visibles = visibilidad || await this.visibilidadDeTienda(tienda);
    const { inquilino_id } = tienda;
    const whereProducto = { inquilino_id, activo: true, estado_venta: 'en_venta', ...visibles.producto };
    const whereCombo = { inquilino_id, estado: 'ACTIVO', ...visibles.combo };
    let buscarProductos = true;
    let buscarCombos = venta.incluir_combos !== false;
    if (contentIds) {
      const { slugs, idsProducto, idsCombo } = this.separarContentIds(contentIds);
      const condiciones = [
        slugs.length ? { slug: { [Op.in]: slugs } } : null,
        idsProducto.length ? { id: { [Op.in]: idsProducto } } : null,
      ].filter(Boolean);
      buscarProductos = condiciones.length > 0;
      if (buscarProductos) whereProducto[Op.or] = condiciones;
      buscarCombos = buscarCombos && idsCombo.length > 0;
      if (buscarCombos) whereCombo.id = { [Op.in]: idsCombo };
    }

    const [productos, combos] = await Promise.all([
      buscarProductos
        ? Producto.findAll({
          where: whereProducto,
          include: filtroCategoria,
          attributes: ['id', 'created_at'],
          order: [['destacado', 'DESC'], ['created_at', 'DESC']],
          ...(limite ? { limit: limite } : {}),
        })
        : Promise.resolve([]),
      buscarCombos
        ? ProductoCombo.findAll({
          where: whereCombo,
          include: [{
            model: Producto,
            as: 'producto_padre',
            attributes: ['id'],
            where: { activo: true },
            required: true,
            include: filtroCategoria,
          }],
          order: [['id', 'DESC']],
          ...(limite ? { limit: limite } : {}),
        })
        : Promise.resolve([]),
    ]);

    const itemsProducto = productos.map((p, i) => this.aItemSintetico('producto', p, i));
    const itemsCombo = combos.map((c, i) => this.aItemSintetico('combo', c, i));
    // Venta por combos: los combos van primero en la primera página.
    const todos = venta.tipo === 'combos' ? [...itemsCombo, ...itemsProducto] : [...itemsProducto, ...itemsCombo];
    return (limite ? todos.slice(0, limite) : todos).map((it, orden) => ({ ...it, orden }));
  }

  /** Cuántos productos vende el lienzo en total — para "N productos" y la paginación. */
  static async contarLienzo(landing, tienda) {
    const venta = landing.content?.venta;
    if (!(venta?.configurado && ['todos', 'categoria'].includes(venta.seleccion))) {
      return (landing.items || []).length || (await this.itemsFallbackLienzo(tienda)).length;
    }
    const categorias = venta.seleccion === 'categoria' ? (venta.categorias || []) : null;
    if (categorias && !categorias.length) return 0;
    const filtroCategoria = categorias
      ? [{ association: 'categoria', attributes: [], where: { nombre: { [Op.in]: categorias } }, required: true }]
      : [];
    const visibles = await this.visibilidadDeTienda(tienda);
    const [nProductos, nCombos] = await Promise.all([
      Producto.count({ where: { inquilino_id: tienda.inquilino_id, activo: true, estado_venta: 'en_venta', ...visibles.producto }, include: filtroCategoria }),
      venta.incluir_combos === false ? 0 : ProductoCombo.count({
        where: { inquilino_id: tienda.inquilino_id, estado: 'ACTIVO', ...visibles.combo },
        include: [{ model: Producto, as: 'producto_padre', attributes: [], where: { activo: true }, required: true, include: filtroCategoria }],
      }),
    ]);
    return nProductos + nCombos;
  }

  /**
   * LA lista de productos de un lienzo en blanco. Todo lo que muestra,
   * pagina, cobra o trackea una landing HTML pasa por acá, para que "lo que
   * se ve" y "lo que se puede comprar" no puedan diferir:
   *   - regla (todos / por categoría) → itemsPorReglaLienzo, sin tope;
   *   - lista manual → sus LandingItem;
   *   - nada configurado → itemsFallbackLienzo (comportamiento histórico).
   *
   * @param {object} opciones
   * @param {string[]|null} opciones.contentIds - restringe a estos (carrito, eventos).
   * @param {number|null} opciones.limite - solo los primeros N.
   * @param {string|null} opciones.asegurar - content_id que tiene que estar aunque quede fuera del límite (la ficha).
   */
  /**
   * Las vistas del lienzo que viajan en la respuesta pública: la ficha
   * general + la ficha propia SOLO del producto que se va a mostrar (el de
   * la URL, o el principal si la landing abre directo en un producto).
   */
  static vistasPublicas(content, contentIdPedido = null, contentIdPrincipal = null) {
    const vistas = content?.vistas || {};
    const venta = content?.venta || {};
    const propias = vistas.productos || {};
    const salida = {};
    if (vistas.producto) salida.producto = vistas.producto;
    if (vistas.legales && typeof vistas.legales === 'object') salida.legales = vistas.legales;
    // El principal va primero en los items cuando la landing abre en él
    // (ver principal_id en obtenerPublica).
    const buscado = contentIdPedido || (venta.abrir_en === 'producto' ? contentIdPrincipal : null);
    const elegidas = buscado && propias[buscado] ? { [buscado]: propias[buscado] } : {};
    if (Object.keys(elegidas).length) salida.productos = elegidas;
    return salida;
  }

  static async itemsDelLienzo(landing, tienda, { contentIds = null, limite = null, asegurar = null } = {}) {
    const venta = landing.content?.venta;
    let items;
    if (venta?.configurado && ['todos', 'categoria'].includes(venta.seleccion)) {
      const visibilidad = await this.visibilidadDeTienda(tienda);
      items = await this.itemsPorReglaLienzo(tienda, venta, { contentIds, limite }, visibilidad);
      if (asegurar && !contentIds) {
        const extra = await this.itemsPorReglaLienzo(tienda, venta, { contentIds: [asegurar] }, visibilidad);
        const ya = new Set(items.map(i => `${i.tipo}:${i.referencia_id}`));
        extra.forEach(i => { if (!ya.has(`${i.tipo}:${i.referencia_id}`)) items.push({ ...i, orden: items.length }); });
      }
      const ajustes = new Map((landing.items || []).map(i => [`${i.tipo}:${Number(i.referencia_id)}`, i]));
      return items.map(i => {
        const ajuste = ajustes.get(`${i.tipo}:${Number(i.referencia_id)}`);
        return ajuste ? { ...i, precio_ancla: ajuste.precio_ancla, etiqueta: ajuste.etiqueta,
          mostrar_en_inicio: ajuste.mostrar_en_inicio !== false, envio_incluido: ajuste.envio_incluido === true } : i;
      });
    }

    items = (landing.items || []).length
      ? [...landing.items].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      : await this.itemsFallbackLienzo(tienda);

    if (contentIds || (asegurar && limite && items.length > limite)) {
      const buscados = contentIds || [asegurar];
      const { slugs, idsProducto, idsCombo } = this.separarContentIds(buscados);
      const idsPorSlug = slugs.length
        ? (await Producto.findAll({ where: { slug: { [Op.in]: slugs } }, attributes: ['id'] })).map(p => p.id)
        : [];
      const setProducto = new Set([...idsProducto, ...idsPorSlug]);
      const setCombo = new Set(idsCombo);
      const coinciden = items.filter(i => (i.tipo === 'combo' ? setCombo : setProducto).has(Number(i.referencia_id)));
      if (contentIds) return coinciden;
      const primeros = items.slice(0, limite);
      const ya = new Set(primeros.map(i => `${i.tipo}:${i.referencia_id}`));
      return [...primeros, ...coinciden.filter(i => !ya.has(`${i.tipo}:${i.referencia_id}`))];
    }
    return limite ? items.slice(0, limite) : items;
  }

  /**
   * @param {object} [opciones]
   * @param {string|null} [opciones.asegurarContentId] - lienzo en blanco: producto que la
   *   respuesta tiene que traer completo aunque no esté en la primera página (la ficha).
   */
  static async obtenerPublica(tienda, slug, preview = false, opciones = {}) {
    const where = { tienda_id: tienda.id };
    const tipoPaginaVirtual = opciones.tipoPagina && !this.TIPOS_PAGINA_PERSISTIDOS.has(opciones.tipoPagina)
      ? opciones.tipoPagina
      : null;
    if (opciones.tipoPagina && this.TIPOS_PAGINA_PERSISTIDOS.has(opciones.tipoPagina)) where.tipo_pagina = opciones.tipoPagina;
    else if (tipoPaginaVirtual) {
      if (slug) where.slug = slug;
      else where.es_home = true;
    }
    else if (slug) where.slug = slug;
    else where.es_home = true;

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

    // La visita NO se registra acá: la cuenta el navegador contra
    // POST /api/l/:slug/visita. Mientras vivía en este GET, cada visita exigía
    // un hit en Node y hacía incacheable la respuesta — un HIT de CDN no
    // contaba la visita. Ver registrarVisitaPublica en
    // landingPublica.controller.js.

    // Tipo de template: se necesita antes de sintetizar items para el
    // lienzo en blanco y se reutiliza más abajo para el DTO.
    const esRigida = landing.template?.kind === 'rigido';
    const esFunnel = landing.template?.kind === 'funnel';
    const esCodigo = landing.template?.kind === 'codigo';
    const typography = await TypographyService.resolver(tienda, landing);
    const paymentLogos = esCodigo ? await PaymentLogoService.resolverParaLanding(landing, tienda) : [];

    // Lienzo en blanco sin productos curados: los define la regla de
    // "Configurar venta" (todo el catálogo / por categoría, con o sin
    // combos). Sin configuración, todo el catálogo — el comportamiento de
    // siempre. El checkout valida con la misma regla (resolverCarrito).
    let itemsFallbackCodigo = null;
    if (esCodigo && !(landing.items || []).length) {
      itemsFallbackCodigo = await this.itemsSegunReglaCodigo(landing, tienda);
    }

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
      : (itemsFallbackCodigo || null)
        ? itemsFallbackCodigo
      : (landing.items || []);
    // Lienzo "directo en un producto": la landing abre en la ficha del
    // principal, así que tiene que venir primero (y aunque la regla lo deje
    // fuera del primer lote).
    const principalLienzo = Number(landing.content?.venta?.principal_id);
    if (esCodigo && landing.content?.venta?.abrir_en === 'producto' && principalLienzo) {
      const i = items.findIndex(x => x.tipo === 'producto' && Number(x.referencia_id) === principalLienzo);
      if (i > 0) items.unshift(items.splice(i, 1)[0]);
    }
    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);
    // Templates rígidos (Fitness/Beauty/Tech/Básico), funnels y lienzo en
    // blanco: ver landingSimple.service.js / funnel.service.js.

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
              attributes: ['id', 'cantidad', 'producto_incluido_id'],
              include: [{
                model: Producto,
                as: 'producto_incluido',
                attributes: [
                  'id', 'nombre', 'precio_base', 'precio_minimo',
                  'descuento_porcentaje', 'descuento_inicio', 'descuento_fin',
                  'beneficios',
                ],
              }],
            },
            {
              model: ProductoComboImagen,
              as: 'imagenes',
              attributes: ['id', 'url', 'storage_key', 'es_principal', 'orden'],
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
            attributes: ['producto_id', 'cantidad', 'variante_id', 'permite_elegir_variante'],
            include: [{
              model: Producto,
              as: 'producto',
              attributes: ['id', 'nombre', 'sku', 'precio_costo', 'cantidad_disponible'],
              include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }]
            }, {
              model: ProductoVariante,
              as: 'variante',
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
    // Imagen/galería: el combo usa sus propias fotos si las tiene; si no,
    // cae a la galería del producto padre para mantener compatibilidad con
    // combos viejos creados antes de tener galería propia.
    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
    ];

    // precios, imagenes y variantes solo dependen de los IDs ya resueltos
    // arriba, no entre sí — en paralelo en vez de uno atrás del otro.
    const [precios, imagenes, variantes, preguntas, opcionesProductos] = await Promise.all([
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
          attributes: ATRIBUTOS_IMAGEN_PRODUCTO,
          order: [['es_principal', 'DESC'], ['orden', 'ASC']],
        })
        : Promise.resolve([]),
      // Los combos no tienen selector de variante propio (son un bundle
      // fijo armado por el admin) — solo se resuelven para productos.
      idsProducto.length
        ? ProductoVariante.findAll({
          where: { producto_id: { [Op.in]: idsProducto }, activo: true },
          include: [{
            model: ProductoOpcionValor,
            as: 'valoresOpcion',
            through: { attributes: [] },
            include: [{ model: ProductoOpcion, as: 'opcion', attributes: ['id', 'nombre', 'orden'] }],
          }],
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
      // Opciones (tipo Shopify: Color, RAM...) con sus valores posibles, para
      // que el selector público sepa qué grupos de botones dibujar. Productos
      // legacy (sin Opciones) devuelven lista vacía — el frontend arma un
      // grupo sintético a partir de los nombres de variante en ese caso.
      idsProducto.length
        ? ProductoOpcion.findAll({
          where: { producto_id: { [Op.in]: idsProducto } },
          include: [{ model: ProductoOpcionValor, as: 'valores' }],
          order: [['orden', 'ASC']],
        })
        : Promise.resolve([]),
    ]);
    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));

    const precioVentaProducto = (producto) => {
      if (!producto) return null;
      const precioBaseProducto = parseFloat(producto.precio_base) || 0;
      const precioMinimoProducto = producto.precio_minimo !== null && producto.precio_minimo !== undefined
        ? parseFloat(producto.precio_minimo)
        : null;
      const precioUsuarioProducto = mapaPrecios.get(`producto:${producto.id}`);
      const precioBaseConDescuentoProducto = PricingService.aplicarDescuentoFecha(
        precioBaseProducto,
        producto.descuento_porcentaje,
        producto.descuento_inicio,
        producto.descuento_fin
      );
      return PricingService.calcularPrecioBase(
        precioBaseConDescuentoProducto,
        precioMinimoProducto,
        precioUsuarioProducto
      ).efectivo;
    };

    const mapaFaq = new Map(); // producto_id -> {pregunta, respuesta}[]
    preguntas.forEach(f => {
      const lista = mapaFaq.get(f.producto_id) || [];
      lista.push({ pregunta: f.pregunta, respuesta: f.respuesta });
      mapaFaq.set(f.producto_id, lista);
    });

    const mapaImagenes = new Map(); // producto_id -> [{id, url, variante_id, es_principal}]
    imagenes.forEach(img => {
      const lista = mapaImagenes.get(img.producto_id) || [];
      lista.push(this.serializarImagenProducto(img));
      mapaImagenes.set(img.producto_id, lista);
    });

    const mapaVariantes = new Map(); // producto_id -> ProductoVariante[]
    variantes.forEach(v => {
      const lista = mapaVariantes.get(v.producto_id) || [];
      lista.push(v);
      mapaVariantes.set(v.producto_id, lista);
    });

    const mapaOpciones = new Map(); // producto_id -> ProductoOpcion[] (con .valores)
    opcionesProductos.forEach(o => {
      const lista = mapaOpciones.get(o.producto_id) || [];
      lista.push(o);
      mapaOpciones.set(o.producto_id, lista);
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
    // Los productos que arma un combo (ProductoComboItem.producto_incluido)
    // tampoco están garantizados en `mapaProducto`/`mapaImagenes`: son del
    // catálogo general del admin, no items propios de esta landing. Sin
    // esto, "Qué incluye" en la ficha del combo no tenía ni imagen ni precio
    // de referencia de cada producto.
    const idsComponentesAjenos = [...new Set([
      ...ofertas.flatMap(o => (o.componentes || []).map(c => c.producto_id)),
      ...combos.map(c => c.producto_padre?.id),
      ...combos.flatMap(c => (c.items || []).map(i => i.producto_incluido_id)),
    ])].filter(id => !mapaProducto.has(id));

    if (idsComponentesAjenos.length) {
      // Se traen también variantes/opciones (no solo nombre/imagen/precio):
      // un componente ajeno con `permite_elegir_variante` necesita exponer
      // su selector real en el DTO público, y ese producto puede no ser
      // del catálogo propio de esta landing (por eso no está ya en
      // mapaVariantes/mapaOpciones, que solo cubren idsProducto).
      const [productosAjenos, imagenesAjenas, preciosAjenos, variantesAjenas, opcionesAjenas] = await Promise.all([
        Producto.findAll({
          where: { id: { [Op.in]: idsComponentesAjenos } },
          attributes: [
            'id', 'nombre', 'precio_base', 'precio_minimo',
            'descuento_porcentaje', 'descuento_inicio', 'descuento_fin',
            'beneficios',
          ],
        }),
        // Ya no se filtra `variante_id: null`: si el componente permite
        // elegir variante, hacen falta también las fotos propias de cada
        // variante para armar su galería en el selector.
        ProductoImagen.findAll({
          where: { producto_id: { [Op.in]: idsComponentesAjenos } },
          attributes: ATRIBUTOS_IMAGEN_PRODUCTO,
          order: [['es_principal', 'DESC'], ['orden', 'ASC']],
        }),
        PrecioUsuario.findAll({
          where: {
            usuario_id: tienda.usuario_id,
            tipo: 'producto',
            referencia_id: { [Op.in]: idsComponentesAjenos },
          },
        }),
        ProductoVariante.findAll({
          where: { producto_id: { [Op.in]: idsComponentesAjenos }, activo: true },
          include: [{
            model: ProductoOpcionValor,
            as: 'valoresOpcion',
            through: { attributes: [] },
            include: [{ model: ProductoOpcion, as: 'opcion', attributes: ['id', 'nombre', 'orden'] }],
          }],
          order: [['id', 'ASC']],
        }),
        ProductoOpcion.findAll({
          where: { producto_id: { [Op.in]: idsComponentesAjenos } },
          include: [{ model: ProductoOpcionValor, as: 'valores' }],
          order: [['orden', 'ASC']],
        }),
      ]);
      preciosAjenos.forEach(p => mapaPrecios.set(`producto:${p.referencia_id}`, parseFloat(p.precio)));
      productosAjenos.forEach(p => mapaProducto.set(p.id, p));
      imagenesAjenas.forEach(img => {
        const lista = mapaImagenes.get(img.producto_id) || [];
        lista.push(this.serializarImagenProducto(img));
        mapaImagenes.set(img.producto_id, lista);
      });
      variantesAjenas.forEach(v => {
        const lista = mapaVariantes.get(v.producto_id) || [];
        lista.push(v);
        mapaVariantes.set(v.producto_id, lista);
      });
      opcionesAjenas.forEach(o => {
        const lista = mapaOpciones.get(o.producto_id) || [];
        lista.push(o);
        mapaOpciones.set(o.producto_id, lista);
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
      const galeriaCombo = esCombo
        ? (entidad.imagenes || [])
          .slice()
          .sort((a, b) => (b.es_principal === true) - (a.es_principal === true) || (Number(a.orden) || 0) - (Number(b.orden) || 0))
          .map(img => ({ id: img.id, url: ImagenService.serializar(img).url }))
          .filter(img => img.url)
        : [];
      // Galería general: todas las imágenes que no son de una variante
      // puntual. Si un producto no tiene ninguna imagen "general" (todas
      // están atadas a variantes), se usan todas igual — mejor mostrar
      // algo que una galería vacía.
      const galeriaGeneral = galeriaFuente.filter(i => !i.variante_id);
      const imagenesDto = (galeriaCombo.length ? galeriaCombo : (galeriaGeneral.length ? galeriaGeneral : galeriaFuente)).map(i => this.serializarImagenProducto(i));

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
          imagenes: galeriaFuente.filter(i => i.variante_id === v.id).map(i => this.serializarImagenProducto(i)),
          valoresOpcion: (v.valoresOpcion || []).map(vo => ({ opcion: vo.opcion.nombre, valor: vo.valor })),
        };
      }) : [];

      // Grupos de Opciones (Color, RAM...) con sus valores posibles, para que
      // el selector público dibuje un bloque de botones por opción. Productos
      // legacy (sin Opciones) mandan lista vacía.
      const opcionesDto = !esCombo ? (mapaOpciones.get(entidad.id) || []).map(o => ({
        nombre: o.nombre,
        orden: o.orden,
        valores: (o.valores || []).map(val => val.valor),
      })) : [];

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
        // Ofertas de checkout (order bump / upsell / combo): a diferencia de un pack,
        // acá SÍ hace falta mostrar QUÉ se está ofreciendo de más (ej.
        // "Agregá el Mouse por Gs 15.000" con su propia foto) — sin esto la
        // casilla del checkout no tendría nombre ni imagen que mostrar. Se
        // exponen solo nombre/imagen, nunca cantidades ni la receta completa
        // (mismo criterio de privacidad que "unidades" arriba).
        // Un order bump se ofrece DENTRO del checkout; un upsell aparece como
        // paso de mejora antes de confirmar; un combo se elige antes, en la
        // ficha del producto. Bump y upsell pueden cobrar precio promocional
        // si tienen `precio_order_bump`.
        const esOrderBump = o.estrategia === 'order_bump';
        const esUpsell = o.estrategia === 'upsell';
        let productoComplementario = null;
        let productosIncluidos = [];
        if (esOrderBump || esUpsell || o.estrategia === 'combo') {
          const resolverProducto = (componente) => {
            const prod = mapaProducto.get(componente.producto_id);
            if (!prod) return null;
            const imgs = mapaImagenes.get(prod.id) || [];
            const principal = imgs.find(i => i.es_principal) || imgs[0];
            const precioEfectivoProd = precioVentaProducto(prod);
            const dto = {
              nombre: prod.nombre,
              imagen: principal?.url || null,
              precio: precioEfectivoProd,
              precio_efectivo: precioEfectivoProd,
            };
            // Solo si el admin activó "que el cliente elija" para ESTE
            // componente se manda el selector real (opciones/variantes) del
            // producto — nunca se inventan variantes nuevas acá, se reusa
            // tal cual la misma construcción que ya arma variantesDto/
            // opcionesDto para el producto principal de la ficha.
            if (componente.permite_elegir_variante) {
              const precioMinimoProd = prod.precio_minimo !== null && prod.precio_minimo !== undefined ? parseFloat(prod.precio_minimo) : null;
              dto.permite_elegir_variante = true;
              dto.opciones = (mapaOpciones.get(prod.id) || []).map(op => ({
                nombre: op.nombre,
                orden: op.orden,
                valores: (op.valores || []).map(val => val.valor),
              }));
              dto.variantes = (mapaVariantes.get(prod.id) || []).map(v => ({
                id: v.id,
                nombre: v.nombre,
                stock: v.stock,
                precio_efectivo: PricingService.calcularPrecioVariante(precioEfectivoProd, v.precio_diferencial, precioMinimoProd),
                imagenes: imgs.filter(i => i.variante_id === v.id).map(i => this.serializarImagenProducto(i)),
                valoresOpcion: (v.valoresOpcion || []).map(vo => ({ opcion: vo.opcion.nombre, valor: vo.valor })),
              }));
            }
            return dto;
          };
          // Un combo se muestra como paquete completo ("3 productos x
          // 120.000"), así que lista TODOS sus productos — el ancla incluido.
          // Un order bump/upsell es un agregado, así que muestra solo lo que
          // suma respecto al producto que la persona ya eligió.
          const componentes = o.estrategia === 'combo'
            ? (o.componentes || [])
            : (o.componentes || []).filter(c => c.producto_id !== entidad.id);
          productosIncluidos = componentes.map(c => resolverProducto(c)).filter(Boolean);
          productoComplementario = productosIncluidos[0] || null;
          // Bump/upsell de "otra unidad del mismo producto": su único
          // componente es el ancla, así que el filtro de arriba lo dejaba sin
          // complementario y el frontend lo descartaba en silencio (no se
          // veía ni en la ficha ni en el carrito).
          if (!productoComplementario && o.estrategia !== 'combo' && (o.componentes || []).length) {
            productoComplementario = resolverProducto(o.componentes[0]);
            if (productoComplementario) productosIncluidos = [productoComplementario];
          }
          // Sin foto propia de la oferta ni del complemento → la del producto
          // ancla. Sin imagen, la oferta tampoco se publicaba.
          if (productoComplementario && !productoComplementario.imagen && !o.imagen_url) {
            const imgsAncla = mapaImagenes.get(entidad.id) || [];
            const principalAncla = imgsAncla.find(i => i.es_principal) || imgsAncla[0];
            productoComplementario = { ...productoComplementario, imagen: principalAncla?.url || null };
            productosIncluidos = [productoComplementario, ...productosIncluidos.slice(1)];
          }
          // Cuántas unidades del complemento entran al aceptar el bump. No es
          // filtrar la receta: es lo que el comprador va a recibir, y sin
          // esto un bump de "2 × Aceite" se ofrecía como si fuera uno solo.
          if (esOrderBump && componentes.length === 1) {
            const cant = Number(componentes[0].cantidad) || 1;
            if (cant > 1) unidades = cant;
          }
        }
        // Los DOS precios (ver Oferta.js). `precio` se mantiene por
        // compatibilidad con lecturas viejas, pero apunta al normal: el
        // promocional del bump nunca debe pisar el precio de venta normal.
        const precioNormal = parseFloat(o.precio_normal ?? o.precio) || 0;
        const precioBump = (o.precio_order_bump === null || o.precio_order_bump === undefined)
          ? null : (parseFloat(o.precio_order_bump) || 0);
        const precioComplementario = parseFloat(productoComplementario?.precio_efectivo ?? productoComplementario?.precio) || 0;
        const precioNormalPublico = (esOrderBump || esUpsell) && precioComplementario > 0
          ? precioComplementario
          : precioNormal;
        return {
          id: o.id,
          nombre: o.nombre,
          tipo_contenido: o.tipo_contenido,
          estrategia: o.estrategia,
          precio: precioNormalPublico,
          precio_normal: precioNormalPublico,
          precio_order_bump: precioBump,
          // Lo que se cobra realmente si el visitante la acepta por su canal
          // — el frontend muestra ESTO, no adivina cuál de los dos aplica.
          precio_efectivo: (esOrderBump || esUpsell) ? (precioBump ?? precioNormalPublico) : precioNormalPublico,
          descripcion: o.descripcion || null,
          beneficios: Array.isArray(o.beneficios)
            ? o.beneficios.map(b => String(b || '').trim()).filter(Boolean)
            : null,
          // Imagen propia de la oferta; si no tiene, el frontend cae a la del
          // producto (no se resuelve acá para no inventar una que no eligió).
          imagen: o.imagen_url || null,
          vigencia: { desde: o.fecha_inicio || null, hasta: o.fecha_fin || null },
          unidades,
          producto_complementario: productoComplementario,
          productos_incluidos: productosIncluidos,
        };
      }) : [];

      // Lo que el comercio personalizó de este producto/combo EN ESTA
      // LANDING (ver overrideDeProducto/overrideDeCombo). Pisa el catálogo
      // global sin tocarlo.
      const override = esCombo
        ? this.overrideDeCombo(landing.content, entidad.id)
        : this.overrideDeProducto(landing.content, entidad.id);

      // Precio fantasía: si está seteado en la landing (item.precio_ancla) o en el producto (entidad.precio_tachado).
      // Si el producto tiene un descuento comercial y no hay un ancla visual explícita, 
      // el precio_base funge como el precio_antes tachado.
      let precioAntesCalculado = item.precio_ancla 
        ? parseFloat(item.precio_ancla) 
        : (!esCombo && entidad.precio_tachado ? parseFloat(entidad.precio_tachado) : null);

      if (!precioAntesCalculado && !esCombo && precioBase > precioEfectivo) {
         precioAntesCalculado = precioBase;
      }

      if (precioAntesCalculado <= precioEfectivo) {
         precioAntesCalculado = null;
      }

      const imagenesBaseGaleria = galeriaCombo.length ? galeriaCombo : (galeriaGeneral.length ? galeriaGeneral : galeriaFuente);
      const imagenPorId = new Map(imagenesBaseGaleria.filter(img => img.id != null).map(img => [String(img.id), img]));
      const imagenPorUrl = new Map(imagenesBaseGaleria.filter(img => img.url).map(img => [String(img.url), img]));
      const mediosPersonalizados = Array.isArray(override?.medios)
        ? override.medios.map(m => {
          if (!m) return null;
          if (typeof m === 'string') return m;
          if (m.tipo === 'video') return m.url ? { tipo: 'video', url: m.url, titulo: m.titulo || '' } : null;
          const img = imagenPorId.get(String(m.imagen_id ?? m.id)) || imagenPorUrl.get(String(m.url || ''));
          return img?.url
            ? this.serializarImagenProducto(img)
            : (m.url ? { tipo: 'imagen', url: m.url } : null);
        }).filter(m => m && (typeof m === 'string' || m.url))
        : null;
      const galeriaPublica = mediosPersonalizados?.length ? mediosPersonalizados : imagenesDto;
      const imagenPrincipalPublica = (() => {
        const primeraImagen = (galeriaPublica || []).find(m => (
          typeof m === 'string' || m?.tipo !== 'video'
        ));
        if (typeof primeraImagen === 'string') return primeraImagen;
        return primeraImagen?.url || imagenesDto[0]?.url || imagenesDto[0] || null;
      })();

      itemsDto.push({
        // ID público estable — nunca LandingItem.id (cambiaría entre landings para el mismo producto).
        content_id: entidad.slug || `${item.tipo}-${entidad.id}`,
        referencia_id: entidad.id,
        tipo: item.tipo,
        nombre: entidad.nombre,
        descripcion: esCombo ? entidad.descripcion : (override?.descripcion || entidad.descripcion_corta),
        descripcion_larga: esCombo ? null : (override?.descripcion || entidad.descripcion_larga),
        precio: precioEfectivo,
        precio_antes: precioAntesCalculado,
        // % de descuento calculado desde precio_antes vs precio efectivo.
        // Si no hay precio_antes, descuento_pct = 0 (no se muestra badge).
        descuento_pct: precioAntesCalculado
          ? Math.round((1 - precioEfectivo / precioAntesCalculado) * 100)
          : 0,
        imagen: imagenPrincipalPublica,
        imagenes: galeriaPublica,
        stock: esCombo ? (productoParaFiltros?.cantidad_disponible ?? null) : entidad.cantidad_disponible,
        variantes: variantesDto,
        opciones: opcionesDto,
        ofertas: ofertasDto,
        ficha: !esCombo ? (override?.ficha || null) : null,
        // Ídem para la ficha de Electrónica & Tecnología: solo lo que este
        // producto pisa en esta landing. El navegador la mezcla con
        // `content.ficha_tech` y con los campos del producto usando el
        // mismo módulo que usa el editor (templates/tech/fichaTech.js).
        ficha_tech: !esCombo ? (override?.ficha_tech || null) : null,
        // Ídem para la ficha de Beauty & Skin Care
        ficha_beauty: !esCombo ? (override?.ficha_beauty || null) : null,
        ficha_bazar: !esCombo ? (override?.ficha_bazar || null) : null,
        ficha_moda: !esCombo ? (override?.ficha_moda || null) : null,
        // Ídem para la ficha del template Básico
        ficha_basico: !esCombo ? (override?.ficha_basico || null) : null,
        // Ficha propia del Combo (ver templates/combo/fichaCombo.js en el
        // frontend). Mismo mecanismo que las otras: lo que este combo pisa
        // EN ESTA landing. El navegador la mezcla con `content.ficha_combo`
        // y con los campos propios del combo (Vista del combo).
        ficha_combo: esCombo ? (override?.ficha_combo || null) : null,
        // Rubro y campos propios del rubro, cargados en Mis Productos o en
        // la Vista del combo (especificaciones, "en la caja", comparativa
        // para Tecnología; ingredientes para Suplementos). Son DE LA
        // ENTIDAD, así que valen en todas sus landings sin volver a
        // cargarlos.
        ficha_rubro: entidad.ficha_rubro || null,
        ficha_datos: entidad.ficha_datos || {},
        faq: esCombo
          ? (override?.faq || entidad.preguntas_frecuentes || [])
          : (override?.faq || mapaFaq.get(entidad.id) || []),
        faq_titulo: override?.faq_titulo || entidad.faq_titulo || null,
        // Nombres nomás — lo que ya consumían ProductDetailBlock.jsx,
        // ProductPagePublica.jsx, VitrinaGrid.jsx, etc. (join(', ') en
        // varios lados). NO cambiar la forma acá: ver `productos_combo`
        // abajo para el detalle enriquecido que necesita la ficha nueva.
        productos_incluidos: esCombo ? (() => {
          const vistos = new Set();
          const nombres = [];
          const agregar = (prod) => {
            if (!prod || vistos.has(prod.id)) return;
            vistos.add(prod.id);
            nombres.push(prod.nombre);
          };
          agregar(mapaProducto.get(entidad.producto_padre?.id) || entidad.producto_padre);
          (entidad.items || []).forEach(i => agregar(mapaProducto.get(i.producto_incluido_id) || i.producto_incluido));
          return nombres.filter(Boolean);
        })() : undefined,
        // "Qué incluye"/"Detalle de cada producto" de la ficha del combo
        // (templates/combo/): cada producto que lo compone, con precio de
        // referencia e imagen (resueltos vía mapaProducto/mapaImagenes, ver
        // idsComponentesAjenos más arriba — los productos de un combo no
        // siempre son items propios de esta landing). Campo NUEVO y propio
        // de la ficha nueva — no lo lee nadie más, así que no pisa la forma
        // de `productos_incluidos` de arriba.
        productos_combo: esCombo ? (() => {
          const vistos = new Set();
          const agregar = (prod, cantidad = 1) => {
            if (!prod || vistos.has(prod.id)) return null;
            vistos.add(prod.id);
            const imgs = mapaImagenes.get(prod.id) || [];
            const principal = imgs.find(im => im.es_principal) || imgs[0];
            return {
              id: prod.id,
              nombre: prod.nombre,
              cantidad: Number(cantidad) || 1,
              precio: precioVentaProducto(prod),
              imagen: principal?.url || null,
              // Checks del detalle del combo: se reusan los beneficios que YA
              // tiene cargados ese producto individual — nada inventado.
              beneficios: (prod.beneficios || []).filter(b => b?.titulo?.trim()).map(b => b.titulo),
            };
          };
          return [
            agregar(mapaProducto.get(entidad.producto_padre?.id) || entidad.producto_padre, 1),
            ...(entidad.items || []).map(i => agregar(mapaProducto.get(i.producto_incluido_id) || i.producto_incluido, i.cantidad)),
          ].filter(Boolean);
        })() : [],
        // Campos de marketing / "Vista del producto" (o "Vista del combo").
        propuesta_valor: entidad.propuesta_valor || null,
        beneficios: entidad.beneficios || [],
        confianza: entidad.confianza || [],
        preguntas_frecuentes: entidad.preguntas_frecuentes || [],
        sobre_este_producto: esCombo
          ? (entidad.sobre_este_producto || null)
          : (override?.descripcion || entidad.sobre_este_producto || null),
        categoria: productoParaFiltros?.categoria?.nombre || null,
        marca: productoParaFiltros?.Marca?.nombre || null,
        etiqueta: item.etiqueta,
        envio_incluido: item.envio_incluido === true,
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

    // El banner sale si el comercio lo prendió y cargó ALGO en él. Antes la
    // condición miraba solo titulo/imagen, así que una portada con nada más
    // que subtítulo o botón no llegaba a la landing publicada aunque sí se
    // viera en el preview del editor.
    const hayContenidoBanner = !!(landing.banner_titulo || landing.banner_imagen
      || landing.banner_subtitulo || landing.banner_boton_texto);
    const bannerDto = (landing.mostrar_banner && hayContenidoBanner) ? {
      imagen: landing.banner_imagen,
      titulo: landing.banner_titulo,
      subtitulo: landing.banner_subtitulo,
      boton_texto: landing.banner_boton_texto,
      boton_link: landing.banner_boton_link,
      // Faltaba: la opacidad se edita en el armador y se veía en el preview,
      // pero nunca salía en el DTO, así que la landing publicada siempre
      // usaba el valor por defecto del template.
      opacidad: landing.banner_opacidad,
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
        testimonios: testimoniosDto,
        faq: faqDto,
        banner: bannerDto,
      });
    // Estas 3 llamadas son independientes entre si (delivery, pasarelas de
    // pago, landings hermanas) y ninguna depende del resultado de las otras
    // -- antes se esperaban una atras de otra, sumando 3 round-trips
    // completos a una DB que vive detras de un tunel (ver latencia real en
    // produccion). En paralelo, el costo es el de la mas lenta de las tres.
    const [deliveryCiudadesDto, pasarelasPublicas, landingsHermanas] = await Promise.all([
      this.obtenerOpcionesDelivery(tienda.usuario_id),
      PaymentService.getPublicGateways(tienda.usuario_id),
      Landing.findAll({
        where: { tienda_id: tienda.id, activo: true },
        attributes: ['tipo_pagina', 'slug', 'titulo', 'nombre'],
      }),
    ]);

    return {
      disponible: true,
      slug: landing.slug,
      es_home: landing.es_home,
      // El front lo usa para saber que en un funnel la landing ES la página
      // del producto (no hay :productId en la URL) — ver LandingPublica.jsx.
      tipo_pagina: tipoPaginaVirtual || landing.tipo_pagina,
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
      //
      // Un lienzo en blanco publica SOLO su código: nada del resto de
      // `content` (overrides por producto, borradores) tiene sentido ahí.
      content: esFunnel ? (landing.content || {}) : (esCodigo ? {
        codigo: {
          html: landing.content?.codigo?.html || '',
          css: landing.content?.codigo?.css || '',
          js: landing.content?.codigo?.js || '',
        },
        // Ficha de producto propia y configuración de venta (formato,
        // ventas cruzadas elegidas, recomendados): las lee el runtime.
        ...(landing.content?.vistas?.producto || landing.content?.vistas?.productos || landing.content?.vistas?.legales
          ? { vistas: this.vistasPublicas(landing.content, opciones.asegurarContentId, itemsDto.find(i => i.tipo === 'producto')?.content_id) }
          : {}),
        ...(landing.content?.venta ? { venta: { ...landing.content.venta, payment_logos: paymentLogos } } : { venta: { payment_logos: paymentLogos } }),
      } : {
        ofertas_carrito: landing.content?.ofertas_carrito || [],
        ofertas_producto_vista: landing.content?.ofertas_producto_vista || [],
        // Defaults de la ficha de producto que comparten todos los productos
        // de esta landing (barra de anuncio, garantías, cierre…). Es
        // configuración de presentación, no estado del editor: sin esto la
        // ficha publicada caería en los textos de fábrica aunque el comercio
        // los haya cambiado. Los overrides POR PRODUCTO siguen sin publicarse
        // en bloque — cada item trae solo el suyo, en `ficha`.
        ficha_fitness: landing.content?.ficha_fitness || null,
        ficha_tech: landing.content?.ficha_tech || null,
        // beauty faltaba: sin esta línea los defaults que el comercio
        // configuraba en el armador no llegaban a la landing publicada y la
        // ficha caía en los textos de fábrica.
        ficha_beauty: landing.content?.ficha_beauty || null,
        ficha_bazar: landing.content?.ficha_bazar || null,
        ficha_moda: landing.content?.ficha_moda || null,
        ficha_basico: landing.content?.ficha_basico || null,
        ficha_combo: landing.content?.ficha_combo || null,
        // Textos de la portada que no tienen columna propia (rótulo sobre
        // el título del encabezado, título de "Preguntas frecuentes").
        portada: landing.content?.portada || null,
      }),
      titulo: landing.titulo,
      descripcion: landing.descripcion,
      // Identidad/contacto propios de los templates rígidos — ver
      // landingSimple.service.js. En landings del sistema flexible quedan
      // en null (columnas nunca escritas ahí). Nombre distinto de
      // "contacto" (más abajo, el contacto heredado de Tienda) a propósito:
      // son dos conceptos distintos, no se pueden fusionar en una clave.
      logo_imagen: landing.logo_imagen || null,
      contacto_landing: LandingService.contactoLandingDto(landing, tienda),
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
        logo_imagen: tienda.logo_imagen || null,
        // Branding de Mi Tienda tal cual: la landing HTML (lienzo en blanco)
        // arranca con estos colores (ver --tienda-* en construirDocumentoCodigo).
        colores: coloresDeTienda(tienda),
      },
      // primario/fondo: null en la landing = hereda de Mi Tienda. En los
      // templates rígidos el comercio espera que el branding configurado en
      // "Mi tienda" pinte también sus fichas, catálogo y contacto; si una
      // landing quiere apartarse de esa marca, guarda sus propios colores.
      // Un embudo (esFunnel) es rígido igual que las landings de tienda: su
      // paleta default vive en el FRONTEND por slug de template (ver
      // funnelThemeUtils.js), nunca en Tienda.color_fondo — antes caía en
      // la rama de abajo (pensada para el sistema flexible), que sin
      // landing.tema_modo='claro' terminaba heredando el fondo oscuro de
      // la tienda y el embudo salía negro sin que el comercio lo pidiera.
      tema: (esRigida || esFunnel) ? {
        modo: landing.tema_modo,
        primario: landing.color_primario || (esRigida ? tienda.color_primario : null),
        secundario: tienda.color_secundario || null,
        fondo: landing.color_fondo || (esRigida ? tienda.color_fondo : null),
        // texto: sin override propio, las rígidas heredan el color
        // secundario de Branding para que toda la página acompañe los
        // colores configurados en Mi Tienda.
        texto: landing.color_texto || (esRigida ? (tienda.color_secundario || null) : null),
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
      typography,
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
        pasarelas: pasarelasPublicas,
      },
      // Opciones oficiales del checkout público. Nacen de la matriz de
      // tarifas de couriers activa para evitar cargar zonas por duplicado.
      delivery_ciudades: deliveryCiudadesDto,
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
      // `items` viaja SOLO cuando difiere de catalogo_items, o sea en las
      // plantillas rígidas, donde son los destacados del home. En el resto
      // (flexible, funnel, código) era el mismo array serializado dos veces:
      // 138 KB de los 498 KB que pesaba esta respuesta. Los consumidores lo
      // resuelven con `items ?? catalogo_items` — ver el `itemsHome` de
      // TiendaPaginaView.jsx y FunnelView.jsx. `undefined` desaparece del
      // JSON, no viaja como null.
      items: esRigida ? itemsHomeDto : undefined,
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
      paginas_hermanas: landingsHermanas.map(p => ({
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

  /**
   * Mismo mecanismo que overrideDeProducto() pero para combos — vive en
   * Landing.content.combos["<id>"]. Forma: { faq_titulo, faq, ficha_combo }.
   */
  static overrideDeCombo(contenidoLanding, comboId) {
    const porCombo = contenidoLanding?.combos;
    if (!porCombo || typeof porCombo !== 'object' || Array.isArray(porCombo)) return null;
    return porCombo[String(comboId)] || null;
  }

  static async obtenerCatalogoPublico(tienda, slug, preview = false, opciones = {}) {
    const {
      pagina = 1,
      porPagina = 20,
      orden = 'destacados',
      disponibilidad = 'todos',
      categoria = 'todas',
      marca = 'todas',
      etiqueta = 'todas',
      precioMin = null,
      precioMax = null,
      busqueda = '',
      soloInicio = false,
      soloDescuento = false,
    } = opciones;

    const where = { tienda_id: tienda.id };
    if (slug) where.slug = slug; else where.es_home = true;

    const landing = await Landing.findOne({
      where,
      include: [
        { model: LandingItem, as: 'items' },
        { model: LandingTemplate, as: 'template', required: false },
        { model: LandingSeccion, as: 'secciones', required: false, where: { producto_id: null } },
      ],
      order: [
        [{ model: LandingItem, as: 'items' }, 'orden', 'ASC'],
        [{ model: LandingSeccion, as: 'secciones' }, 'orden', 'ASC'],
      ],
    });
    if (!landing) return null;
    if (!tienda.activo || !tienda.Usuario?.activo) return { disponible: false };
    if (!landing.activo && !preview) return { disponible: false };

    // Sin registrarVisita, por lo mismo que en obtenerPublica: la cuenta el
    // navegador para que esta respuesta pueda vivir en el CDN.
    let seccionesInicio = [];
    if (landing.tipo_pagina !== 'inicio') {
      const inicio = await Landing.findOne({
        where: { tienda_id: tienda.id, tipo_pagina: 'inicio' },
        include: [{ model: LandingSeccion, as: 'secciones', required: false, where: { producto_id: null } }],
        order: [[{ model: LandingSeccion, as: 'secciones' }, 'orden', 'ASC']],
      });
      seccionesInicio = inicio?.secciones || [];
    }

    // Lienzo en blanco: la misma lista que vende (regla, manual o fallback).
    const items = landing.template?.kind === 'codigo'
      ? await this.itemsDelLienzo(landing, tienda)
      : (landing.items || []);
    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);

    // Fase 1: todo lo necesario para filtrar/ordenar/paginar sobre el
    // catálogo COMPLETO, pero SIN imágenes todavía. Si las imágenes (la
    // parte más pesada: varias filas por producto) se trajeran acá para
    // los idsProducto enteros, paginar no ahorraría nada — el punto de
    // paginar es no pagar esa galería completa para productos que ni
    // siquiera se van a mostrar en esta página.
    const [productos, combos, precios, deliveryCiudadesDto, pasarelasPublicas] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({
          where: { id: { [Op.in]: idsProducto }, activo: true, estado_venta: 'en_venta' },
          attributes: [
            'id', 'slug', 'nombre', 'descripcion_corta', 'precio_base', 'precio_minimo',
            'precio_tachado', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin',
            'cantidad_disponible', 'destacado', 'created_at',
          ],
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
              attributes: ['id', 'nombre', 'cantidad_disponible'],
              include: [{ association: 'categoria', attributes: ['nombre'] }, { model: Marca, attributes: ['nombre'] }],
            },
            { model: ProductoComboImagen, as: 'imagenes', attributes: ['id', 'url', 'orden', 'es_principal'] },
          ],
        })
        : Promise.resolve([]),
      (idsProducto.length || idsCombo.length)
        ? PrecioUsuario.findAll({
          where: {
            usuario_id: tienda.usuario_id,
            [Op.or]: [
              idsProducto.length ? { tipo: 'producto', referencia_id: { [Op.in]: idsProducto } } : null,
              idsCombo.length ? { tipo: 'combo', referencia_id: { [Op.in]: idsCombo } } : null,
            ].filter(Boolean),
          },
        })
        : Promise.resolve([]),
      // Antes venían hardcodeados en [] en esta vista liviana: el carrito de
      // la página de Catálogo (CartDrawer) se abría sin ciudades de envío ni
      // pasarelas de pago reales, aunque en el home/ficha de producto sí las
      // tenía. Van en el mismo Promise.all que el resto de fase 1 porque no
      // dependen de nada de acá — sumarlas no agrega ningún round-trip extra.
      this.obtenerOpcionesDelivery(tienda.usuario_id),
      PaymentService.getPublicGateways(tienda.usuario_id),
    ]);

    const mapaProducto = new Map(productos.map(p => [p.id, p]));
    const mapaCombo = new Map(combos.map(c => [c.id, c]));
    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));

    const resolverPrecioProducto = (prod, tipo = 'producto') => {
      const precioBase = parseFloat(tipo === 'combo' ? prod.precio_total : prod.precio_base);
      const precioMinimo = prod.precio_minimo !== null && prod.precio_minimo !== undefined ? parseFloat(prod.precio_minimo) : null;
      const precioUsuario = mapaPrecios.get(`${tipo}:${prod.id}`);
      const baseConDescuento = tipo === 'combo'
        ? precioBase
        : PricingService.aplicarDescuentoFecha(precioBase, prod.descuento_porcentaje, prod.descuento_inicio, prod.descuento_fin);
      return PricingService.calcularPrecioBase(baseConDescuento, precioMinimo, precioUsuario);
    };

    const resolverMedios = (override, imagenesBase, imagenesDto) => {
      const imagenPorId = new Map(imagenesBase.filter(img => img.id != null).map(img => [String(img.id), img]));
      const imagenPorUrl = new Map(imagenesBase.filter(img => img.url).map(img => [String(img.url), img]));
      const medios = Array.isArray(override?.medios)
        ? override.medios.map(m => {
          if (!m) return null;
          if (typeof m === 'string') return m;
          if (m.tipo === 'video') return m.url ? { tipo: 'video', url: m.url, titulo: m.titulo || '' } : null;
          const img = imagenPorId.get(String(m.imagen_id ?? m.id)) || imagenPorUrl.get(String(m.url || ''));
          return img?.url
            ? this.serializarImagenProducto(img)
            : (m.url ? { tipo: 'imagen', url: m.url } : null);
        }).filter(m => m && (typeof m === 'string' || m.url))
        : null;
      return medios?.length ? medios : imagenesDto;
    };

    // Listado liviano de TODO el catálogo (sin imágenes) — lo mínimo para
    // filtrar/ordenar/paginar correctamente. Si esto se recortara ANTES de
    // filtrar, un filtro por categoría podría no encontrar productos reales
    // que cayeron fuera de la página que se pidió.
    const listado = [];
    for (const item of items) {
      const esCombo = item.tipo === 'combo';
      const entidad = esCombo ? mapaCombo.get(item.referencia_id) : mapaProducto.get(item.referencia_id);
      if (!entidad) continue;

      const precio = resolverPrecioProducto(entidad, item.tipo);
      const precioEfectivo = precio.efectivo;
      let precioAntes = item.precio_ancla
        ? parseFloat(item.precio_ancla)
        : (!esCombo && entidad.precio_tachado ? parseFloat(entidad.precio_tachado) : null);
      if (!precioAntes && !esCombo && precio.base > precioEfectivo) precioAntes = precio.base;
      if (precioAntes <= precioEfectivo) precioAntes = null;

      const productoParaFiltros = esCombo ? entidad.producto_padre : entidad;

      listado.push({
        item, entidad, esCombo,
        content_id: entidad.slug || `${item.tipo}-${entidad.id}`,
        referencia_id: entidad.id,
        tipo: item.tipo,
        nombre: entidad.nombre,
        precio: precioEfectivo,
        precio_antes: precioAntes,
        stock: esCombo ? (productoParaFiltros?.cantidad_disponible ?? null) : entidad.cantidad_disponible,
        categoria: productoParaFiltros?.categoria?.nombre || null,
        marca: productoParaFiltros?.Marca?.nombre || null,
        etiqueta: item.etiqueta,
        destacado: esCombo ? false : !!entidad.destacado,
        creado: item.createdAt,
        mostrar_en_inicio: item.mostrar_en_inicio !== false,
      });
    }

    // Opciones de los filtros de categoría/etiqueta — sobre el catálogo
    // COMPLETO, nunca sobre la página ya recortada: si se calcularan sobre
    // la página, el desplegable iría perdiendo opciones a medida que el
    // visitante filtra o pagina.
    const categoriasDisponibles = [...new Set(listado.map(i => i.categoria).filter(Boolean))].sort();
    const normalizarFiltro = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    const etiquetasDe = i => String(i.etiqueta || '').split(',').map(t => t.trim()).filter(Boolean);
    const itemEnOferta = i => Number(i.precio_antes || 0) > Number(i.precio || 0);
    const tieneEtiqueta = (i, buscada) => {
      const normalizada = normalizarFiltro(buscada);
      return etiquetasDe(i).some(t => normalizarFiltro(t) === normalizada);
    };
    const etiquetasDisponibles = [];
    for (const etiquetaDisponible of listado.flatMap(etiquetasDe)) {
      if (!etiquetasDisponibles.some(t => normalizarFiltro(t) === normalizarFiltro(etiquetaDisponible))) {
        etiquetasDisponibles.push(etiquetaDisponible);
      }
    }
    if (listado.some(itemEnOferta) && !etiquetasDisponibles.some(t => normalizarFiltro(t) === 'oferta')) {
      etiquetasDisponibles.push('Oferta');
    }
    etiquetasDisponibles.sort((a, b) => {
      const oa = normalizarFiltro(a) === 'oferta' ? 0 : 20;
      const ob = normalizarFiltro(b) === 'oferta' ? 0 : 20;
      return oa === ob ? String(a).localeCompare(String(b), 'es') : oa - ob;
    });
    const marcasDisponibles = [...new Set(listado.map(i => i.marca).filter(Boolean))].sort();

    const min = precioMin !== null && precioMin !== '' && !Number.isNaN(Number(precioMin)) ? Number(precioMin) : null;
    const max = precioMax !== null && precioMax !== '' && !Number.isNaN(Number(precioMax)) ? Number(precioMax) : null;

    // Búsqueda sin distinguir mayúsculas ni tildes ("cafe" encuentra "Café").
    const sinTildes = t => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const termino = sinTildes(String(busqueda || '').trim().slice(0, 80));

    const filtrado = listado.filter(i => {
      if (soloInicio && !i.mostrar_en_inicio) return false;
      if (termino && !sinTildes(`${i.nombre} ${i.categoria || ''} ${i.marca || ''} ${i.etiqueta || ''}`).includes(termino)) return false;
      if (min !== null && i.precio < min) return false;
      if (max !== null && i.precio > max) return false;
      // stock null = no rastrea stock (siempre disponible) — solo se filtra
      // cuando el dato existe, mismo criterio que tenía el frontend.
      if (disponibilidad === 'en_stock' && i.stock != null && i.stock <= 0) return false;
      if (disponibilidad === 'agotado' && !(i.stock != null && i.stock <= 0)) return false;
      if (categoria && categoria !== 'todas' && i.categoria !== categoria) return false;
      if (marca && marca !== 'todas' && i.marca !== marca) return false;
      if (soloDescuento && !itemEnOferta(i)) return false;
      if (etiqueta && etiqueta !== 'todas') {
        const etiquetaOferta = normalizarFiltro(etiqueta) === 'oferta';
        if (etiquetaOferta) {
          if (!itemEnOferta(i) && !tieneEtiqueta(i, etiqueta)) return false;
        } else if (!tieneEtiqueta(i, etiqueta)) return false;
      }
      return true;
    });

    if (orden === 'az') filtrado.sort((a, b) => a.nombre.localeCompare(b.nombre));
    else if (orden === 'za') filtrado.sort((a, b) => b.nombre.localeCompare(a.nombre));
    else if (orden === 'min-max') filtrado.sort((a, b) => a.precio - b.precio);
    else if (orden === 'max-min') filtrado.sort((a, b) => b.precio - a.precio);
    // 'destacados' (default): se deja el orden natural (LandingItem.orden ASC).

    const total = filtrado.length;
    // Tope defensivo: nadie pide 100000 productos de una en un catálogo público.
    const porPaginaFinal = Math.min(Math.max(Number(porPagina) || 20, 1), 100);
    const totalPaginas = Math.max(1, Math.ceil(total / porPaginaFinal));
    const paginaFinal = Math.min(Math.max(Number(pagina) || 1, 1), totalPaginas);
    const pageSlice = filtrado.slice((paginaFinal - 1) * porPaginaFinal, paginaFinal * porPaginaFinal);

    // Fase 2: acá es donde se paga el ahorro real de paginar — las
    // imágenes (varias filas por producto) se piden SOLO para los
    // productos de esta página, no para el catálogo entero.
    const idsImagenPagina = pageSlice.filter(i => !i.esCombo).map(i => i.referencia_id);
    const imagenesPagina = idsImagenPagina.length
      ? await ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: idsImagenPagina } },
        attributes: ATRIBUTOS_IMAGEN_PRODUCTO,
        order: [['producto_id', 'ASC'], ['orden', 'ASC']],
      })
      : [];
    const variantesPagina = idsImagenPagina.length
      ? await ProductoVariante.findAll({ where: { producto_id: { [Op.in]: idsImagenPagina } }, attributes: ['producto_id'] })
      : [];
    const conVariantes = new Set(variantesPagina.map(v => v.producto_id));
    const mapaImagenes = new Map();
    imagenesPagina.forEach(img => {
      const lista = mapaImagenes.get(img.producto_id) || [];
      lista.push(this.serializarImagenProducto(img));
      mapaImagenes.set(img.producto_id, lista);
    });

    const itemsDto = pageSlice.map(({ item, entidad, esCombo, ...resto }) => {
      const override = esCombo
        ? this.overrideDeCombo(landing.content, entidad.id)
        : this.overrideDeProducto(landing.content, entidad.id);
      const galeriaFuente = esCombo
        ? (entidad.imagenes || []).slice()
          .sort((a, b) => (b.es_principal === true) - (a.es_principal === true) || (Number(a.orden) || 0) - (Number(b.orden) || 0))
          .map(img => ({ id: img.id, url: ImagenService.serializar(img).url }))
          .filter(img => img.url)
        : (mapaImagenes.get(entidad.id) || []);
      const galeriaGeneral = galeriaFuente.filter(i => !i.variante_id);
      const imagenesBase = galeriaGeneral.length ? galeriaGeneral : galeriaFuente;
      const imagenesDto = imagenesBase.map(i => this.serializarImagenProducto(i));
      const galeriaPublica = resolverMedios(override, imagenesBase, imagenesDto);
      const primeraImagen = (galeriaPublica || []).find(m => typeof m === 'string' || m?.tipo !== 'video');
      const imagenPrincipal = typeof primeraImagen === 'string' ? primeraImagen : (primeraImagen?.url || imagenesDto[0]?.url || imagenesDto[0] || null);

      return {
        content_id: resto.content_id,
        referencia_id: resto.referencia_id,
        tipo: resto.tipo,
        nombre: resto.nombre,
        descripcion: esCombo ? entidad.descripcion : (override?.descripcion || entidad.descripcion_corta),
        precio: resto.precio,
        precio_antes: resto.precio_antes,
        descuento_pct: resto.precio_antes ? Math.round((1 - resto.precio / resto.precio_antes) * 100) : 0,
        imagen: imagenPrincipal,
        imagenes: galeriaPublica,
        stock: resto.stock,
        categoria: resto.categoria,
        marca: resto.marca,
        etiqueta: resto.etiqueta,
        envio_incluido: item.envio_incluido === true,
        destacado: resto.destacado,
        creado: resto.creado,
        mostrar_en_inicio: resto.mostrar_en_inicio,
        // Esta vista es liviana: no trae variantes, solo avisa que existen
        // para que la landing lleve a la ficha a elegirlas.
        tiene_variantes: !esCombo && conVariantes.has(entidad.id),
        variantes: [],
        opciones: [],
        ofertas: [],
      };
    });

    const esRigida = landing.template?.kind === 'rigido';
    const esFunnel = landing.template?.kind === 'funnel';
    const typography = await TypographyService.resolver(tienda, landing);
    const seccionesCatalogoGuardadas = !esRigida && Array.isArray(landing.secciones) && landing.secciones.length
      ? this.construirSeccionesPublicas(landing, { testimonios: [], faq: [], banner: null }).secciones
      : [];
    const seccionesCatalogo = esRigida
      ? []
      : this.completarSeccionesCatalogoPublicas(seccionesCatalogoGuardadas, seccionesInicio);
    return {
      disponible: true,
      id: landing.id,
      slug: landing.slug,
      es_home: landing.es_home,
      tipo_pagina: landing.tipo_pagina,
      titulo: landing.titulo,
      logo_imagen: landing.logo_imagen || tienda.logo_imagen || null,
      productos_titulo: landing.productos_titulo || null,
      catalogo_titulo: landing.catalogo_titulo || null,
      catalogo_descripcion: landing.catalogo_descripcion || null,
      template: landing.template ? { slug: landing.template.slug, kind: landing.template.kind } : null,
      tienda: { nombre: tienda.nombre, subdominio: tienda.subdominio, logo_imagen: tienda.logo_imagen || null, colores: coloresDeTienda(tienda) },
      tema: (esRigida || esFunnel) ? {
        modo: landing.tema_modo,
        primario: landing.color_primario || (esRigida ? tienda.color_primario : null),
        secundario: tienda.color_secundario || null,
        fondo: landing.color_fondo || (esRigida ? tienda.color_fondo : null),
        texto: landing.color_texto || (esRigida ? (tienda.color_secundario || null) : null),
        tarjeta: landing.color_tarjeta || null,
      } : {
        modo: landing.tema_modo,
        primario: landing.color_primario || tienda.color_primario,
        secundario: tienda.color_secundario,
        fondo: landing.color_fondo || (landing.tema_modo === 'claro' ? '#f8fafc' : tienda.color_fondo),
        texto: landing.color_texto || null,
        tarjeta: landing.color_tarjeta || null,
      },
      typography,
      filtros: {
        categoria: landing.mostrar_filtro_categoria,
        marca: landing.mostrar_filtro_marca,
        etiqueta: landing.mostrar_filtro_etiqueta,
        buscador: landing.mostrar_buscador,
        orden_precio: landing.mostrar_orden_precio,
      },
      contacto_landing: LandingService.contactoLandingDto(landing, tienda),
      contacto: {
        whatsapp: landing.mostrar_whatsapp ? (tienda.whatsapp || null) : null,
        telefono: tienda.telefono,
        mensaje: tienda.mensaje_contacto,
        incluir_precio: !!landing.whatsapp_incluir_precio,
        incluir_url: !!landing.whatsapp_incluir_url,
      },
      content: { ofertas_carrito: [] },
      checkout: { redirigir_whatsapp: !!landing.checkout_redirigir_whatsapp, pasarelas: pasarelasPublicas },
      delivery_ciudades: deliveryCiudadesDto,
      banner: null,
      seo: {
        titulo: landing.seo_titulo || landing.titulo,
        descripcion: landing.seo_descripcion || landing.descripcion || null,
        keywords: landing.seo_keywords || null,
        og_imagen: landing.seo_og_imagen || landing.banner_imagen || null,
      },
      meta: {
        pixel_id: tienda.meta_pixel_id || null,
        capi_activo: !!tienda.meta_capi_activo,
        google_analytics_id: tienda.google_analytics_id || null,
        tiktok_pixel_id: tienda.tiktok_pixel_id || null,
      },
      // Acá `items` y `catalogo_items` eran siempre el mismo array (este
      // endpoint no distingue destacados del home): se manda una sola vez.
      catalogo_items: itemsDto,
      paginacion: { pagina: paginaFinal, porPagina: porPaginaFinal, total, totalPaginas },
      categorias_disponibles: categoriasDisponibles,
      etiquetas_disponibles: etiquetasDisponibles,
      marcas_disponibles: marcasDisponibles,
      secciones: seccionesCatalogo,
      secciones_producto: [],
      testimonios: [],
      faq: [],
      beneficios: [],
      paginas_hermanas: [],
    };
  }

  static async obtenerProductoPublico(tienda, slug, productoSlug) {
    // asegurarContentId: en un lienzo que vende cientos de productos, el
    // pedido puede no estar en la primera página que arma obtenerPublica.
    const landing = await this.obtenerPublica(tienda, slug, false, { asegurarContentId: productoSlug });
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
      // item.referencia_id ya ES el id del Producto (ver itemsDto en
      // obtenerPublica, mismo objeto): un Producto.findOne acá era una
      // vuelta de red entera para volver a resolver un id que el propio
      // catalogo ya traia.
      const productoId = item.referencia_id;
      {
        // Los relacionados elegidos EN ESTA LANDING mandan sobre la curación
        // global del producto — ver overrideDeProducto().
        // obtenerPublica devuelve un DTO con content sanitizado: los overrides
        // del editor deben leerse del registro autorizado de esta tienda.
        const configuracion = await Landing.findOne({
          where: { tienda_id: tienda.id, slug: landing.slug },
          attributes: ['content'],
        });
        const override = this.overrideDeProducto(configuracion?.content, productoId);
        const [propias, relacionadosDto] = await Promise.all([
          LandingSeccion.findAll({
            where: { producto_id: productoId, page_type: 'product', activo: true },
            order: [['orden', 'ASC']],
          }),
          require('./producto.service').listarRelacionados(productoId, tienda.inquilino_id, {
            idsForzados: Array.isArray(override?.relacionados) ? override.relacionados : null,
            titulo: override?.relacionados_titulo || null,
          }).catch(() => relacionados),
        ]);
        if (propias.length > 0) {
          seccionesProducto = propias.map(s => this.seccionDto(s));
        }
        relacionados = relacionadosDto;
        
        // Inyectar el precio ancla y etiqueta de la landing actual a los
        // productos relacionados. En plantillas rígidas `items` son solo los
        // destacados del home; el catálogo completo vive en `catalogo_items`.
        // Filtrar contra `items` borraba relacionados perfectamente válidos
        // que estaban configurados para la página de producto pero no para el
        // home.
        const catalogoRelacionados = landing.catalogo_items?.length ? landing.catalogo_items : (landing.items || []);
        if (relacionados && relacionados.items && catalogoRelacionados.length) {
          relacionados.items = relacionados.items.filter(relItem => 
            catalogoRelacionados.some(i => i.content_id === relItem.slug || (Number(i.referencia_id) === Number(relItem.id) && i.tipo === 'producto'))
          ).map(relItem => {
            const lItem = catalogoRelacionados.find(i => i.content_id === relItem.slug || (Number(i.referencia_id) === Number(relItem.id) && i.tipo === 'producto'));
            if (lItem) {
              return {
                ...relItem,
                precio: lItem.precio,
                precio_ancla: lItem.precio_antes ?? lItem.precio_ancla ?? null,
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
      secciones_producto: this.completarSeccionesProductoPublicas(seccionesProducto, landing.secciones),
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
  /**
   * Lienzo en blanco con selección por REGLA ("Todo el catálogo" / "Por
   * categoría", content.venta.seleccion): no hay LandingItem, los productos
   * salen de la regla. Devuelve los ids que la cumplen dentro del catálogo
   * de la tienda (nunca de otro inquilino), activos y a la venta.
   *
   * @param {{producto?: number[], combo?: number[], slugs?: string[]}|null} acotar
   *   Para el checkout: solo lo que pidió el carrito. null = hasta el tope.
   */
  static async itemsSegunReglaCodigo(landing, tienda, acotar = null) {
    const venta = landing.content?.venta || {};
    const porCategoria = venta.seleccion === 'categoria';
    const categorias = Array.isArray(venta.categorias) ? venta.categorias : [];
    if (porCategoria && !categorias.length) return [];
    const { inquilino_id } = tienda;
    const visibles = await this.visibilidadDeTienda(tienda);
    const whereProducto = { inquilino_id, activo: true, estado_venta: 'en_venta', ...visibles.producto };
    if (acotar) {
      whereProducto[Op.or] = [
        ...(acotar.producto?.length ? [{ id: { [Op.in]: acotar.producto } }] : []),
        ...(acotar.slugs?.length ? [{ slug: { [Op.in]: acotar.slugs } }] : []),
      ];
      if (!whereProducto[Op.or].length) delete whereProducto[Op.or];
    }
    const sinProductosPedidos = acotar && !acotar.producto?.length && !acotar.slugs?.length;
    const productos = sinProductosPedidos ? [] : await Producto.findAll({
      where: whereProducto,
      attributes: ['id', 'created_at'],
      include: porCategoria
        ? [{ model: Categoria, as: 'categoria', attributes: ['nombre'], where: { nombre: { [Op.in]: categorias } }, required: true }]
        : [],
      order: [['created_at', 'DESC']],
      limit: acotar ? undefined : MAX_ITEMS_POR_LANDING,
    });
    const items = productos.map((p, idx) => ({
      tipo: 'producto', referencia_id: p.id, precio_ancla: null, etiqueta: null,
      orden: idx, mostrar_en_inicio: true, envio_incluido: false, createdAt: p.created_at,
    }));
    if (venta.incluir_combos !== false && (!acotar || acotar.combo?.length)) {
      const combos = await ProductoCombo.findAll({
        where: { inquilino_id, estado: 'ACTIVO', ...visibles.combo, ...(acotar ? { id: { [Op.in]: acotar.combo } } : {}) },
        attributes: ['id', 'created_at'],
        limit: acotar ? undefined : MAX_ITEMS_POR_LANDING,
      });
      combos.forEach(c => items.push({
        tipo: 'combo', referencia_id: c.id, precio_ancla: null, etiqueta: null,
        orden: items.length, mostrar_en_inicio: true, envio_incluido: false, createdAt: c.created_at,
      }));
    }
    return items;
  }

  static async resolverCarrito(tienda, slug, items, throwOnStockInsuficiente = false) {
    const where = { tienda_id: tienda.id };
    if (slug) where.slug = slug; else where.es_home = true;

    const landing = await Landing.findOne({
      where,
      include: [
        { model: LandingItem, as: 'items' },
        { model: LandingTemplate, as: 'template', required: false, attributes: ['kind'] },
      ],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    if (!landing.activo || !tienda.activo || !tienda.Usuario?.activo) throw new Error('Esta landing no está disponible.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('El carrito está vacío.');
    if (items.length > MAX_ITEMS_CHECKOUT) throw new Error(`No se pueden pedir más de ${MAX_ITEMS_CHECKOUT} ítems distintos.`);

    const landingItems = landing.items || [];

    // Lienzo en blanco sin productos curados = catálogo por regla (o el
    // respaldo "todo el catálogo" de obtenerPublica): se arman los items
    // con lo que pide el carrito, validado contra la regla y el inquilino.
    if (landing.template?.kind === 'codigo' && !landingItems.length) {
      const acotar = { producto: [], combo: [], slugs: [] };
      for (const pedido of items) {
        const cid = String(pedido?.content_id || '');
        const m = cid.match(/^(producto|combo)-(\d+)$/);
        if (m) acotar[m[1]].push(Number(m[2]));
        else if (cid) acotar.slugs.push(cid);
      }
      landingItems.push(...await this.itemsSegunReglaCodigo(landing, tienda, acotar));
    }
    
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
            include: [
              {
                model: Producto,
                as: 'producto',
                attributes: ['id', 'nombre', 'sku', 'precio_costo', 'cantidad_disponible'],
                include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }]
              },
              { model: ProductoVariante, as: 'variante' },
            ]
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

    // Mismo criterio que mapaStock pero indexado por variante_id — un
    // componente de oferta puede apuntar a una variante puntual (fija o
    // elegida por el cliente) de un producto que ni siquiera es de esta
    // landing, así que hace falta este mapa aparte para validar su stock.
    const mapaVariantePorId = new Map(variantes.map(v => [v.id, v]));
    ofertasDisponibles.forEach(o => (o.componentes || []).forEach(c => {
      if (c.variante && !mapaVariantePorId.has(c.variante.id)) mapaVariantePorId.set(c.variante.id, c.variante);
    }));

    // content_id público (slug || "<tipo>-<id>") → item real de ESTA
    // landing — mismo identificador que le entrega obtenerPublica() al
    // navegador, así el carrito arma sus items con el mismo id que acá.
    const mapaPorContentId = new Map();
    for (const li of landingItems) {
      const entidad = li.tipo === 'producto' ? mapaProducto.get(li.referencia_id) : mapaCombo.get(li.referencia_id);
      if (!entidad) continue;
      mapaPorContentId.set(entidad.slug || `${li.tipo}-${entidad.id}`, {
        entidad,
        esCombo: li.tipo === 'combo',
        landingItem: li,
      });
    }

    const itemsResueltos = [];
    for (const pedido of items) {
      const itemLanding = mapaPorContentId.get(pedido?.content_id);
      if (!itemLanding) continue; // no está curado en esta landing — se descarta, nunca se inventa.
      const { entidad, esCombo, landingItem } = itemLanding;

      const precioUsuario = mapaPrecios.get(`${esCombo ? 'combo' : 'producto'}:${entidad.id}`);
      // "La cantidad decide el precio" (ver PricingService.mejorOfertaParaCantidad):
      // si no vino oferta_id explícita, el motor busca solo si la cantidad
      // matchea un pack existente de este producto.
      const ofertasDelProducto = esCombo ? [] : ofertasDisponibles.filter(o => o.producto_ancla_id === entidad.id);
      const variantesDelProducto = esCombo ? [] : (mapaVariantes.get(entidad.id) || []);

      // La variante que el cliente eligió para el componente "elegible" del
      // bump/upsell de esta línea (a lo sumo uno por oferta) nunca se
      // confía tal cual — tiene que ser una variante real del MISMO
      // producto que ese componente ofrece. Si no matchea (id inventado,
      // producto equivocado, oferta sin componente elegible), se ignora en
      // silencio y la oferta cae a la variante sugerida por el admin.
      let componenteVarianteId = null;
      if (!esCombo && pedido.oferta_id && pedido.componente_variante_id) {
        const ofertaCruda = ofertasDelProducto.find(o => o.id === Number(pedido.oferta_id));
        const elegible = (ofertaCruda?.componentes || []).find(c => c.permite_elegir_variante);
        if (elegible) {
          let varianteElegida = mapaVariantePorId.get(Number(pedido.componente_variante_id));
          if (!varianteElegida) {
            // El componente "elegible" de un bump puede ofrecer cualquier
            // producto del catálogo, no solo los de esta landing — sin esto,
            // una variante de un producto ajeno a la landing nunca aparecía
            // en mapaVariantePorId y quedaba descartada en silencio (ni se
            // registraba en el pedido ni se validaba su stock). Se resuelve
            // con una consulta puntual, solo cuando de verdad hace falta.
            varianteElegida = await ProductoVariante.findOne({
              where: { id: Number(pedido.componente_variante_id), producto_id: elegible.producto_id, activo: true },
            });
            if (varianteElegida) mapaVariantePorId.set(varianteElegida.id, varianteElegida);
          }
          if (varianteElegida && varianteElegida.producto_id === elegible.producto_id) {
            componenteVarianteId = Number(pedido.componente_variante_id);
          }
        }
      }

      const resuelto = PricingService.resolverPrecioItem({
        entidad,
        esCombo,
        cantidad: pedido.cantidad,
        ofertaId: !esCombo ? pedido.oferta_id : null,
        varianteId: !esCombo ? pedido.variante_id : null,
        componenteVarianteId,
        precioUsuario,
        ofertasDelProducto,
        variantesDelProducto,
      });

      // La "oferta" tiene una receta completa de componentes (puede tocar
      // más de un producto), por eso usa su propio chequeo en vez del
      // genérico de cantidad simple.
      const { suficiente, faltantes } = PricingService.validarStock(resuelto, { mapaProducto: mapaStock, mapaVariante: mapaVariantePorId });
      if (!suficiente && throwOnStockInsuficiente) {
        const err = new Error(`"${resuelto.nombre_final}" no tiene stock suficiente.`);
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
        // Fix de fondo: la variante REALMENTE resuelta para el producto
        // ancla de esta línea (no el eco de arriba) — es la que
        // envioController.js va a descontar de stock al confirmar.
        variante_id: resuelto.variante_aplicada ? resuelto.variante_aplicada.id : null,
        // Variante elegida por el cliente para el componente "elegible"
        // del bump/upsell que trajo esta línea (ya validada arriba).
        componente_variante_id: componenteVarianteId,
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
        envio_incluido: landingItem?.envio_incluido === true,
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
   * Valida un cupón contra el carrito y devuelve cuánto descontaría, sin
   * consumirlo. Los precios salen de resolverCarrito (o sea del servidor),
   * nunca de lo que mande el cliente: si no, cualquiera podría inflar el
   * precio para agrandar el descuento de un cupón porcentual.
   */
  static async validarCupon(tienda, slug, codigo, items) {
    const { itemsResueltos } = await this.resolverCarrito(tienda, slug, items, false);
    const subtotal = itemsResueltos.reduce((s, i) => s + i.subtotal, 0);

    const { cupon, descuento } = await CuponService.validar(
      codigo,
      itemsResueltos.map(i => ({
        producto_id: i.producto_id,
        precio_unitario: i.precio_unitario,
        cantidad: i.cantidad,
      })),
      tienda.usuario_id
    );

    return {
      codigo: cupon.codigo,
      descuento_porcentaje: Number(cupon.descuento_porcentaje),
      alcance: cupon.alcance,
      descuento,
      subtotal,
      total: Math.max(0, subtotal - descuento),
    };
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
   * @returns {{pedido_id: number, numero_pedido: number, monto: number, redirigir_whatsapp: boolean}}
   */
  /**
   * @param {object} [contexto] - {client_ip, client_user_agent, fbc, fbp, event_source_url}
   *   del navegador que compró, para el Purchase de la Conversions API.
   */
  static async crearCheckout(tienda, slug, datosCliente, contexto = {}) {
    const { nombre_cliente, documento, ruc, razon_social, quiere_factura, telefono, ciudad, departamento, direccion, referencia, items } = datosCliente || {};

    if (!nombre_cliente?.trim()) throw new Error('El nombre y apellido es obligatorio.');
    if (!telefono?.trim()) throw new Error('El celular es obligatorio.');
    if (!ciudad?.trim()) throw new Error('La ciudad es obligatoria.');
    if (!direccion?.trim()) throw new Error('La dirección es obligatoria.');

    const { landing, itemsResueltos } = await this.resolverCarrito(tienda, slug, items, true);

    const subtotal = itemsResueltos.reduce((s, i) => s + i.subtotal, 0);

    // El cupón se vuelve a validar y a calcular ACÁ, aunque el frontend ya
    // lo haya validado para mostrarlo: el importe que se cobra no puede
    // depender de lo que mande el cliente. Si el código dejó de ser válido
    // entre que lo aplicó y confirmó (venció, se agotó, lo apagaron), el
    // pedido se crea sin descuento en vez de fallar — el visitante ya
    // completó el formulario y perderlo por eso sería peor.
    let cuponAplicado = null;
    let descuentoCupon = 0;
    if (datosCliente?.cupon_codigo) {
      try {
        const r = await CuponService.validar(
          datosCliente.cupon_codigo,
          itemsResueltos.map(i => ({ producto_id: i.producto_id, precio_unitario: i.precio_unitario, cantidad: i.cantidad })),
          tienda.usuario_id
        );
        cuponAplicado = r.cupon;
        descuentoCupon = r.descuento;
      } catch (err) {
        console.warn('[checkout] cupón descartado:', err.message);
      }
    }

    const monto = Math.max(0, subtotal - descuentoCupon);
    const paymentMethod = datosCliente?.payment_method?.toLowerCase();
    const envioIncluido = itemsResueltos.length > 0 && itemsResueltos.every(i => i.envio_incluido === true);
    const opcionesDelivery = await this.obtenerOpcionesDelivery(tienda.usuario_id, {
      paymentMethod,
      items: itemsResueltos,
    });
    const opcionDelivery = envioIncluido || !opcionesDelivery.length
      ? null
      : this.buscarOpcionDelivery(opcionesDelivery, ciudad, departamento);

    if (!envioIncluido && opcionesDelivery.length && !opcionDelivery) {
      const error = new Error('La ciudad seleccionada no está disponible para delivery.');
      error.status = 400;
      throw error;
    }

    const costoEnvio = envioIncluido ? 0 : (Number(opcionDelivery?.costo) || 0);
    const courierIdDelivery = envioIncluido ? null : (opcionDelivery?.courier_id || null);
    const ciudadEnvio = opcionDelivery?.ciudad || ciudad.trim();
    const departamentoEnvio = opcionDelivery?.departamento || departamento?.trim() || null;
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
    const itemsParaEnvio = itemsResueltos.map(({ producto_id, variante_id, componente_variante_id, oferta_id, oferta_codigo, oferta_nombre, nombre_producto, cantidad, precio_unitario, precio_normal, origen_venta, subtotal }) => ({
      producto_id, variante_id, componente_variante_id, oferta_id, oferta_codigo, oferta_nombre, nombre_producto, cantidad, precio_unitario, precio_normal, origen_venta, subtotal,
    }));

    const nuevoEnvio = await sequelize.transaction(async (t) => {
      const numeroPedido = await PedidoNumeracion.reservarNumeroPedido(tienda.usuario_id, t);
      const envioCreado = await Envio.create({
        usuario_id: tienda.usuario_id,
        tienda_id: tienda.id,
        numero_pedido: numeroPedido,
        cliente: nombre_cliente.trim(),
        nombre_cliente: nombre_cliente.trim(),
        apellido_cliente: null,
        quiere_factura: tieneFactura,
        // La cedula es del comprador y va SIEMPRE que la haya: la pide la
        // pasarela para cobrar online, sin relacion con la factura.
        documento: documento?.trim() || null,
        ruc: rucLimpio,
        razon_social: razonSocialLimpia,
        telefono: telefono.trim(),
        ciudad: ciudadEnvio,
        departamento: departamentoEnvio,
        direccion: direccion.trim(),
        referencia: referencia?.trim() || null,
        monto,
        costo_envio: costoEnvio,
        costo_fulfillment: 0, // TODO: Calcular tarifa de servicio operativo de la red Gesicomm
        // El checkout público NO le suma el flete al comprador: `monto` es
        // subtotal − cupón, y el costo del courier queda como costo del
        // comercio. Sin dejarlo explícito, estos pedidos tomaban el default
        // 'cliente' y la reportería iba a leer que el flete lo pagó alguien
        // que en realidad nunca lo pagó.
        delivery_a_cargo: 'negocio',
        courier_id: courierIdDelivery,
        metodo_pago: 'Efectivo',
        estado: 'Pendiente',
        estado_logistico: 'Pendiente',
        // No 'Confirmado' (el default del modelo, pensado para carga manual
        // por personal de confianza) — acá nadie revisó todavía el pedido.
        estado_comercial: 'Pendiente',
        origen: 'LANDING',
        // El pedido nace con su canal puesto. `origen` queda como snapshot
        // de texto, pero la reportería agrupa por canal_venta_id: si esto no
        // se setea acá, cada venta de la landing aparece en "Sin canal" hasta
        // que alguien corra la migración de arranque (bug real: el pedido
        // #375 quedó fuera del embudo de Formularios Web por esto).
        canal_venta_id: await CanalVentaService.idPorSlug('web'),
        // De qué landing salió, para que el embudo del dashboard mida una sola
        // página de punta a punta (visitas Y pedidos) en vez de mezclar el
        // tráfico de una con las ventas de toda la tienda. `landing` viene de
        // resolverCarrito, que ya la resolvió por slug para armar el carrito.
        landing_id: landing ? landing.id : null,
        utm_source: datosCliente?.utm_source || null,
        utm_medium: datosCliente?.utm_medium || null,
        utm_campaign: datosCliente?.utm_campaign || null,
        // Código e importe como snapshot: el pedido tiene que poder explicar
        // por qué se cobró eso aunque después se borre o se edite el cupón.
        cupon_id: cuponAplicado ? cuponAplicado.id : null,
        cupon_codigo: cuponAplicado ? cuponAplicado.codigo : null,
        cupon_descuento: descuentoCupon,
        fecha: fechaPy,
        // El Kanban de Courier filtra "envíos del día" por ESTE campo, no por
        // "fecha" — sin setearlo, el pedido queda invisible en el tablero
        // sin importar qué fecha se elija (bug real: así se creó el #46).
        dispatchedAt: fechaPy,
        hora: horaPy,
        items: itemsParaEnvio,
      }, { include: [{ model: EnvioItem, as: 'items' }], transaction: t });

      // El uso se cuenta recién acá, con el pedido ya creado: validar un
      // código no lo gasta, así probarlo tres veces no agota un cupón de
      // "primeras 10 compras".
      if (cuponAplicado) {
        await CuponService.registrarUso(cuponAplicado.id, t);
      }

      await registrarHistorial(envioCreado.id, null, 'Pedido creado automáticamente', t);
      return envioCreado;
    });

    // Procesar pasarela de pago si fue solicitada (ej. payment_method === 'pagopar')
    let paymentData = null;
    
    if (paymentMethod === 'pagopar') {
      try {
        const trx = await PaymentService.createTransaction(nuevoEnvio, 'pagopar', null);
        paymentData = {
          payment_url: trx.payment_url,
          hash_pedido: trx.hash_pedido,
        };
      } catch (error) {
        console.error('[LandingService] Error al crear transacción de pago:', error.message);
        // El pedido YA está creado, así que no se aborta: queda como pendiente
        // de pago manual y el comercio lo ve igual. Pero se marca el fallo de
        // forma explícita para que el frontend NO lo trate como un pedido
        // normal — el cliente eligió pagar online y tiene que enterarse de
        // que no se pudo, en vez de terminar en WhatsApp sin explicación.
        paymentData = { error: error.message, payment_url: null };
      }
    }

    // Purchase para Meta (Pixel de la tienda configurado en Mi Tienda). Con
    // PagoPar se manda recién al confirmarse el pago (confirmarPedidoPagado):
    // acá el pedido todavía puede quedar sin pagar. No se espera: la
    // respuesta al comprador no depende de la Graph API.
    let purchaseEventId = null;
    if (paymentMethod !== 'pagopar') {
      purchaseEventId = MetaCapiService.eventIdCompra(nuevoEnvio);
      MetaCapiService.enviarCompra(nuevoEnvio, {
        tienda,
        contexto,
        numItems: itemsParaEnvio.reduce((s, i) => s + (Number(i.cantidad) || 0), 0),
      });
    }

    return {
      pedido_id: nuevoEnvio.id,
      numero_pedido: nuevoEnvio.numero_pedido,
      // Mismo event_id que acaba de ir por CAPI: el navegador lo usa para su
      // fbq('track', 'Purchase') y Meta cuenta una sola compra.
      purchase_event_id: purchaseEventId,
      monto,
      costo_envio: costoEnvio,
      envio_incluido: envioIncluido,
      courier_id: courierIdDelivery,
      redirigir_whatsapp: !!landing.checkout_redirigir_whatsapp,
      payment_data: paymentData,
    };
  }

}

module.exports = LandingService;
module.exports.MAX_ITEMS_LIENZO = MAX_ITEMS_LIENZO;
