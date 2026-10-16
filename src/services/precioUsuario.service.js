'use strict';

/**
 * Servicio de "Vitrina" — catálogo y precios propios del rol 'usuario'.
 *
 * Un usuario con rol 'usuario' ve el mismo catálogo activo que administra
 * el admin (productos + combos), pero puede definir su PROPIO precio de
 * venta para cada uno (pensado para su futura landing), siempre que no
 * caiga por debajo del precio_minimo que fijó el admin.
 *
 * precio_costo NUNCA se expone a este rol. El análisis de sensibilidad
 * sí expone utilidad/margen derivados (pedido explícito de negocio),
 * pero no el costo crudo.
 */

const { Op } = require('sequelize');
const { sequelize, Producto, ProductoCombo, ProductoComboItem, ProductoComboImagen, ProductoImagen, PrecioUsuario, Marca, ProductoVariante, Oferta, Categoria } = require('../models');
const ComboConfiguracionService = require('./comboConfiguracion.service');
const ComboService = require('./combo.service');
const comboPricing = require('../utils/comboPricing');
const ImagenService = require('./imagen.service');
const PricingService = require('./pricing.service');

class PrecioUsuarioService {

  // OJO: a propósito NO usa precioConDescuentoVigente — esta es la vista
  // de "Mi catálogo" del comercio, donde el precio propio (precioUsuario)
  // siempre gana por diseño (ver tests vitrina-precio-publico y
  // vitrina-combo-precio-publico). El descuento por fecha que SÍ se cobra
  // de verdad vive en el checkout/landing pública (ver PricingService).
  static precioPublico(producto, precioUsuario) {
    const descontado = PricingService.aplicarDescuentoFecha(Number(producto.precio_base), producto.descuento_porcentaje, producto.descuento_inicio, producto.descuento_fin);
    const minimo = producto.precio_minimo == null ? null : Number(producto.precio_minimo);
    const { base, efectivo } = PricingService.calcularPrecioBase(descontado, minimo, precioUsuario);
    return { precio_publico: efectivo, precio_publico_base: base };
  }

  // La tarjeta del armador debe ofrecer las mismas opciones que la pública.
  // Solo consultamos los IDs visibles, en dos consultas por catálogo.
  static async idsConOpciones(productos, inquilino_id) {
    const ids = productos.map(p => p.id);
    if (!ids.length) return new Set();
    const [variantes, ofertas] = await Promise.all([
      ProductoVariante.findAll({ where: { producto_id: { [Op.in]: ids }, inquilino_id, activo: true }, attributes: ['producto_id'], raw: true }),
      Oferta.findAll({ where: { producto_ancla_id: { [Op.in]: ids }, inquilino_id, activo: true, estrategia: 'normal' }, attributes: ['producto_ancla_id'], raw: true }),
    ]);
    return new Set([...variantes.map(v => v.producto_id), ...ofertas.map(o => o.producto_ancla_id)]);
  }

  static async obtenerPrecioPersonalizado(usuario_id, tipo, referencia_id) {
    return PrecioUsuario.findOne({ where: { usuario_id, tipo, referencia_id } });
  }

  /**
   * Adjunta label/severity (comboPricing.RENTABILIDAD_META) a cada fila de
   * sensibilidad. El frontend nunca debe reimplementar este mapeo: lee
   * `label`/`severity` directo de la respuesta.
   */
  static anotarSensibilidad(filas) {
    return filas.map(fila => ({ ...fila, ...comboPricing.RENTABILIDAD_META[fila.status] }));
  }

  static anotarEstado(margin, minimumMarginDecimal) {
    const status = comboPricing.clasificarRentabilidad(margin, minimumMarginDecimal);
    return { status, ...comboPricing.RENTABILIDAD_META[status] };
  }

  // ─── Catálogo combinado (productos + combos) ──────────────────────────────

  static async obtenerIdsAdministradores(inquilino_id) {
    const { Usuario, Rol } = require('../models');
    const administradores = await Usuario.findAll({
      where: { inquilino_id },
      attributes: ['id'],
      include: [{ model: Rol, attributes: [], where: { nombre: 'administrador' }, required: true }],
      raw: true,
    });
    return administradores.map(admin => admin.id);
  }

  static visibilidadCatalogoWhere(usuario_id, esAdmin, miosOnly = false, administradoresIds = []) {
    if (miosOnly) return { creado_por: usuario_id };
    if (esAdmin) return {};
    const creadoresVisibles = [...new Set([usuario_id, ...administradoresIds].filter(id => id != null))];
    return {
      [Op.or]: [
        { creado_por: null },
        { creado_por: { [Op.in]: creadoresVisibles } },
      ],
    };
  }

  /**
   * Combos: se filtran por el dueño DEL COMBO, no por el del producto
   * principal (un usuario puede armar un combo sobre un producto del admin,
   * y ese combo es solo suyo). A diferencia de productos, creado_por NULL
   * (combos anteriores a la columna) solo lo ve el admin.
   */
  static visibilidadComboWhere(usuario_id, esAdmin, miosOnly = false, administradoresIds = []) {
    if (miosOnly) return { creado_por: usuario_id };
    if (esAdmin) return {};
    const creadoresVisibles = [...new Set([usuario_id, ...administradoresIds].filter(id => id != null))];
    return { creado_por: { [Op.in]: creadoresVisibles } };
  }

  static visibilidadComboSql(esAdmin, miosOnly = false) {
    if (miosOnly) return 'AND c.creado_por = :usuario_id';
    if (esAdmin) return '';
    return `AND (
      c.creado_por = :usuario_id
      OR c.creado_por IN (
        SELECT u.id
        FROM usuarios u
        INNER JOIN roles r ON r.id = u.rol_id
        WHERE u.inquilino_id = :inquilino_id AND r.nombre = 'administrador'
      )
    )`;
  }

  static visibilidadCatalogoSql(esAdmin, miosOnly = false) {
    if (miosOnly) return 'AND p.creado_por = :usuario_id';
    if (esAdmin) return '';
    return `AND (
      p.creado_por IS NULL
      OR p.creado_por = :usuario_id
      OR p.creado_por IN (
        SELECT u.id
        FROM usuarios u
        INNER JOIN roles r ON r.id = u.rol_id
        WHERE u.inquilino_id = :inquilino_id AND r.nombre = 'administrador'
      )
    )`;
  }

  static origenCatalogo(creadoPor, usuarioId) {
    return creadoPor != null && Number(creadoPor) === Number(usuarioId) ? 'PROPIO' : 'GESICOMM';
  }

  static visibilidadTiendaProductoWhere(usuario_id, tiendaId) {
    if (usuario_id == null || tiendaId == null) return {};
    return {
      [Op.or]: [
        // Aparte del `!=`: `creado_por != :yo` es NULL cuando creado_por es
        // NULL — tiene que dar lo mismo que el `IS DISTINCT FROM` de
        // visibilidadTiendaProductoSql, que sí los incluye.
        { creado_por: null },
        { creado_por: { [Op.ne]: usuario_id } },
        { creado_por: usuario_id, tienda_id: tiendaId },
      ],
    };
  }

  static visibilidadTiendaProductoSql(tiendaId) {
    if (tiendaId == null) return '';
    return 'AND (p.creado_por IS DISTINCT FROM :usuario_id OR (p.creado_por = :usuario_id AND p.tienda_id = :tienda_id))';
  }

  static combinarVisibilidadProducto(visibilidadCatalogo, visibilidadTienda) {
    const condiciones = [visibilidadCatalogo, visibilidadTienda].filter(c => c && Reflect.ownKeys(c).length > 0);
    if (condiciones.length === 0) return {};
    if (condiciones.length === 1) return condiciones[0];
    return { [Op.and]: condiciones };
  }

  static async buscarOCrearCategoria(nombre, inquilino_id, parent_id = null, transaction = null) {
    const limpio = typeof nombre === 'string' ? nombre.trim() : '';
    if (!limpio) throw new Error('El nombre de la categoría es requerido.');

    const existente = await Categoria.findOne({
      where: { inquilino_id, parent_id: parent_id || null, nombre: { [Op.iLike]: limpio } },
      transaction,
    });
    if (existente) {
      if (!existente.activo) {
        existente.activo = true;
        await existente.save({ transaction });
      }
      return existente;
    }

    const CategoriaService = require('./categoria.service');
    const slug = await CategoriaService.generarSlugUnico(limpio, inquilino_id);
    return Categoria.create({ inquilino_id, parent_id: parent_id || null, nombre: limpio, slug }, { transaction });
  }

