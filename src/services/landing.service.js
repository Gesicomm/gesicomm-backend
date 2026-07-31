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
const { Landing, LandingItem, Producto, ProductoCombo, Marca, PrecioUsuario, ProductoImagen } = require('../models');

const MAX_ITEMS_POR_LANDING = 40;
const MAX_LANDINGS_POR_TIENDA = 5;

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

  static validarPayload(payload) {
    const errores = [];
    if (Array.isArray(payload.items) && payload.items.length > MAX_ITEMS_POR_LANDING) {
      errores.push(`No se pueden agregar más de ${MAX_ITEMS_POR_LANDING} items a una landing.`);
    }
    return errores;
  }

  static normalizarEtiqueta(etiqueta) {
    if (!etiqueta) return null;
    const limpio = String(etiqueta).trim().replace(/\s+/g, ' ');
    return limpio || null;
  }

  /** Valida que cada item exista, esté activo y pertenezca al mismo inquilino. */
  static async resolverItemsCatalogo(items, inquilino_id) {
    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => Number(i.referencia_id));
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => Number(i.referencia_id));

    const [productos, combos] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({ where: { id: { [Op.in]: idsProducto }, inquilino_id, activo: true }, attributes: ['id'] })
        : Promise.resolve([]),
      idsCombo.length
        ? ProductoCombo.findAll({ where: { id: { [Op.in]: idsCombo }, inquilino_id, estado: 'ACTIVO' }, attributes: ['id'] })
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

  /** Como máximo una landing es_home por tienda — desmarca cualquier otra. */
  static async asegurarHomeUnica(tienda_id, excluirId = null) {
    const where = { tienda_id, es_home: true };
    if (excluirId) where.id = { [Op.ne]: excluirId };
    await Landing.update({ es_home: false }, { where });
  }

  // ─── Campos simples (comunes a crear/actualizar) ────────────────────────

  static camposEditables(payload) {
    const campos = {};
    for (const campo of ['nombre', 'titulo', 'descripcion']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo] || null;
    }
    for (const flag of ['mostrar_filtro_categoria', 'mostrar_filtro_marca', 'mostrar_filtro_etiqueta', 'mostrar_buscador', 'mostrar_orden_precio']) {
      if (payload[flag] !== undefined) campos[flag] = !!payload[flag];
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

    const esHome = !!payload.es_home;
    if (esHome) await this.asegurarHomeUnica(tienda_id);

    const landing = await Landing.create({
      inquilino_id,
      tienda_id,
      ...this.camposEditables(payload),
      nombre: payload.nombre.trim(),
      titulo: payload.titulo?.trim() || payload.nombre.trim(),
      slug,
      es_home: esHome,
      activo: false,
    });

    await this.sincronizarItems(landing.id, items);

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

    if (payload.es_home !== undefined) {
      const esHome = !!payload.es_home;
      if (esHome && !landing.es_home) await this.asegurarHomeUnica(tienda_id, landing.id);
      landing.es_home = esHome;
    }

    Object.assign(landing, this.camposEditables(payload));
    await landing.save();

    if (payload.items !== undefined) {
      await this.sincronizarItems(landing.id, payload.items);
    }

    return this.obtener(landing.id, tienda_id);
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
      include: [{ model: LandingItem, as: 'items', order: [['orden', 'ASC']] }],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    return landing.toJSON();
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
      include: [{ model: LandingItem, as: 'items', order: [['orden', 'ASC']] }],
    });
    if (!landing) return null;

    if (!landing.activo || !tienda.activo || !tienda.Usuario?.activo) return { disponible: false };

    const items = landing.items || [];
    const idsProducto = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
    const idsCombo = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);

    const [productos, combos] = await Promise.all([
      idsProducto.length
        ? Producto.findAll({
          where: { id: { [Op.in]: idsProducto }, activo: true, estado_venta: 'en_venta' },
          include: [{ association: 'categoria', attributes: ['nombre'] }, { model: Marca, attributes: ['nombre'] }],
        })
        : Promise.resolve([]),
      idsCombo.length
        ? ProductoCombo.findAll({
          where: { id: { [Op.in]: idsCombo }, estado: 'ACTIVO' },
          include: [{
            model: Producto,
            as: 'producto_padre',
            where: { activo: true },
            include: [{ association: 'categoria', attributes: ['nombre'] }, { model: Marca, attributes: ['nombre'] }],
          }],
        })
        : Promise.resolve([]),
    ]);

    const referenciasProducto = productos.map(p => p.id);
    const referenciasCombo = combos.map(c => c.id);
    // Imagen principal: para combos se usa la del producto_padre (los combos no tienen imagen propia).
    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
    ];

    // precios e imagenes solo dependen de los IDs ya resueltos arriba, no
    // entre sí — en paralelo en vez de uno atrás del otro.
    const [precios, imagenes] = await Promise.all([
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
        ? ProductoImagen.findAll({
          where: { producto_id: { [Op.in]: idsParaImagen }, es_principal: true },
          attributes: ['producto_id', 'url'],
        })
        : Promise.resolve([]),
    ]);
    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));
    const mapaImagenes = new Map(imagenes.map(img => [img.producto_id, img.url]));

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
      let precioEfectivo = precioUsuario !== undefined ? precioUsuario : precioBase;
      if (precioMinimo !== null) precioEfectivo = Math.max(precioEfectivo, precioMinimo);

      itemsDto.push({
        // ID público estable — nunca LandingItem.id (cambiaría entre landings para el mismo producto).
        content_id: entidad.slug || `${item.tipo}-${entidad.id}`,
        tipo: item.tipo,
        nombre: entidad.nombre,
        descripcion: esCombo ? entidad.descripcion : entidad.descripcion_corta,
        precio: precioEfectivo,
        imagen: productoParaFiltros ? (mapaImagenes.get(productoParaFiltros.id) || null) : null,
        categoria: productoParaFiltros?.categoria?.nombre || null,
        marca: productoParaFiltros?.Marca?.nombre || null,
        etiqueta: item.etiqueta,
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
      tema: {
        primario: tienda.color_primario,
        secundario: tienda.color_secundario,
        fondo: tienda.color_fondo,
      },
      filtros: {
        categoria: landing.mostrar_filtro_categoria,
        marca: landing.mostrar_filtro_marca,
        etiqueta: landing.mostrar_filtro_etiqueta,
        buscador: landing.mostrar_buscador,
        orden_precio: landing.mostrar_orden_precio,
      },
      contacto: {
        whatsapp: tienda.whatsapp,
        telefono: tienda.telefono,
        mensaje: tienda.mensaje_contacto,
      },
      items: itemsDto,
    };
  }
}

module.exports = LandingService;
