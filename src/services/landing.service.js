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
  ProductoImagen, ProductoVariante, LandingEvento, Testimonio, Faq, Envio, EnvioItem,
} = require('../models');
const { resolverRangoFechas } = require('../utils/rangoFechas');

const MAX_ITEMS_POR_LANDING = 40;
const MAX_TESTIMONIOS_POR_LANDING = 20;
const MAX_FAQ_POR_LANDING = 20;
const MAX_ITEMS_CHECKOUT = 40;
// MVP: una sola landing por tienda, siempre en la raíz (es_home=true) — no
// hay UI para elegir slug ni marcar "página principal", así que una
// segunda landing quedaría inaccesible igual. Multi-landing por tienda
// queda para si el negocio lo pide más adelante; multi-TIENDA por cliente
// es el eje que sí está planeado (ver Tienda.js).
const MAX_LANDINGS_POR_TIENDA = 1;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

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
    return /^https?:\/\//i.test(limpio) || limpio.startsWith('/');
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

  /**
   * Fórmula de precio real de un item — la usan obtenerPublica() (lo que
   * VE el visitante) y crearCheckout() (lo que efectivamente se cobra en
   * el pedido), para que nunca puedan desincronizarse entre sí.
   *
   * @param {number} precioBase - precio_base (producto) o precio_total (combo).
   * @param {number|null} precioMinimo - piso vigente, o null si no tiene.
   * @param {number|undefined} precioUsuario - precio propio de la vendedora, si fijó uno.
   * @returns {{base: number, efectivo: number}} `base` (sin piso, ancla para el delta
   *   de variante) y `efectivo` (con el piso ya aplicado — precio final si no hay variante).
   */
  static calcularPrecioBase(precioBase, precioMinimo, precioUsuario) {
    const base = precioUsuario !== undefined && precioUsuario !== null ? precioUsuario : precioBase;
    const efectivo = precioMinimo !== null ? Math.max(base, precioMinimo) : base;
    return { base, efectivo };
  }

  /**
   * precio_diferencial es un delta ABSOLUTO que fijó el admin sobre el
   * precio base (ej: "el talle XL cuesta 10.000 más"). Se aplica sobre
   * `base` (sin piso) y se vuelve a pisar por precioMinimo — ninguna
   * variante puede venderse por debajo del piso.
   */
  static calcularPrecioVariante(base, precioDiferencial, precioMinimo) {
    let precio = base + parseFloat(precioDiferencial);
    if (precioMinimo !== null) precio = Math.max(precio, precioMinimo);
    return precio;
  }

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
      orden: item.orden !== undefined ? Number(item.orden) : idx,
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

  // ─── Campos simples (comunes a crear/actualizar) ────────────────────────

  static camposEditables(payload) {
    const campos = {};
    for (const campo of ['nombre', 'titulo', 'descripcion']) {
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
    const cantidadActual = await Landing.count({ where: { tienda_id } });
    if (cantidadActual >= MAX_LANDINGS_POR_TIENDA) {
      throw new Error(`Ya alcanzaste el máximo de ${MAX_LANDINGS_POR_TIENDA} landings.`);
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
      // Con el cap de 1 landing por tienda, siempre es la landing raíz —
      // no hay ninguna otra con la que competir por el home. El slug se
      // sigue generando (columna NOT NULL) pero no se usa para resolverla:
      // obtenerPublica()/obtenerIdParaEvento() la sirven en "/l" directo.
      es_home: true,
      activo: false,
    });

    await this.sincronizarItems(landing.id, items);
    if (payload.testimonios !== undefined) await this.sincronizarTestimonios(landing.id, payload.testimonios);
    if (payload.faq !== undefined) await this.sincronizarFaq(landing.id, payload.faq);

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

  static async obtener(id, tienda_id) {
    const landing = await Landing.findOne({
      where: { id, tienda_id },
      include: [
        { model: LandingItem, as: 'items' },
        { model: Testimonio, as: 'testimonios' },
        { model: Faq, as: 'faq' },
      ],
      // El orden de una asociación se declara acá arriba, no dentro del
      // include: ahí Sequelize lo ignora en silencio y los items vuelven
      // en orden de inserción, perdiendo el orden que definió el usuario.
      order: [
        [{ model: LandingItem, as: 'items' }, 'orden', 'ASC'],
        [{ model: Testimonio, as: 'testimonios' }, 'orden', 'ASC'],
        [{ model: Faq, as: 'faq' }, 'orden', 'ASC'],
      ],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    return landing.toJSON();
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

    if (activo) {
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
   * @param {object} tienda - instancia de Tienda ya resuelta por
   *   middleware/resolverTienda (con Usuario incluido, para chequear
   *   si el dueño sigue activo).
   * @param {string|null} slug - null/undefined → landing es_home de la tienda.
   * @returns {null} nunca existió una landing con ese slug/home en esta tienda (el caller responde 404 real)
   * @returns {{disponible:false}} la landing existe pero está despublicada, o la tienda/dueño está inactivo
   * @returns {{disponible:true, ...}} landing pública lista para renderizar
   */
  static async obtenerPublica(tienda, slug) {
    const where = { tienda_id: tienda.id };
    if (slug) where.slug = slug; else where.es_home = true;

    const landing = await Landing.findOne({
      where,
      include: [{ model: LandingItem, as: 'items' }],
      // Ver nota en obtener(): el orden va acá, no dentro del include.
      order: [[{ model: LandingItem, as: 'items' }, 'orden', 'ASC']],
    });
    if (!landing) return null;

    if (!landing.activo || !tienda.activo || !tienda.Usuario?.activo) return { disponible: false };

    // No se awaitea — ver comentario en registrarVisita(). Una landing
    // pública nunca debe tardar más porque falló (o tardó) un INSERT de
    // tracking.
    this.registrarVisita(landing.id);

    const items = landing.items || [];
    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);

    const [productos, combos, testimonios, faqs] = await Promise.all([
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
      landing.mostrar_testimonios
        ? Testimonio.findAll({ where: { landing_id: landing.id }, order: [['orden', 'ASC']] })
        : Promise.resolve([]),
      landing.mostrar_faq
        ? Faq.findAll({ where: { landing_id: landing.id }, order: [['orden', 'ASC']] })
        : Promise.resolve([]),
    ]);

    const referenciasProducto = productos.map(p => p.id);
    const referenciasCombo = combos.map(c => c.id);
    // Imagen/galería: para combos se usa la del producto_padre (los combos no tienen imagen propia).
    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
    ];

    // precios, imagenes y variantes solo dependen de los IDs ya resueltos
    // arriba, no entre sí — en paralelo en vez de uno atrás del otro.
    const [precios, imagenes, variantes] = await Promise.all([
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
    ]);
    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));

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
      const { base: precioBaseEfectivo, efectivo: precioEfectivo } = this.calcularPrecioBase(precioBase, precioMinimo, precioUsuario);

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
        const precioVariante = this.calcularPrecioVariante(precioBaseEfectivo, v.precio_diferencial, precioMinimo);
        return {
          id: v.id,
          nombre: v.nombre,
          stock: v.stock,
          precio_efectivo: precioVariante,
          imagenes: galeriaFuente.filter(i => i.variante_id === v.id).map(i => i.url),
        };
      }) : [];

      itemsDto.push({
        // ID público estable — nunca LandingItem.id (cambiaría entre landings para el mismo producto).
        content_id: entidad.slug || `${item.tipo}-${entidad.id}`,
        tipo: item.tipo,
        nombre: entidad.nombre,
        descripcion: esCombo ? entidad.descripcion : entidad.descripcion_corta,
        descripcion_larga: esCombo ? null : entidad.descripcion_larga,
        precio: precioEfectivo,
        imagen: imagenesDto[0] || null,
        imagenes: imagenesDto,
        stock: esCombo ? (productoParaFiltros?.cantidad_disponible ?? null) : entidad.cantidad_disponible,
        variantes: variantesDto,
        productos_incluidos: esCombo ? (entidad.items || []).map(i => i.producto_incluido?.nombre).filter(Boolean) : undefined,
        categoria: productoParaFiltros?.categoria?.nombre || null,
        marca: productoParaFiltros?.Marca?.nombre || null,
        etiqueta: item.etiqueta,
        // Producto.destacado ya existe en el catálogo (lo marca la dueña
        // en el picker de la landing) — los combos nunca son destacados.
        destacado: esCombo ? false : !!entidad.destacado,
        // Fecha real (LandingItem.created_at) para el badge "Nuevo".
        creado: item.createdAt,
      });
    }

    return {
      disponible: true,
      slug: landing.slug,
      es_home: landing.es_home,
      titulo: landing.titulo,
      descripcion: landing.descripcion,
      tienda: {
        nombre: tienda.nombre,
        subdominio: tienda.subdominio,
      },
      // primario/fondo: null en la landing = hereda el default de Tienda.
      // "claro" nunca hereda el fondo oscuro de la tienda (pensado para
      // dark mode) — si no hay override, usa un neutro claro razonable.
      tema: {
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
      banner: (landing.mostrar_banner && (landing.banner_titulo || landing.banner_imagen)) ? {
        imagen: landing.banner_imagen,
        titulo: landing.banner_titulo,
        subtitulo: landing.banner_subtitulo,
        boton_texto: landing.banner_boton_texto,
        boton_link: landing.banner_boton_link,
      } : null,
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
      items: itemsDto,
      testimonios: testimonios.map(t => ({
        nombre: t.nombre,
        foto: t.foto,
        calificacion: t.calificacion,
        comentario: t.comentario,
      })),
      faq: faqs.map(f => ({
        pregunta: f.pregunta,
        respuesta: f.respuesta,
      })),
    };
  }

  /**
   * Checkout público — crea un Envío (Pedido) real en estado "Pendiente" a
   * partir de lo que completó un visitante anónimo. Es un endpoint sin
   * autenticación: nunca se confía en precio/monto que mande el cliente,
   * se resuelve todo contra el catálogo real con calcularPrecioBase()/
   * calcularPrecioVariante() — la MISMA fórmula que ve el visitante en
   * obtenerPublica(), para que la landing y lo que efectivamente se cobra
   * en el pedido nunca puedan desincronizarse.
   *
   * Tampoco se acepta cualquier content_id: solo los que están curados de
   * verdad en ESTA landing (mismo principio que ya aplica
   * obtenerCatalogoParaEvento()/limpiarItems() para el tracking de eventos)
   * — lo que mande el cliente fuera de ese conjunto se ignora en silencio.
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
    const where = { tienda_id: tienda.id };
    if (slug) where.slug = slug; else where.es_home = true;

    const landing = await Landing.findOne({ where, include: [{ model: LandingItem, as: 'items' }] });
    if (!landing) throw new Error('Landing no encontrada.');
    if (!landing.activo || !tienda.activo || !tienda.Usuario?.activo) throw new Error('Esta landing no está disponible.');

    const { nombre_cliente, ruc, telefono, ciudad, departamento, direccion, referencia, items } = datosCliente || {};

    if (!nombre_cliente?.trim()) throw new Error('El nombre y apellido es obligatorio.');
    if (!telefono?.trim()) throw new Error('El celular es obligatorio.');
    if (!ciudad?.trim()) throw new Error('La ciudad es obligatoria.');
    if (!direccion?.trim()) throw new Error('La dirección es obligatoria.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('El carrito está vacío.');
    if (items.length > MAX_ITEMS_CHECKOUT) throw new Error(`No se pueden pedir más de ${MAX_ITEMS_CHECKOUT} ítems distintos.`);

    const landingItems = landing.items || [];
    const idsProducto = landingItems.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = landingItems.filter(i => i.tipo === 'combo').map(i => i.referencia_id);

    const [productos, combos] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({ where: { id: { [Op.in]: idsProducto }, activo: true, estado_venta: 'en_venta' } })
        : Promise.resolve([]),
      idsCombo.length
        ? ProductoCombo.findAll({
          where: { id: { [Op.in]: idsCombo }, estado: 'ACTIVO' },
          include: [{ model: Producto, as: 'producto_padre', where: { activo: true } }],
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
      const resuelto = mapaPorContentId.get(pedido?.content_id);
      if (!resuelto) continue; // no está curado en esta landing — se descarta, nunca se inventa.
      const { entidad, esCombo } = resuelto;
      const cantidad = Math.max(1, Math.min(99, Number.parseInt(pedido.cantidad, 10) || 1));

      const precioBase = parseFloat(esCombo ? entidad.precio_total : entidad.precio_base);
      const precioMinimo = entidad.precio_minimo !== null && entidad.precio_minimo !== undefined ? parseFloat(entidad.precio_minimo) : null;
      const precioUsuario = mapaPrecios.get(`${esCombo ? 'combo' : 'producto'}:${entidad.id}`);
      const { base, efectivo } = this.calcularPrecioBase(precioBase, precioMinimo, precioUsuario);

      let precioFinal = efectivo;
      let stockDisponible = esCombo ? (entidad.producto_padre?.cantidad_disponible ?? null) : entidad.cantidad_disponible;
      let nombreFinal = entidad.nombre;

      if (!esCombo && pedido.variante_id) {
        const variante = (mapaVariantes.get(entidad.id) || []).find(v => v.id === Number(pedido.variante_id));
        if (variante) {
          precioFinal = this.calcularPrecioVariante(base, variante.precio_diferencial, precioMinimo);
          stockDisponible = variante.stock;
          nombreFinal = `${entidad.nombre} (${variante.nombre})`;
        }
      }

      if (stockDisponible !== null && stockDisponible !== undefined && stockDisponible < cantidad) {
        const err = new Error(`"${nombreFinal}" no tiene stock suficiente (disponible: ${stockDisponible}).`);
        err.status = 409;
        throw err;
      }

      itemsResueltos.push({
        // Los combos no tienen fila propia en Producto — igual que ya pasa
        // con los pedidos cargados a mano (ver envioController.js), un
        // EnvioItem sin producto_id no participa del descuento de stock al
        // confirmar (el "stock" de un combo lo da su producto_padre, no
        // hay campo propio que descontar).
        producto_id: esCombo ? null : entidad.id,
        nombre_producto: nombreFinal,
        cantidad,
        precio_unitario: precioFinal,
        subtotal: precioFinal * cantidad,
      });
    }

    if (!itemsResueltos.length) throw new Error('Ningún producto del carrito está disponible en esta landing.');

    const monto = itemsResueltos.reduce((s, i) => s + i.subtotal, 0);
    const hoy = new Date();

    const nuevoEnvio = await Envio.create({
      usuario_id: tienda.usuario_id,
      cliente: nombre_cliente.trim(),
      nombre_cliente: nombre_cliente.trim(),
      apellido_cliente: null,
      ruc: ruc?.trim() || null,
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
      fecha: hoy.toISOString().split('T')[0],
      hora: hoy.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }),
      items: itemsResueltos,
    }, { include: [{ model: EnvioItem, as: 'items' }] });

    return {
      pedido_id: nuevoEnvio.id,
      monto,
      redirigir_whatsapp: !!landing.checkout_redirigir_whatsapp,
    };
  }
}

module.exports = LandingService;