  static async listarCatalogo(usuario_id, inquilino_id, esAdmin = false, tiendaId = null) {
    const administradoresIds = await this.obtenerIdsAdministradores(inquilino_id);
    const visibilidadProducto = this.visibilidadCatalogoWhere(usuario_id, esAdmin, false, administradoresIds);
    const visibilidadTienda = !esAdmin ? this.visibilidadTiendaProductoWhere(usuario_id, tiendaId) : {};
    const visibilidadProductoTienda = this.combinarVisibilidadProducto(visibilidadProducto, visibilidadTienda);
    // productos/combos/precios son independientes entre sí — se resuelven en
    // paralelo en vez de uno atrás de otro para no acumular latencia de red
    // por cada ida-vuelta a la base.
    const [productos, combos, precios] = await Promise.all([
      Producto.findAll({
        where: { inquilino_id, activo: true, estado_venta: 'en_venta', ...visibilidadProductoTienda },
        attributes: [
          'id', 'slug', 'nombre', 'descripcion_corta', 'descripcion_larga', 'precio_base', 'precio_minimo',
          'precio_tachado', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'cantidad_disponible', 'destacado', 'created_at', 'creado_por', 'tienda_id',
        ],
        include: [
          { association: 'categoria', attributes: ['id', 'nombre'] },
          { model: Marca, attributes: ['id', 'nombre'] },
        ],
        order: [['nombre', 'ASC']],
      }),
      ProductoCombo.findAll({
        where: { inquilino_id, estado: 'ACTIVO', ...this.visibilidadComboWhere(usuario_id, esAdmin, false, administradoresIds) },
        attributes: [
          'id', 'nombre', 'descripcion', 'precio_total', 'precio_minimo', 'producto_id', 'created_at', 'creado_por',
          // Vista del combo — para que el armador de landings pueda armar
          // la ficha del combo (template "Combo") sin pegarle a un
          // endpoint admin-only (ver ComboEditor "Vista del combo").
          'propuesta_valor', 'beneficios', 'confianza', 'preguntas_frecuentes', 'faq_titulo', 'ficha_rubro', 'ficha_datos',
        ],
        include: [
          {
            model: ProductoComboItem,
            as: 'items',
            attributes: ['id', 'cantidad', 'producto_incluido_id'],
            include: [{ model: Producto, as: 'producto_incluido', attributes: ['id', 'nombre', 'precio_base', 'precio_minimo', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'beneficios'] }],
          },
          {
            model: ProductoComboImagen,
            as: 'imagenes',
            attributes: ['id', 'url', 'storage_key', 'es_principal', 'orden'],
          },
          // Categoría y marca se heredan del producto principal para filtros.
          // required: true = INNER JOIN: si el padre está inactivo, el combo
          // queda excluido del catálogo — coherente con obtenerPublica(), que
          // aplica la misma condición y nunca mostraría ese combo en la landing.
          {
            model: Producto,
            as: 'producto_padre',
            attributes: ['id', 'nombre', 'precio_base', 'precio_minimo', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'beneficios', 'cantidad_disponible', 'creado_por'],
            where: { activo: true, ...visibilidadProductoTienda },
            required: true,
            include: [
              { association: 'categoria', attributes: ['id', 'nombre'] },
              { model: Marca, attributes: ['id', 'nombre'] },
            ],
          },
        ],
        order: [['nombre', 'ASC']],
      }),
      PrecioUsuario.findAll({ where: { usuario_id } }),
    ]);

    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));
    const categoriaIdsPersonalizadas = [...new Set(precios.map(p => p.categoria_id).filter(Boolean))];
    const categoriasPersonalizadas = categoriaIdsPersonalizadas.length
      ? await Categoria.findAll({ where: { id: { [Op.in]: categoriaIdsPersonalizadas }, inquilino_id }, attributes: ['id', 'nombre', 'parent_id'] })
      : [];
    const mapaCategoriasPersonalizadas = new Map(categoriasPersonalizadas.map(c => [Number(c.id), c]));
    const precioVentaProducto = (prod) => {
      if (!prod) return null;
      const precioUsuario = mapaPrecios.has(`producto:${prod.id}`) ? mapaPrecios.get(`producto:${prod.id}`) : null;
      return this.precioPublico(prod, precioUsuario).precio_publico;
    };
    const productosDelCombo = (combo) => {
      const vistos = new Set();
      const agregar = (prod, cantidad = 1) => {
        if (!prod || vistos.has(prod.id)) return null;
        vistos.add(prod.id);
        return {
          id: prod.id,
          nombre: prod.nombre,
          cantidad: Number(cantidad) || 1,
          // Precio que ve el comprador final en la tienda: primero el precio
          // personalizado del usuario y, si no existe, el precio base B2B.
          precio: precioVentaProducto(prod),
          imagen: imgMap.get(prod.id) || null,
          beneficios: (prod.beneficios || []).filter(b => b?.titulo?.trim()).map(b => b.titulo),
        };
      };
      return [
        agregar(combo.producto_padre, 1),
        ...(combo.items || []).map(i => agregar(i.producto_incluido, i.cantidad)),
      ].filter(Boolean);
    };

    // Depende de los IDs recién resueltos, no se puede paralelizar con lo anterior.
    // Los combos entran con el id de su producto_padre: la imagen del combo es la del principal.
    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
      // Los productos que arman cada combo también necesitan imagen propia
      // para "Qué incluye"/"Detalle de cada producto" de la ficha del combo.
      ...combos.flatMap(c => (c.items || []).map(i => i.producto_incluido_id)).filter(Boolean),
    ];
    // Galería completa por producto, no solo la principal: las tarjetas de
    // la landing pasan de una imagen a la otra al pasar el mouse por encima
    // (ver ImagenProductoHover en templates/sections.jsx), y con una sola
    // url el preview del editor nunca podía hacerlo. Mismo criterio que
    // landing.service.obtenerPublica: se usan las imágenes generales del
    // producto y, si TODAS están atadas a una variante, se usan igual —
    // mejor mostrar algo que una galería vacía.
    const galeriaMap = new Map();
    if (idsParaImagen.length > 0) {
      const imagenes = await ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: idsParaImagen } },
        attributes: ['producto_id', 'url', 'variante_id'],
        order: [['es_principal', 'DESC'], ['orden', 'ASC']],
      });
      const porProducto = new Map();
      imagenes.forEach(img => {
        if (!porProducto.has(img.producto_id)) porProducto.set(img.producto_id, []);
        porProducto.get(img.producto_id).push(img);
      });
      porProducto.forEach((imgs, productoId) => {
        const generales = imgs.filter(i => !i.variante_id);
        galeriaMap.set(productoId, (generales.length ? generales : imgs).map(i => i.url));
      });
    }
    const imgMap = new Map([...galeriaMap].map(([id, urls]) => [id, urls[0]]));

    const idsConOpciones = await this.idsConOpciones(productos, inquilino_id);
    const productosDto = productos.map(p => {
      const precioUsuario = mapaPrecios.has(`producto:${p.id}`) ? mapaPrecios.get(`producto:${p.id}`) : null;
      const precioRegistro = precios.find(pr => pr.tipo === 'producto' && Number(pr.referencia_id) === Number(p.id));
      const categoriaPersonalizada = precioRegistro?.categoria_id ? mapaCategoriasPersonalizadas.get(Number(precioRegistro.categoria_id)) : null;
      const precioBase = parseFloat(p.precio_base);
      return {
        id: p.id,
        tipo: 'producto',
        nombre: p.nombre,
        descripcion: p.descripcion_corta,
        descripcion_larga: p.descripcion_larga,
        precio_base: precioBase,
        precio_minimo: p.precio_minimo !== null ? parseFloat(p.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        ...this.precioPublico(p, precioUsuario),
        precio_tachado: p.precio_tachado ? parseFloat(p.precio_tachado) : null,
        imagen: imgMap.get(p.id) || null,
        imagenes: galeriaMap.get(p.id) || [],
        categoria: categoriaPersonalizada?.nombre || p.categoria?.nombre || null,
        categoria_id: categoriaPersonalizada?.id || p.categoria?.id || null,
        categoria_original: p.categoria?.nombre || null,
        marca: p.Marca?.nombre || null,
        stock: p.creado_por == null || administradoresIds.some(id => Number(id) === Number(p.creado_por)) ? null : p.cantidad_disponible,
        tiene_opciones: idsConOpciones.has(p.id),
        destacado: !!p.destacado,
        creado_en: p.created_at,
        creado_por: p.creado_por,
        origen_catalogo: this.origenCatalogo(p.creado_por, usuario_id),
        slug: p.slug,
      };
    });

    const combosDto = combos.map(c => {
      const precioUsuario = mapaPrecios.has(`combo:${c.id}`) ? mapaPrecios.get(`combo:${c.id}`) : null;
      const precioRegistro = precios.find(pr => pr.tipo === 'combo' && Number(pr.referencia_id) === Number(c.id));
      const categoriaPersonalizada = precioRegistro?.categoria_id ? mapaCategoriasPersonalizadas.get(Number(precioRegistro.categoria_id)) : null;
      const precioBase = parseFloat(c.precio_total);
      const padre = c.producto_padre;
      const imagenesCombo = (c.imagenes || [])
        .slice()
        .sort((a, b) => (b.es_principal === true) - (a.es_principal === true) || (Number(a.orden) || 0) - (Number(b.orden) || 0))
        .map(img => ImagenService.serializar(img).url)
        .filter(Boolean);
      const imagenesFallback = padre ? (galeriaMap.get(padre.id) || []) : [];
      return {
        id: c.id,
        tipo: 'combo',
        nombre: c.nombre,
        descripcion: c.descripcion,
        precio_base: precioBase,
        precio_minimo: c.precio_minimo !== null ? parseFloat(c.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        // Nombres nomás — lo que ya consumen VitrinaGrid.jsx, ProductDetailBlock.jsx,
        // etc. (join(', ') en varios lados). NO cambiar la forma acá.
        productos_incluidos: productosDelCombo(c).map(p => p.nombre).filter(Boolean),
        // Detalle enriquecido — solo lo usa la ficha del combo (template
        // "Combo"), ver templates/combo/fichaCombo.js.
        productos_combo: productosDelCombo(c),
        imagen: imagenesCombo[0] || (padre ? (imgMap.get(padre.id) || null) : null),
        imagenes: imagenesCombo.length ? imagenesCombo : imagenesFallback,
        categoria: categoriaPersonalizada?.nombre || padre?.categoria?.nombre || null,
        categoria_id: categoriaPersonalizada?.id || padre?.categoria?.id || null,
        categoria_original: padre?.categoria?.nombre || null,
        marca: padre?.Marca?.nombre || null,
        stock: padre?.creado_por == null || administradoresIds.some(id => Number(id) === Number(padre.creado_por)) ? null : padre.cantidad_disponible,
        destacado: false,
        creado_en: c.created_at,
        creado_por: c.creado_por,
        origen_catalogo: this.origenCatalogo(c.creado_por, usuario_id),
        // Vista del combo — alimenta la ficha (template "Combo") en el
        // armador de landings sin pegarle a un endpoint admin-only.
        propuesta_valor: c.propuesta_valor || null,
        beneficios: c.beneficios || [],
        confianza: c.confianza || [],
        preguntas_frecuentes: c.preguntas_frecuentes || [],
        faq_titulo: c.faq_titulo || null,
        ficha_rubro: c.ficha_rubro || null,
        ficha_datos: c.ficha_datos || {},
      };
    });

    return { productos: productosDto, combos: combosDto };
  }

    static async listarCatalogoPaginado(usuario_id, inquilino_id, filtros = {}, esAdmin = false, tiendaId = null) {
    const { sequelize, Categoria } = require('../models');
    const {
      page = 1, limit = 10, busqueda = '', filtroCategoria = '', filtroProveedor = '', filtroMarca = '', filtroStock = '', orden = 'nombre', tipo = 'todos',
      solamenteMios = false, mios_solamente = false, origenCatalogo = null
    } = filtros;
    const pagina = Math.max(1, parseInt(page, 10) || 1);
    const limite = Math.min(10000, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pagina - 1) * limite;
    // "Seleccionar todo el catálogo filtrado" (VitrinaGrid) pide limit=total:
    // con un catálogo grande (miles de productos) el enriquecimiento de abajo
    // (imágenes, categoría personalizada, ofertas, combos anidados — todo
    // instancias de Sequelize, no las filas livianas del SQL crudo) tumbó el
    // backend por OOM el 2026-10-16. Nada de lo que usa esa selección masiva
    // (generar landing, cambiar precios, categorizar, armar combo, eliminar)
    // necesita más que id/tipo/nombre/creado_por/precio — se salta el
    // enriquecimiento entero a partir de cierto tamaño de página, sin bajarle
    // el tope: así "seleccionar todo" sigue andando con cualquier cantidad de
    // productos.
    const UMBRAL_LIVIANO = 200;
    const liviano = filtros.liviano === true || limite > UMBRAL_LIVIANO;

    const replacements = { usuario_id, inquilino_id };
    if (tiendaId != null) replacements.tienda_id = tiendaId;

    const miosOnly = Boolean(solamenteMios || mios_solamente);
    const gesicomOnly = origenCatalogo === 'GESICOMM' && !miosOnly;
    const landingOnly = tipo === 'landing';
    if (landingOnly && tiendaId == null) {
      return { items: [], total: 0, page: parseInt(page), totalPages: 1, categorias: [], proveedores: [], marcas: [] };
    }
    // Un combo propio puede tener como principal un producto del administrador.
    const creadorFilter = this.visibilidadCatalogoSql(esAdmin, miosOnly)
      + (gesicomOnly ? ' AND p.creado_por IS DISTINCT FROM :usuario_id' : '');
    const tiendaFilter = !esAdmin ? this.visibilidadTiendaProductoSql(tiendaId) : '';
    // Filtro de categoría
    let catFilter = '';
    if (filtroCategoria) {
      const cat = await Categoria.findOne({ where: { nombre: filtroCategoria, inquilino_id } });
      if (cat) {
        replacements.categoria_id = cat.id;
        catFilter = 'AND COALESCE(pu.categoria_id, p.categoria_id) = :categoria_id';
      } else {
        return { items: [], total: 0, page: 1, totalPages: 0, categorias: [] };
      }
    }

    
    let provFilter = '';
    if (filtroProveedor) {
      replacements.filtroProveedor = filtroProveedor;
      provFilter = 'AND p.proveedor_id IN (SELECT id FROM proveedores WHERE nombre = :filtroProveedor)';
    }

    let marcaFilter = '';
    if (filtroMarca) {
      replacements.filtroMarca = filtroMarca;
      marcaFilter = 'AND p.marca_id IN (SELECT id FROM marcas WHERE nombre = :filtroMarca)';
    }

    let stockFilter = '';
    if (filtroStock === 'con') stockFilter = 'AND COALESCE(p.cantidad_disponible, 0) > 0';
    if (filtroStock === 'sin') stockFilter = 'AND COALESCE(p.cantidad_disponible, 0) = 0';

    let searchFilter = '';
    if (busqueda.trim()) {
      replacements.busqueda = `%${busqueda.trim()}%`;
      searchFilter = 'AND (c.nombre ILIKE :busqueda OR c.descripcion ILIKE :busqueda)';
    }

    let orderSql = 'ORDER BY nombre ASC';
    if (orden === 'recientes') orderSql = 'ORDER BY created_at DESC';
    if (orden === 'precio-asc') orderSql = 'ORDER BY precio_efectivo ASC';
    if (orden === 'precio-desc') orderSql = 'ORDER BY precio_efectivo DESC';

    const landingActualSql = `
      SELECT l.id
      FROM landings l
      WHERE l.inquilino_id = :inquilino_id
        AND l.tienda_id = :tienda_id
        AND l.activo = true
      ORDER BY
        CASE
          WHEN l.tipo_pagina = 'catalogo' THEN 0
          WHEN l.es_home = true THEN 1
          ELSE 2
        END,
        l.created_at DESC,
        l.id DESC
      LIMIT 1
    `;
    const landingProductoFilter = landingOnly
      ? `AND EXISTS (
          SELECT 1
          FROM landing_items li
          WHERE li.landing_id = (${landingActualSql})
            AND li.tipo = 'producto'
            AND li.referencia_id = p.id
        )`
      : '';
    const landingComboFilter = landingOnly
      ? `AND EXISTS (
          SELECT 1
          FROM landing_items li
          WHERE li.landing_id = (${landingActualSql})
            AND li.tipo = 'combo'
            AND li.referencia_id = c.id
        )`
      : '';

    const productosSql = `
      SELECT p.id, 'producto' as tipo, p.nombre, p.created_at, COALESCE(pu.categoria_id, p.categoria_id) as categoria_id, p.creado_por,
        pu.precio as precio_usuario, pu.categoria_id as categoria_personalizada_id,
        COALESCE(pu.precio, p.precio_base) as precio_efectivo
      FROM productos p
      LEFT JOIN precios_usuario pu ON pu.tipo = 'producto' AND pu.referencia_id = p.id AND pu.usuario_id = :usuario_id
      WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
      ${creadorFilter}
      ${tiendaFilter}
      ${landingProductoFilter}
      ${catFilter}
      ${provFilter}
      ${marcaFilter}
      ${stockFilter}
      ${searchFilter.replace(/c\./g, 'p.').replace(/descripcion/g, 'descripcion_corta')}
    `;

    const combosSql = `
      /* p.categoria_id, c.creado_por */
      SELECT c.id, 'combo' as tipo, c.nombre, c.created_at, COALESCE(pu.categoria_id, p.categoria_id) as categoria_id, c.creado_por,
        pu.precio as precio_usuario, pu.categoria_id as categoria_personalizada_id,
        COALESCE(pu.precio, c.precio_total) as precio_efectivo
      FROM producto_combos c
      INNER JOIN productos p ON c.producto_id = p.id AND p.inquilino_id = :inquilino_id AND p.activo = true
      LEFT JOIN precios_usuario pu ON pu.tipo = 'combo' AND pu.referencia_id = c.id AND pu.usuario_id = :usuario_id
      WHERE c.inquilino_id = :inquilino_id AND c.estado = 'ACTIVO'
      ${this.visibilidadComboSql(esAdmin, miosOnly)}
      ${gesicomOnly ? 'AND c.creado_por IS DISTINCT FROM :usuario_id' : ''}
      ${this.visibilidadCatalogoSql(esAdmin, false)}
      ${tiendaFilter}
      ${landingComboFilter}
      ${catFilter}
      ${provFilter}
      ${marcaFilter}
      ${stockFilter}
      ${searchFilter}
    `;

    let finalQuery = '';
    if (tipo === 'producto') {
      finalQuery = productosSql;
    } else if (tipo === 'combo') {
      finalQuery = combosSql;
    } else {
      finalQuery = `(${productosSql}) UNION ALL (${combosSql})`;
    }

    const countQuery = `SELECT COUNT(*) as total FROM (${finalQuery}) as t`;
    const dataQuery = `${finalQuery} ${orderSql}, tipo ASC, id ASC LIMIT :limit OFFSET :offset`;
    
    replacements.limit = limite;
    replacements.offset = parseInt(offset);

    const [countResult, paginatedItems, administradoresIds] = await Promise.all([
      sequelize.query(countQuery, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(dataQuery, { replacements, type: sequelize.QueryTypes.SELECT }),
      this.obtenerIdsAdministradores(inquilino_id),
    ]);
    const total = parseInt(countResult[0]?.total || 0);

    if (liviano) {
      return {
        items: paginatedItems.map(it => ({
          id: it.id,
          tipo: it.tipo,
          nombre: it.nombre,
          creado_por: it.creado_por,
          precio_efectivo: parseFloat(it.precio_efectivo) || 0,
        })),
        total,
        page: pagina,
        totalPages: Math.max(1, Math.ceil(total / limite)),
        categorias: [],
        proveedores: [],
        marcas: [],
      };
    }

    const visibilidadProductoPaginado = this.combinarVisibilidadProducto(
      this.visibilidadCatalogoWhere(usuario_id, esAdmin, miosOnly, administradoresIds),
      !esAdmin ? this.visibilidadTiendaProductoWhere(usuario_id, tiendaId) : {},
    );
    const visibilidadProductoPadre = this.combinarVisibilidadProducto(
      this.visibilidadCatalogoWhere(usuario_id, esAdmin, false, administradoresIds),
      !esAdmin ? this.visibilidadTiendaProductoWhere(usuario_id, tiendaId) : {},
    );
    // El JOIN de la página ya trae los precios y categorías personalizados.
    // No volver a consultar precios_usuario dos veces para las mismas filas.
    const precios = paginatedItems.filter(i => i.precio_usuario != null || i.categoria_personalizada_id != null).map(i => ({
      tipo: i.tipo, referencia_id: i.id, precio: i.precio_usuario, categoria_id: i.categoria_personalizada_id,
    }));

    const idsProductos = paginatedItems.filter(i => i.tipo === 'producto').map(i => i.id);
    const idsCombos = paginatedItems.filter(i => i.tipo === 'combo').map(i => i.id);

    const { Producto, ProductoCombo, ProductoComboItem, ProductoComboImagen, ProductoImagen, PrecioUsuario, Marca, Proveedor } = require('../models');

    const [productos, combos, categoriasUnicasData, proveedoresUnicasData, marcasUnicasData] = await Promise.all([
      idsProductos.length ? Producto.findAll({
        where: {
          id: { [require('sequelize').Op.in]: idsProductos },
          inquilino_id,
          ...visibilidadProductoPaginado,
        },
        attributes: [
          'id', 'slug', 'nombre', 'descripcion_corta', 'descripcion_larga', 'precio_base', 'precio_costo', 'precio_minimo',
          'precio_tachado', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'cantidad_disponible', 'destacado', 'created_at', 'categoria_id', 'creado_por', 'tienda_id'
        ],
        include: [
          { association: 'categoria', attributes: ['id', 'nombre'] },
          { model: Marca, attributes: ['id', 'nombre'] },
          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
        ]
      }) : [],
      idsCombos.length ? ProductoCombo.findAll({
        where: {
          id: { [Op.in]: idsCombos },
          inquilino_id,
          ...this.visibilidadComboWhere(usuario_id, esAdmin, miosOnly, administradoresIds),
        },
        attributes: ['id', 'nombre', 'descripcion', 'precio_total', 'precio_minimo', 'producto_id', 'created_at', 'creado_por',
          'propuesta_valor', 'beneficios', 'confianza', 'preguntas_frecuentes', 'faq_titulo', 'ficha_rubro', 'ficha_datos',
        ],
        include: [
          {
            model: ProductoComboItem,
            as: 'items',
            attributes: ['id', 'cantidad', 'producto_incluido_id'],
            include: [{ model: Producto, as: 'producto_incluido', attributes: ['id', 'nombre', 'precio_base', 'precio_minimo', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'beneficios'] }],
          },
          {
            model: ProductoComboImagen,
            as: 'imagenes',
            attributes: ['id', 'url', 'storage_key', 'es_principal', 'orden'],
          },
          {
            model: Producto,
            as: 'producto_padre',
            attributes: ['id', 'nombre', 'precio_base', 'precio_minimo', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'beneficios', 'cantidad_disponible', 'categoria_id', 'creado_por'],
            where: {
              inquilino_id,
              activo: true,
              ...visibilidadProductoPadre,
            },
            required: true,
            include: [
              { association: 'categoria', attributes: ['id', 'nombre'] },
              { model: Marca, attributes: ['id', 'nombre'] },
          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
            ],
          },
        ]
      }) : [],
      sequelize.query(`
        SELECT DISTINCT c.nombre 
        FROM productos p
        LEFT JOIN precios_usuario pu ON pu.tipo = 'producto' AND pu.referencia_id = p.id AND pu.usuario_id = :usuario_id
        INNER JOIN categorias c ON COALESCE(pu.categoria_id, p.categoria_id) = c.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ${creadorFilter}
        ${tiendaFilter}
        ${landingProductoFilter}
        ${marcaFilter}
        ${stockFilter}
        ORDER BY c.nombre ASC
      `, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`
        SELECT DISTINCT pr.nombre 
        FROM proveedores pr 
        INNER JOIN productos p ON p.proveedor_id = pr.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ${creadorFilter}
        ${tiendaFilter}
        ${landingProductoFilter}
        ${stockFilter}
        ORDER BY pr.nombre ASC
      `, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`
        SELECT DISTINCT m.nombre 
        FROM marcas m
        INNER JOIN productos p ON p.marca_id = m.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ${creadorFilter}
        ${tiendaFilter}
        ${landingProductoFilter}
        ${provFilter}
        ${stockFilter}
        ORDER BY m.nombre ASC
      `, { replacements, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData ? categoriasUnicasData.map(c => c.nombre) : [];
    const proveedoresUnicos = proveedoresUnicasData ? proveedoresUnicasData.map(p => p.nombre) : [];
    const marcasUnicas = marcasUnicasData ? marcasUnicasData.map(m => m.nombre) : [];

    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));
    const organizacionPendiente = landingOnly && paginatedItems.length
      ? this.organizacionDeLanding(inquilino_id, tiendaId, paginatedItems.map(item => ({
        ...item, slug: item.tipo === 'producto' ? productos.find(p => p.id === item.id)?.slug : null,
      }))) : Promise.resolve(null);
    // Attach rejection handling immediately while independent gallery queries
    // run, so a metadata failure cannot become an unhandled rejection.
    organizacionPendiente.catch(() => {});
    const categoriaIdsPersonalizadas = [...new Set(precios.map(p => p.categoria_id).filter(Boolean))];
    const idsProductosEnCombos = [
      ...new Set([
        ...combos.map(c => c.producto_padre?.id).filter(Boolean),
        ...combos.flatMap(c => (c.items || []).map(i => i.producto_incluido_id)).filter(Boolean),
      ]),
    ];
    const idsProductosEnCombosSinPrecio = idsProductosEnCombos.filter(id => !mapaPrecios.has(`producto:${id}`));
    const precioVentaProducto = (prod) => {
      if (!prod) return null;
      const precioUsuario = mapaPrecios.has(`producto:${prod.id}`) ? mapaPrecios.get(`producto:${prod.id}`) : null;
      return this.precioPublico(prod, precioUsuario).precio_publico;
    };
    const productosDelCombo = (combo) => {
      const vistos = new Set();
      const agregar = (prod, cantidad = 1) => {
        if (!prod || vistos.has(prod.id)) return null;
        vistos.add(prod.id);
        return {
          id: prod.id,
          nombre: prod.nombre,
          cantidad: Number(cantidad) || 1,
          // Precio que ve el comprador final en la tienda: primero el precio
          // personalizado del usuario y, si no existe, el precio base B2B.
          precio: precioVentaProducto(prod),
          imagen: imgMap.get(prod.id) || null,
          beneficios: (prod.beneficios || []).filter(b => b?.titulo?.trim()).map(b => b.titulo),
        };
      };
      return [
        agregar(combo.producto_padre, 1),
        ...(combo.items || []).map(i => agregar(i.producto_incluido, i.cantidad)),
      ].filter(Boolean);
    };

    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
      // Los productos incluidos en cada combo también necesitan imagen para
      // "¿Qué incluye?" y "Detalle de cada producto" de la ficha del combo.
      ...combos.flatMap(c => (c.items || []).map(i => i.producto_incluido_id)).filter(Boolean),
    ];
    // Galería completa por producto, no solo la principal: las tarjetas de
    // la landing pasan de una imagen a la otra al pasar el mouse por encima
    // (ver ImagenProductoHover en templates/sections.jsx), y con una sola
    // url el preview del editor nunca podía hacerlo. Mismo criterio que
    // landing.service.obtenerPublica: se usan las imágenes generales del
    // producto y, si TODAS están atadas a una variante, se usan igual —
    // mejor mostrar algo que una galería vacía.
    const galeriaMap = new Map();
    const [imagenes, categoriasPersonalizadas, preciosComponentes, idsConOpciones] = await Promise.all([
      idsParaImagen.length ? ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: [...new Set(idsParaImagen)] } },
        attributes: ['producto_id', 'url', 'variante_id'],
        order: [['es_principal', 'DESC'], ['orden', 'ASC']],
      }) : [],
      categoriaIdsPersonalizadas.length ? Categoria.findAll({
        where: { id: { [Op.in]: categoriaIdsPersonalizadas }, inquilino_id }, attributes: ['id', 'nombre', 'parent_id'],
      }) : [],
      idsProductosEnCombosSinPrecio.length ? PrecioUsuario.findAll({
        where: { usuario_id, tipo: 'producto', referencia_id: { [Op.in]: idsProductosEnCombosSinPrecio } },
        attributes: ['referencia_id', 'precio'],
      }) : [],
      this.idsConOpciones(productos, inquilino_id),
    ]);
    const mapaCategoriasPersonalizadas = new Map(categoriasPersonalizadas.map(c => [Number(c.id), c]));
    preciosComponentes.forEach(p => mapaPrecios.set(`producto:${p.referencia_id}`, parseFloat(p.precio)));
    const mapaRegistrosPrecio = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, p]));
    if (idsParaImagen.length > 0) {
      const porProducto = new Map();
      imagenes.forEach(img => {
        if (!porProducto.has(img.producto_id)) porProducto.set(img.producto_id, []);
        porProducto.get(img.producto_id).push(img);
      });
      porProducto.forEach((imgs, productoId) => {
        const generales = imgs.filter(i => !i.variante_id);
        galeriaMap.set(productoId, (generales.length ? generales : imgs).map(i => i.url));
      });
    }
    const imgMap = new Map([...galeriaMap].map(([id, urls]) => [id, urls[0]]));

    const mapaProductosDto = new Map(productos.map(p => {
      const precioUsuario = mapaPrecios.has(`producto:${p.id}`) ? mapaPrecios.get(`producto:${p.id}`) : null;
      const precioRegistro = mapaRegistrosPrecio.get(`producto:${p.id}`);
      const categoriaPersonalizada = precioRegistro?.categoria_id ? mapaCategoriasPersonalizadas.get(Number(precioRegistro.categoria_id)) : null;
      const esProductoPropio = (p.creado_por != null && Number(p.creado_por) === Number(usuario_id));
      const precioCosto = p.precio_costo != null ? parseFloat(p.precio_costo) : null;
      const precioBase = parseFloat(p.precio_base);
      const costoReferencia = (esProductoPropio && precioCosto != null) ? precioCosto : precioBase;

      return [p.id, {
        id: p.id,
        tipo: 'producto',
        nombre: p.nombre,
        descripcion: p.descripcion_corta,
        descripcion_larga: p.descripcion_larga,
        precio_base: costoReferencia,
        precio_costo: precioCosto,
        precio_minimo: p.precio_minimo !== null ? parseFloat(p.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        ...this.precioPublico(p, precioUsuario),
        precio_tachado: p.precio_tachado ? parseFloat(p.precio_tachado) : null,
        imagen: imgMap.get(p.id) || null,
        imagenes: galeriaMap.get(p.id) || [],
        categoria: categoriaPersonalizada?.nombre || p.categoria?.nombre || null,
        categoria_id: categoriaPersonalizada?.id || p.categoria?.id || null,
        categoria_original: p.categoria?.nombre || null,
        marca: p.Marca?.nombre || null,
        proveedor: p.proveedor?.nombre || null,
        stock: p.creado_por == null || administradoresIds.some(id => Number(id) === Number(p.creado_por)) ? null : p.cantidad_disponible,
        tiene_opciones: idsConOpciones.has(p.id),
        destacado: !!p.destacado,
        creado_en: p.created_at,
        creado_por: p.creado_por,
        origen_catalogo: this.origenCatalogo(p.creado_por, usuario_id),
        slug: p.slug,
      }];
    }));

    const mapaCombosDto = new Map(combos.map(c => {
      const precioUsuario = mapaPrecios.has(`combo:${c.id}`) ? mapaPrecios.get(`combo:${c.id}`) : null;
      const precioRegistro = mapaRegistrosPrecio.get(`combo:${c.id}`);
      const categoriaPersonalizada = precioRegistro?.categoria_id ? mapaCategoriasPersonalizadas.get(Number(precioRegistro.categoria_id)) : null;
      const precioBase = parseFloat(c.precio_total);
      const padre = c.producto_padre;
      const imagenesCombo = (c.imagenes || [])
        .slice()
        .sort((a, b) => (b.es_principal === true) - (a.es_principal === true) || (Number(a.orden) || 0) - (Number(b.orden) || 0))
        .map(img => ImagenService.serializar(img).url)
        .filter(Boolean);
      const imagenesFallback = padre ? (galeriaMap.get(padre.id) || []) : [];
      return [c.id, {
        id: c.id,
        tipo: 'combo',
        nombre: c.nombre,
        descripcion: c.descripcion,
        precio_base: precioBase,
        precio_minimo: c.precio_minimo !== null ? parseFloat(c.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        // Nombres nomás — compatibilidad con VitrinaGrid/ProductDetailBlock.
        productos_incluidos: productosDelCombo(c).map(p => p.nombre).filter(Boolean),
        // Detalle enriquecido — usa la ficha del combo (template "Combo").
        // Mismo criterio que listarCatalogo; sin esto el armador de landings
        // no puede renderizar "¿Qué incluye?" ni "Detalle de cada producto".
        productos_combo: productosDelCombo(c),
        imagen: imagenesCombo[0] || (padre ? (imgMap.get(padre.id) || null) : null),
        imagenes: imagenesCombo.length ? imagenesCombo : imagenesFallback,
        categoria: categoriaPersonalizada?.nombre || padre?.categoria?.nombre || null,
        categoria_id: categoriaPersonalizada?.id || padre?.categoria?.id || null,
        categoria_original: padre?.categoria?.nombre || null,
        marca: padre?.Marca?.nombre || null,
        proveedor: padre?.proveedor?.nombre || null,
        stock: padre?.creado_por == null || administradoresIds.some(id => Number(id) === Number(padre.creado_por)) ? null : padre.cantidad_disponible,
        destacado: false,
        creado_en: c.created_at,
        creado_por: c.creado_por,
        origen_catalogo: this.origenCatalogo(c.creado_por, usuario_id),
        // Vista del combo — alimenta la ficha (template "Combo") en el armador.
        propuesta_valor: c.propuesta_valor || null,
        beneficios: c.beneficios || [],
        confianza: c.confianza || [],
        preguntas_frecuentes: c.preguntas_frecuentes || [],
        faq_titulo: c.faq_titulo || null,
        ficha_rubro: c.ficha_rubro || null,
        ficha_datos: c.ficha_datos || {},
      }];
    }));

    const items = paginatedItems.map(item => {
      if (item.tipo === 'producto') return mapaProductosDto.get(item.id);
      return mapaCombosDto.get(item.id);
    }).filter(Boolean);

    // "Productos en mi landing": cómo está organizado cada uno en la landing
    // (descuento, badge, contador, colecciones) para que Mi catálogo lo
    // muestre y permita cambiarlo — ver organizarEnLandingActiva.
    const organizacion = await organizacionPendiente;
    if (organizacion) items.forEach((item) => { item.en_landing = organizacion.porItem.get(`${item.tipo}:${item.id}`) || null; });

    return {
      ...(organizacion ? { colecciones_landing: organizacion.colecciones } : {}),
      items,
      total,
      page: pagina,
      totalPages: Math.ceil(total / limite),
      categorias: categoriasUnicas,
      proveedores: proveedoresUnicos,
      marcas: marcasUnicas
    };
  }

  // ─── Guardar precio propio ─────────────────────────────────────────────────

  static async guardarPrecioProducto(usuario_id, inquilino_id, producto_id, precio, esAdmin = false, tiendaId = null) {
    const administradoresIds = esAdmin ? [] : await this.obtenerIdsAdministradores(inquilino_id);
    const visibilidadProducto = this.combinarVisibilidadProducto(
      this.visibilidadCatalogoWhere(usuario_id, esAdmin, false, administradoresIds),
      !esAdmin ? this.visibilidadTiendaProductoWhere(usuario_id, tiendaId) : {},
    );
    const producto = await Producto.findOne({
      where: {
        id: producto_id,
        inquilino_id,
        activo: true,
        ...visibilidadProducto,
      },
    });
    if (!producto) throw new Error('Producto no encontrado.');
    return this._guardar(usuario_id, inquilino_id, 'producto', producto.id, precio, producto.precio_minimo);
  }

  static async guardarPrecioCombo(usuario_id, inquilino_id, combo_id, precio, esAdmin = false) {
    const administradoresIds = esAdmin ? [] : await this.obtenerIdsAdministradores(inquilino_id);
    const combo = await ProductoCombo.findOne({
      where: { id: combo_id, inquilino_id, estado: 'ACTIVO', ...this.visibilidadComboWhere(usuario_id, esAdmin, false, administradoresIds) },
      include: [{
        model: Producto,
        as: 'producto_padre',
        attributes: ['id'],
        where: {
          inquilino_id,
          activo: true,
          ...this.visibilidadCatalogoWhere(usuario_id, esAdmin, false, administradoresIds),
        },
        required: true,
      }],
    });
    if (!combo) throw new Error('Combo no encontrado.');
    return this._guardar(usuario_id, inquilino_id, 'combo', combo.id, precio, combo.precio_minimo);
  }

  static async _guardar(usuario_id, inquilino_id, tipo, referencia_id, precio, precioMinimo) {
    const precioNum = parseFloat(precio);
    if (isNaN(precioNum) || precioNum <= 0) {
      throw new Error('El precio debe ser un número mayor a cero.');
    }

    const minimo = precioMinimo !== null && precioMinimo !== undefined ? parseFloat(precioMinimo) : null;
    if (minimo && precioNum < minimo) {
      throw new Error(`El precio (${precioNum}) no puede ser menor al precio mínimo (${minimo}).`);
    }

    const [registro] = await PrecioUsuario.findOrCreate({
      where: { usuario_id, tipo, referencia_id },
      defaults: { usuario_id, inquilino_id, tipo, referencia_id, precio: precioNum },
    });

    if (parseFloat(registro.precio) !== precioNum) {
      registro.precio = precioNum;
      await registro.save();
    }

    return { tipo, referencia_id, precio: precioNum };
  }

  static normalizarItemsLanding(items = []) {
    if (!Array.isArray(items)) throw new Error('La selección no es válida.');
    const vistos = new Set();
    return items.map(item => {
      const tipo = item?.tipo;
      const id = Number(item?.id ?? item?.referencia_id);
      if (!['producto', 'combo'].includes(tipo) || !Number.isInteger(id) || id <= 0) {
        throw new Error('La selección no es válida.');
      }
      const key = `${tipo}:${id}`;
      if (vistos.has(key)) return null;
      vistos.add(key);
      return { tipo, id };
    }).filter(Boolean);
  }

  static async despublicarDeLandingActiva(usuario_id, inquilino_id, items = [], esAdmin = false, tiendaId = null) {
    if (!tiendaId) {
      const err = new Error('Seleccioná una tienda para despublicar productos de la landing.');
      err.status = 409;
      throw err;
    }
    const seleccion = this.normalizarItemsLanding(items);
    if (!seleccion.length) throw new Error('Seleccioná al menos un producto para despublicar.');

    const { Landing, LandingItem } = require('../models');
    const whereLanding = { inquilino_id, tienda_id: tiendaId, activo: true };
    if (!esAdmin) whereLanding.tienda_id = tiendaId;
    const landing = await Landing.findOne({
      where: whereLanding,
      // separate: en un JOIN el content de la landing (el lienzo entero) viaja
      // repetido en cada fila de item; con cientos de items son cientos de MB.
      include: [{ model: LandingItem, as: 'items', attributes: ['tipo', 'referencia_id'], separate: true }],
      order: [
        [sequelize.literal("CASE WHEN tipo_pagina = 'catalogo' THEN 0 WHEN es_home = true THEN 1 ELSE 2 END"), 'ASC'],
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    if (!landing) {
      const err = new Error('No se encontró una landing activa para esta tienda.');
      err.status = 404;
      throw err;
    }

    const claves = new Set(seleccion.map(item => `${item.tipo}:${item.id}`));
    const actuales = Array.isArray(landing.items) ? landing.items : [];
    const eliminados = actuales.filter(item => claves.has(`${item.tipo}:${Number(item.referencia_id)}`)).length;
    if (eliminados > 0) {
      await LandingItem.destroy({
        where: {
          landing_id: landing.id,
          [Op.or]: seleccion.map(item => ({ tipo: item.tipo, referencia_id: item.id })),
        },
      });
    }

    const content = landing.content && typeof landing.content === 'object' && !Array.isArray(landing.content)
      ? { ...landing.content }
      : {};
    const venta = content.venta && typeof content.venta === 'object' && !Array.isArray(content.venta)
      ? { ...content.venta }
      : {};
    content.venta = { ...venta, configurado: true, seleccion: 'manual' };
    landing.content = content;
    landing.changed?.('content', true);
    await landing.save?.();

    return {
      landing_id: landing.id,
      despublicados: eliminados,
      restantes: Math.max(0, actuales.length - eliminados),
    };
  }

  // Marcas de la landing activa para los items de una página de Mi catálogo,
  // más todas las colecciones de la landing (para elegir una existente). Solo
  // lee las partes de content.venta que hacen falta: content trae el lienzo
  // entero.
  static async organizacionDeLanding(inquilino_id, tiendaId, items) {
    const { Landing, LandingItem } = require('../models');
    const { etiquetasDe } = require('./landingOrganizar.service');
    const landing = await Landing.findOne({
      where: { inquilino_id, tienda_id: tiendaId, activo: true },
      attributes: [
        'id',
        [sequelize.literal("content->'venta'->'urgencia'"), 'urgencia'],
        [sequelize.literal("content->'venta'->'presentacion_productos'"), 'presentacion'],
      ],
      order: [
        [sequelize.literal("CASE WHEN tipo_pagina = 'catalogo' THEN 0 WHEN es_home = true THEN 1 ELSE 2 END"), 'ASC'],
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    if (!landing) return null;
    const leer = campo => {
      const v = typeof landing.get === 'function' ? landing.get(campo) : landing[campo];
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
      return v;
    };
    const urgencia = leer('urgencia') || {};
    const presentacion = leer('presentacion') || {};
    const [filas, etiquetas] = await Promise.all([
      LandingItem.findAll({
        where: { landing_id: landing.id, [Op.or]: items.map(i => ({ tipo: i.tipo, referencia_id: i.id })) },
        attributes: ['tipo', 'referencia_id', 'etiqueta', 'precio_ancla'], raw: true,
      }),
      LandingItem.findAll({
        where: { landing_id: landing.id, etiqueta: { [Op.ne]: null } },
        attributes: [[sequelize.fn('DISTINCT', sequelize.col('etiqueta')), 'etiqueta']], raw: true,
      }),
    ]);
    const colecciones = [];
    etiquetas.forEach(f => etiquetasDe(f.etiqueta).forEach((t) => {
      if (!colecciones.some(c => c.toLowerCase() === t.toLowerCase())) colecciones.push(t);
    }));
    colecciones.sort((a, b) => a.localeCompare(b, 'es'));
    const filaDe = new Map(filas.map(f => [`${f.tipo}:${Number(f.referencia_id)}`, f]));
    const enContador = new Set(urgencia.activo && Array.isArray(urgencia.productos) ? urgencia.productos.map(String) : []);
    const contadorVigente = urgencia.fin_at && new Date(urgencia.fin_at).getTime() > Date.now();
    const porItem = new Map();
    for (const item of items) {
      const clave = `${item.tipo}:${item.id}`;
      const fila = filaDe.get(clave);
      if (!fila) continue;
      const contentId = item.tipo === 'combo' ? `combo-${item.id}` : (item.slug || `producto-${item.id}`);
      porItem.set(clave, {
        precio_ancla: fila.precio_ancla != null ? Number(fila.precio_ancla) : null,
        colecciones: etiquetasDe(fila.etiqueta),
        badge: presentacion[clave]?.insignia_principal || '',
        contador: Boolean(contadorVigente && (enContador.has(contentId) || enContador.has(`producto-${item.id}`))),
      });
    }
    return { colecciones, porItem };
  }

  /**
   * Organizar productos de la landing activa desde Mi catálogo (oferta,
   * colección, quitar todo). La lógica está en landingOrganizar.service; acá
   * solo se lee y se guarda. Solo toca productos que YA están en la landing:
   * nunca publica uno nuevo por la espalda.
   */
  static async organizarEnLandingActiva(usuario_id, inquilino_id, payload = {}, esAdmin = false, tiendaId = null) {
    const { normalizarPedido, organizar } = require('./landingOrganizar.service');
    if (!tiendaId) {
      const err = new Error('Seleccioná una tienda para organizar los productos de la landing.');
      err.status = 409;
      throw err;
    }
    const pedido = normalizarPedido(payload);
    const seleccion = this.normalizarItemsLanding(payload.items);
    if (!seleccion.length) throw new Error('Seleccioná al menos un producto.');

    const { Landing, LandingItem } = require('../models');
    const landing = await Landing.findOne({
      where: { inquilino_id, tienda_id: tiendaId, activo: true },
      order: [
        [sequelize.literal("CASE WHEN tipo_pagina = 'catalogo' THEN 0 WHEN es_home = true THEN 1 ELSE 2 END"), 'ASC'],
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
    });
    if (!landing) {
      const err = new Error('No se encontró una landing activa para esta tienda.');
      err.status = 404;
      throw err;
    }

    const filasLanding = await LandingItem.findAll({
      where: { landing_id: landing.id, [Op.or]: seleccion.map(i => ({ tipo: i.tipo, referencia_id: i.id })) },
    });
    if (!filasLanding.length) throw new Error('Ninguno de los productos elegidos está en tu landing.');

    // Precio de venta del comercio (el de "Tu precio de venta") y lo que hace
    // falta para el contador (content_id) y para quitar un descuento cuando
    // el producto trae su propio precio tachado.
    const idsProducto = filasLanding.filter(f => f.tipo === 'producto').map(f => f.referencia_id);
    const idsCombo = filasLanding.filter(f => f.tipo === 'combo').map(f => f.referencia_id);
    const [productos, combos, precios] = await Promise.all([
      idsProducto.length ? Producto.findAll({ where: { id: { [Op.in]: idsProducto }, inquilino_id }, attributes: ['id', 'slug', 'precio_base', 'precio_tachado'] }) : [],
      idsCombo.length ? ProductoCombo.findAll({ where: { id: { [Op.in]: idsCombo }, inquilino_id }, attributes: ['id', 'precio_total'] }) : [],
      PrecioUsuario.findAll({ where: { usuario_id, [Op.or]: filasLanding.map(f => ({ tipo: f.tipo, referencia_id: f.referencia_id })) }, attributes: ['tipo', 'referencia_id', 'precio'] }),
    ]);
    const precioPropio = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, Number(p.precio)]));
    const porProducto = new Map(productos.map(p => [Number(p.id), p]));
    const porCombo = new Map(combos.map(c => [Number(c.id), c]));
    const filas = filasLanding.map((f) => {
      const id = Number(f.referencia_id);
      const entidad = f.tipo === 'producto' ? porProducto.get(id) : porCombo.get(id);
      const base = f.tipo === 'producto' ? Number(entidad?.precio_base) : Number(entidad?.precio_total);
      return {
        tipo: f.tipo,
        referencia_id: id,
        etiqueta: f.etiqueta,
        precio_ancla: f.precio_ancla,
        precio: precioPropio.get(`${f.tipo}:${id}`) || base || 0,
        precio_tachado: f.tipo === 'producto' ? Number(entidad?.precio_tachado) || null : null,
        content_id: f.tipo === 'combo' ? `combo-${id}` : (entidad?.slug || `producto-${id}`),
      };
    });

    const content = landing.content && typeof landing.content === 'object' && !Array.isArray(landing.content)
      ? { ...landing.content }
      : {};
    const ventaActual = content.venta && typeof content.venta === 'object' && !Array.isArray(content.venta) ? content.venta : {};
    const resultado = organizar(filas, ventaActual, pedido);

    await sequelize.transaction(async (transaction) => {
      for (const cambio of resultado.items) {
        const fila = filasLanding.find(f => f.tipo === cambio.tipo && Number(f.referencia_id) === cambio.referencia_id);
        if (!fila) continue;
        if ((fila.etiqueta ?? null) === cambio.etiqueta && (fila.precio_ancla ?? null) === cambio.precio_ancla) continue;
        fila.etiqueta = cambio.etiqueta;
        fila.precio_ancla = cambio.precio_ancla;
        await fila.save({ transaction });
      }
      content.venta = resultado.venta;
      landing.content = content;
      landing.changed?.('content', true);
      await landing.save({ transaction });
    });

    return {
      landing_id: landing.id,
      actualizados: filasLanding.length,
      fuera_de_landing: seleccion.length - filasLanding.length,
      sin_lugar: resultado.sin_lugar.length,
      contador_lleno: resultado.contador_lleno,
    };
  }

  static async categorizarProductos(usuario_id, inquilino_id, payload = {}, esAdmin = false, tiendaId = null) {
    const { producto_ids = [], categoria_nombre, subcategoria_nombre } = payload;
    const ids = [...new Set((producto_ids || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new Error('Seleccioná al menos un producto.');

    const nombreCategoria = typeof categoria_nombre === 'string' ? categoria_nombre.trim() : '';
    const nombreSubcategoria = typeof subcategoria_nombre === 'string' ? subcategoria_nombre.trim() : '';
    if (!nombreCategoria) throw new Error('El nombre de la categoría es requerido.');

    const administradoresIds = esAdmin ? [] : await this.obtenerIdsAdministradores(inquilino_id);
    const visibilidadProducto = this.combinarVisibilidadProducto(
      this.visibilidadCatalogoWhere(usuario_id, esAdmin, false, administradoresIds),
      !esAdmin ? this.visibilidadTiendaProductoWhere(usuario_id, tiendaId) : {},
    );
    const productos = await Producto.findAll({
      where: {
        id: { [Op.in]: ids },
        inquilino_id,
        activo: true,
        ...visibilidadProducto,
      },
      attributes: ['id', 'precio_base'],
    });

    if (productos.length !== ids.length) {
      throw new Error('Uno o más productos no se encontraron en tu catálogo.');
    }

    return require('../models').sequelize.transaction(async (transaction) => {
      const categoria = await this.buscarOCrearCategoria(nombreCategoria, inquilino_id, null, transaction);
      const categoriaFinal = nombreSubcategoria
        ? await this.buscarOCrearCategoria(nombreSubcategoria, inquilino_id, categoria.id, transaction)
        : categoria;

      for (const producto of productos) {
        const precioBase = parseFloat(producto.precio_base) || 0;
        const [registro] = await PrecioUsuario.findOrCreate({
          where: { usuario_id, tipo: 'producto', referencia_id: producto.id },
          defaults: {
            usuario_id,
            inquilino_id,
            tipo: 'producto',
            referencia_id: producto.id,
            precio: precioBase,
            categoria_id: categoriaFinal.id,
          },
          transaction,
        });

        if (Number(registro.categoria_id) !== Number(categoriaFinal.id)) {
          registro.categoria_id = categoriaFinal.id;
          await registro.save({ transaction });
        }
      }

      return {
        actualizados: productos.length,
        categoria: { id: categoria.id, nombre: categoria.nombre },
        subcategoria: categoriaFinal.id === categoria.id ? null : { id: categoriaFinal.id, nombre: categoriaFinal.nombre },
      };
    });
  }

  // ─── Análisis de sensibilidad ───────────────────────────────────────────────

  static armarAnalisisSensibilidad({ entidad, precioEfectivo, costoBase, costs, config, minimumMarginDecimal }) {
    const cpaMax = Math.round((precioEfectivo * ((Number(costs.cpaPercentage) || 0) / 100)) * 100) / 100;
    const paymentCommissionCost = Math.round((precioEfectivo * ((Number(costs.paymentCommissionPercentage) || 0) / 100)) * 100) / 100;
    const totalCosts = Math.round((
      costoBase
      + cpaMax
      + paymentCommissionCost
      + (Number(costs.shipping) || 0)
      + (Number(costs.confirmation) || 0)
      + (Number(costs.packaging) || 0)
    ) * 100) / 100;
    const profit = Math.round((precioEfectivo - totalCosts) * 100) / 100;
    const margin = precioEfectivo > 0 ? Math.round((profit / precioEfectivo) * 10000) / 10000 : 0;

    // CPA y comisión son % del precio: en cada escenario bajan con él.
    const fixedCost = totalCosts - cpaMax - paymentCommissionCost;
    const variableRate = ((Number(costs.cpaPercentage) || 0) + (Number(costs.paymentCommissionPercentage) || 0)) / 100;
    const sensitivity = this.anotarSensibilidad(comboPricing.calcularSensibilidad(
      { finalPrice: precioEfectivo, fixedCost, variableRate },
      config.escenarios_descuento || undefined,
      { minimumMargin: minimumMarginDecimal },
    ));

    return {
      profit,
      margin,
      estado: this.anotarEstado(margin, minimumMarginDecimal),
      sensitivity,
      costos: {
        costo_compra: costoBase,
        precio_venta_actual: precioEfectivo,
        marketing_cpa_porcentaje: costs.cpaPercentage,
        marketing_cpa: cpaMax,
        costo_envio_promedio: costs.shipping,
        costo_confirmacion_promedio: costs.confirmation,
        costo_empaque_promedio: costs.packaging,
        costo_pago_contra_entrega_porcentaje: costs.paymentCommissionPercentage || 0,
        costo_pago_contra_entrega: paymentCommissionCost,
        costo_total: totalCosts,
      },
      parametros: {
        escenarios_descuento: config.escenarios_descuento || [0, 5, 10, 15, 20, 25, 30, 35],
        margen_minimo: minimumMarginDecimal,
      },
      entidad,
    };
  }

  static async analizarSensibilidadProducto(usuario_id, inquilino_id, producto_id, esAdmin = false, tiendaId = null) {
    const administradoresIds = esAdmin ? [] : await this.obtenerIdsAdministradores(inquilino_id);
    const visibilidadProducto = this.combinarVisibilidadProducto(
      this.visibilidadCatalogoWhere(usuario_id, esAdmin, false, administradoresIds),
      !esAdmin ? this.visibilidadTiendaProductoWhere(usuario_id, tiendaId) : {},
    );
    const producto = await Producto.findOne({
      where: {
        id: producto_id,
        inquilino_id,
        activo: true,
        ...visibilidadProducto,
      },
    });
    if (!producto) throw new Error('Producto no encontrado.');
    if (!producto.precio_base) throw new Error('Este producto no tiene análisis de rentabilidad configurado.');

    // config y precioPersonalizado no dependen entre sí — en paralelo.
    const [configBase, precioPersonalizado, costosPagopar] = await Promise.all([
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'producto', producto.id),
      ComboConfiguracionService.obtenerCostosPagopar(usuario_id).catch(() => ({ comision_maxima: 0 })),
    ]);
    const config = {
      ...(typeof configBase.toJSON === 'function' ? configBase.toJSON() : configBase),
      pagopar_comision_porcentaje: costosPagopar.comision_maxima || 0,
    };
    const costs = ComboConfiguracionService.toMotorCosts(config);
    const rahaCosts = {
      ...ComboConfiguracionService.toRahaMotorCosts(config),
      paymentCommissionPercentage: 2,
    };
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(producto.precio_base);

    const costoBase = producto.precio_costo != null
      ? parseFloat(producto.precio_costo)
      : parseFloat(producto.precio_base);

    const entidad = {
      id: producto.id,
      nombre: producto.nombre,
      precio_base: parseFloat(producto.precio_base),
      precio_minimo: producto.precio_minimo !== null ? parseFloat(producto.precio_minimo) : null,
      precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
      precio_efectivo: precioEfectivo,
    };
    const operacionPropia = this.armarAnalisisSensibilidad({
      entidad,
      precioEfectivo,
      costoBase,
      costs,
      config,
      minimumMarginDecimal,
    });
    const operacionRaha = this.armarAnalisisSensibilidad({
      entidad,
      precioEfectivo,
      costoBase,
      costs: rahaCosts,
      config,
      minimumMarginDecimal,
    });

    return {
      producto: entidad,
      profit: operacionPropia.profit,
      margin: operacionPropia.margin,
      estado: operacionPropia.estado,
      sensitivity: operacionPropia.sensitivity,
      costos: operacionPropia.costos,
      operaciones: {
        propios: operacionPropia,
        raha: operacionRaha,
      },
      pagopar: {
        metodos: costosPagopar.metodos || [],
        opciones_checkout: costosPagopar.opciones_checkout || [],
        comision_maxima: costosPagopar.comision_maxima || 0,
        disponible: Boolean(costosPagopar.disponible),
      },
    };
  }

  static async analizarSensibilidadCombo(usuario_id, inquilino_id, combo_id, esAdmin = false) {
    const administradoresIds = esAdmin ? [] : await this.obtenerIdsAdministradores(inquilino_id);
    const combo = await ProductoCombo.findOne({
      where: { id: combo_id, inquilino_id, estado: 'ACTIVO', ...this.visibilidadComboWhere(usuario_id, esAdmin, false, administradoresIds) },
      include: [{
        model: Producto,
        as: 'producto_padre',
        attributes: ['id'],
        where: {
          inquilino_id,
          activo: true,
          ...this.visibilidadCatalogoWhere(usuario_id, esAdmin, false, administradoresIds),
        },
        required: true,
      }],
    });
    if (!combo) throw new Error('Combo no encontrado.');

    const [configBase, precioPersonalizado, costosPagopar] = await Promise.all([
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'combo', combo.id),
      ComboConfiguracionService.obtenerCostosPagopar(usuario_id).catch(() => ({ comision_maxima: 0 })),
    ]);
    const config = {
      ...(typeof configBase.toJSON === 'function' ? configBase.toJSON() : configBase),
      pagopar_comision_porcentaje: costosPagopar.comision_maxima || 0,
    };
    
    const costs = ComboConfiguracionService.toMotorCosts(config);
    const rahaCosts = {
      ...ComboConfiguracionService.toRahaMotorCosts(config),
      paymentCommissionPercentage: 2,
    };
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(combo.precio_total);

    const costoBase = parseFloat(combo.precio_total);
    const entidad = {
      id: combo.id,
      nombre: combo.nombre,
      precio_base: parseFloat(combo.precio_total),
      precio_minimo: combo.precio_minimo !== null ? parseFloat(combo.precio_minimo) : null,
      precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
      precio_efectivo: precioEfectivo,
    };
    const operacionPropia = this.armarAnalisisSensibilidad({
      entidad,
      precioEfectivo,
      costoBase,
      costs,
      config,
      minimumMarginDecimal,
    });
    const operacionRaha = this.armarAnalisisSensibilidad({
      entidad,
      precioEfectivo,
      costoBase,
      costs: rahaCosts,
      config,
      minimumMarginDecimal,
    });

    return {
      combo: entidad,
      profit: operacionPropia.profit,
      margin: operacionPropia.margin,
      estado: operacionPropia.estado,
      sensitivity: operacionPropia.sensitivity,
      costos: operacionPropia.costos,
      operaciones: {
        propios: operacionPropia,
        raha: operacionRaha,
      },
      pagopar: {
        metodos: costosPagopar.metodos || [],
        opciones_checkout: costosPagopar.opciones_checkout || [],
        comision_maxima: costosPagopar.comision_maxima || 0,
        disponible: Boolean(costosPagopar.disponible),
      },
      warnings: [],
    };
  }
}

module.exports = PrecioUsuarioService;
