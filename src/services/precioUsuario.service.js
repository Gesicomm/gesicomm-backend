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
const { Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca } = require('../models');
const ComboConfiguracionService = require('./comboConfiguracion.service');
const ComboService = require('./combo.service');
const comboPricing = require('../utils/comboPricing');

class PrecioUsuarioService {

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

  static async listarCatalogo(usuario_id, inquilino_id) {
    // productos/combos/precios son independientes entre sí — se resuelven en
    // paralelo en vez de uno atrás de otro para no acumular latencia de red
    // por cada ida-vuelta a la base.
    const [productos, combos, precios] = await Promise.all([
      Producto.findAll({
        where: { inquilino_id, activo: true, estado_venta: 'en_venta' },
        attributes: [
          'id', 'slug', 'nombre', 'descripcion_corta', 'descripcion_larga', 'precio_base', 'precio_minimo',
          'precio_tachado', 'cantidad_disponible', 'destacado', 'created_at',
        ],
        include: [
          { association: 'categoria', attributes: ['id', 'nombre'] },
          { model: Marca, attributes: ['id', 'nombre'] },
        ],
        order: [['nombre', 'ASC']],
      }),
      ProductoCombo.findAll({
        where: { inquilino_id, estado: 'ACTIVO' },
        attributes: ['id', 'nombre', 'descripcion', 'precio_total', 'precio_minimo', 'producto_id', 'created_at'],
        include: [
          {
            model: ProductoComboItem,
            as: 'items',
            attributes: ['id'],
            include: [{ model: Producto, as: 'producto_incluido', attributes: ['id', 'nombre'] }],
          },
          // Un combo no tiene categoría/marca/imagen propias: las hereda del
          // producto principal, igual que hace landing.service al publicar.
          // required: true = INNER JOIN: si el padre está inactivo, el combo
          // queda excluido del catálogo — coherente con obtenerPublica(), que
          // aplica la misma condición y nunca mostraría ese combo en la landing.
          {
            model: Producto,
            as: 'producto_padre',
            attributes: ['id', 'cantidad_disponible'],
            where: { activo: true },
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

    // Depende de los IDs recién resueltos, no se puede paralelizar con lo anterior.
    // Los combos entran con el id de su producto_padre: la imagen del combo es la del principal.
    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
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

    const productosDto = productos.map(p => {
      const precioUsuario = mapaPrecios.has(`producto:${p.id}`) ? mapaPrecios.get(`producto:${p.id}`) : null;
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
        precio_tachado: p.precio_tachado ? parseFloat(p.precio_tachado) : null,
        imagen: imgMap.get(p.id) || null,
        imagenes: galeriaMap.get(p.id) || [],
        categoria: p.categoria?.nombre || null,
        marca: p.Marca?.nombre || null,
        stock: p.cantidad_disponible,
        destacado: !!p.destacado,
        creado_en: p.created_at,
        slug: p.slug,
      };
    });

    const combosDto = combos.map(c => {
      const precioUsuario = mapaPrecios.has(`combo:${c.id}`) ? mapaPrecios.get(`combo:${c.id}`) : null;
      const precioBase = parseFloat(c.precio_total);
      const padre = c.producto_padre;
      return {
        id: c.id,
        tipo: 'combo',
        nombre: c.nombre,
        descripcion: c.descripcion,
        precio_base: precioBase,
        precio_minimo: c.precio_minimo !== null ? parseFloat(c.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        productos_incluidos: (c.items || []).map(i => i.producto_incluido?.nombre).filter(Boolean),
        imagen: padre ? (imgMap.get(padre.id) || null) : null,
        imagenes: padre ? (galeriaMap.get(padre.id) || []) : [],
        categoria: padre?.categoria?.nombre || null,
        marca: padre?.Marca?.nombre || null,
        stock: padre?.cantidad_disponible ?? null,
        destacado: false,
        creado_en: c.created_at,
      };
    });

    return { productos: productosDto, combos: combosDto };
  }

    static async listarCatalogoPaginado(usuario_id, inquilino_id, filtros = {}) {
    const { sequelize, Categoria } = require('../models');
    const {
      page = 1, limit = 10, busqueda = '', filtroCategoria = '', filtroProveedor = '', orden = 'nombre', tipo = 'todos'
    } = filtros;
    const offset = (page - 1) * limit;

    const replacements = { usuario_id, inquilino_id };
    
    // Filtro de categoría
    let catFilter = '';
    if (filtroCategoria) {
      const cat = await Categoria.findOne({ where: { nombre: filtroCategoria, inquilino_id } });
      if (cat) {
        replacements.categoria_id = cat.id;
        catFilter = 'AND p.categoria_id = :categoria_id';
      } else {
        return { items: [], total: 0, page: 1, totalPages: 0, categorias: [] };
      }
    }

    
    let provFilter = '';
    if (filtroProveedor) {
      replacements.filtroProveedor = filtroProveedor;
      provFilter = 'AND p.proveedor_id IN (SELECT id FROM proveedores WHERE nombre = :filtroProveedor)';
    }

    let searchFilter = '';
    if (busqueda.trim()) {
      replacements.busqueda = `%${busqueda.trim()}%`;
      searchFilter = 'AND (c.nombre ILIKE :busqueda OR c.descripcion ILIKE :busqueda)';
    }

    let orderSql = 'ORDER BY nombre ASC';
    if (orden === 'recientes') orderSql = 'ORDER BY created_at DESC';
    if (orden === 'precio-asc') orderSql = 'ORDER BY precio_efectivo ASC';
    if (orden === 'precio-desc') orderSql = 'ORDER BY precio_efectivo DESC';

    const productosSql = `
      SELECT p.id, 'producto' as tipo, p.nombre, p.descripcion_corta as descripcion, p.created_at, p.categoria_id,
        COALESCE(pu.precio, p.precio_base) as precio_efectivo
      FROM productos p
      LEFT JOIN precios_usuario pu ON pu.tipo = 'producto' AND pu.referencia_id = p.id AND pu.usuario_id = :usuario_id
      WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
      ${catFilter}
      ${provFilter}
      ${searchFilter.replace(/c\./g, 'p.').replace(/descripcion/g, 'descripcion_corta')}
    `;

    const combosSql = `
      SELECT c.id, 'combo' as tipo, c.nombre, c.descripcion, c.created_at, p.categoria_id,
        COALESCE(pu.precio, c.precio_total) as precio_efectivo
      FROM producto_combos c
      INNER JOIN productos p ON c.producto_id = p.id AND p.activo = true
      LEFT JOIN precios_usuario pu ON pu.tipo = 'combo' AND pu.referencia_id = c.id AND pu.usuario_id = :usuario_id
      WHERE c.inquilino_id = :inquilino_id AND c.estado = 'ACTIVO'
      ${catFilter}
      ${provFilter}
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
    const dataQuery = `${finalQuery} ${orderSql} LIMIT :limit OFFSET :offset`;
    
    replacements.limit = parseInt(limit);
    replacements.offset = parseInt(offset);

    const [countResult, paginatedItems] = await Promise.all([
      sequelize.query(countQuery, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(dataQuery, { replacements, type: sequelize.QueryTypes.SELECT })
    ]);

    const total = parseInt(countResult[0]?.total || 0);
    
    const idsProductos = paginatedItems.filter(i => i.tipo === 'producto').map(i => i.id);
    const idsCombos = paginatedItems.filter(i => i.tipo === 'combo').map(i => i.id);

    const { Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca, Proveedor } = require('../models');

    const [productos, combos, precios, categoriasUnicasData, proveedoresUnicasData] = await Promise.all([
      idsProductos.length ? Producto.findAll({
        where: { id: { [require('sequelize').Op.in]: idsProductos } },
        attributes: [
          'id', 'slug', 'nombre', 'descripcion_corta', 'descripcion_larga', 'precio_base', 'precio_minimo',
          'precio_tachado', 'cantidad_disponible', 'destacado', 'created_at', 'categoria_id'
        ],
        include: [
          { association: 'categoria', attributes: ['id', 'nombre'] },
          { model: Marca, attributes: ['id', 'nombre'] },
          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
        ]
      }) : [],
      idsCombos.length ? ProductoCombo.findAll({
        where: { id: { [require('sequelize').Op.in]: idsCombos } },
        attributes: ['id', 'nombre', 'descripcion', 'precio_total', 'precio_minimo', 'producto_id', 'created_at'],
        include: [
          {
            model: ProductoComboItem,
            as: 'items',
            attributes: ['id'],
            include: [{ model: Producto, as: 'producto_incluido', attributes: ['id', 'nombre'] }],
          },
          {
            model: Producto,
            as: 'producto_padre',
            attributes: ['id', 'cantidad_disponible', 'categoria_id'],
            required: true,
            include: [
              { association: 'categoria', attributes: ['id', 'nombre'] },
              { model: Marca, attributes: ['id', 'nombre'] },
          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
            ],
          },
        ]
      }) : [],
      PrecioUsuario.findAll({ where: { usuario_id, tipo: 'producto', referencia_id: { [require('sequelize').Op.in]: idsProductos } } }).then(p1 => 
        PrecioUsuario.findAll({ where: { usuario_id, tipo: 'combo', referencia_id: { [require('sequelize').Op.in]: idsCombos } } }).then(p2 => [...p1, ...p2])
      ),
      sequelize.query(`
        SELECT DISTINCT c.nombre 
        FROM categorias c 
        INNER JOIN productos p ON p.categoria_id = c.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY c.nombre ASC
      `, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`
        SELECT DISTINCT pr.nombre 
        FROM proveedores pr 
        INNER JOIN productos p ON p.proveedor_id = pr.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY pr.nombre ASC
      `, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData ? categoriasUnicasData.map(c => c.nombre) : [];
    const proveedoresUnicos = proveedoresUnicasData ? proveedoresUnicasData.map(p => p.nombre) : [];

    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));

    const idsParaImagen = [
      ...productos.map(p => p.id),
      ...combos.map(c => c.producto_padre?.id).filter(Boolean),
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
        where: { producto_id: { [require('sequelize').Op.in]: idsParaImagen } },
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

    const mapaProductosDto = new Map(productos.map(p => {
      const precioUsuario = mapaPrecios.has(`producto:${p.id}`) ? mapaPrecios.get(`producto:${p.id}`) : null;
      const precioBase = parseFloat(p.precio_base);
      return [p.id, {
        id: p.id,
        tipo: 'producto',
        nombre: p.nombre,
        descripcion: p.descripcion_corta,
        descripcion_larga: p.descripcion_larga,
        precio_base: precioBase,
        precio_minimo: p.precio_minimo !== null ? parseFloat(p.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        precio_tachado: p.precio_tachado ? parseFloat(p.precio_tachado) : null,
        imagen: imgMap.get(p.id) || null,
        imagenes: galeriaMap.get(p.id) || [],
        categoria: p.categoria?.nombre || null,
        marca: p.Marca?.nombre || null,
        proveedor: p.proveedor?.nombre || null,
        stock: p.cantidad_disponible,
        destacado: !!p.destacado,
        creado_en: p.created_at,
        slug: p.slug,
      }];
    }));

    const mapaCombosDto = new Map(combos.map(c => {
      const precioUsuario = mapaPrecios.has(`combo:${c.id}`) ? mapaPrecios.get(`combo:${c.id}`) : null;
      const precioBase = parseFloat(c.precio_total);
      const padre = c.producto_padre;
      return [c.id, {
        id: c.id,
        tipo: 'combo',
        nombre: c.nombre,
        descripcion: c.descripcion,
        precio_base: precioBase,
        precio_minimo: c.precio_minimo !== null ? parseFloat(c.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        productos_incluidos: (c.items || []).map(i => i.producto_incluido?.nombre).filter(Boolean),
        imagen: padre ? (imgMap.get(padre.id) || null) : null,
        imagenes: padre ? (galeriaMap.get(padre.id) || []) : [],
        categoria: padre?.categoria?.nombre || null,
        marca: padre?.Marca?.nombre || null,
        proveedor: padre?.proveedor?.nombre || null,
        stock: padre?.cantidad_disponible ?? null,
        destacado: false,
        creado_en: c.created_at,
      }];
    }));

    const items = paginatedItems.map(item => {
      if (item.tipo === 'producto') return mapaProductosDto.get(item.id);
      return mapaCombosDto.get(item.id);
    }).filter(Boolean);

    return { 
      items, 
      total, 
      page: parseInt(page), 
      totalPages: Math.ceil(total / limit),
      categorias: categoriasUnicas,
      proveedores: proveedoresUnicos
    };
  }

  // ─── Guardar precio propio ─────────────────────────────────────────────────

  static async guardarPrecioProducto(usuario_id, inquilino_id, producto_id, precio) {
    const producto = await Producto.findOne({ where: { id: producto_id, inquilino_id, activo: true } });
    if (!producto) throw new Error('Producto no encontrado.');
    return this._guardar(usuario_id, inquilino_id, 'producto', producto.id, precio, producto.precio_minimo);
  }

  static async guardarPrecioCombo(usuario_id, inquilino_id, combo_id, precio) {
    const combo = await ProductoCombo.findOne({ where: { id: combo_id, inquilino_id, estado: 'ACTIVO' } });
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

  // ─── Análisis de sensibilidad ───────────────────────────────────────────────

  static async analizarSensibilidadProducto(usuario_id, inquilino_id, producto_id) {
    const producto = await Producto.findOne({ where: { id: producto_id, inquilino_id, activo: true } });
    if (!producto) throw new Error('Producto no encontrado.');
    if (!producto.precio_costo) throw new Error('Este producto no tiene análisis de rentabilidad configurado.');

    // config y precioPersonalizado no dependen entre sí — en paralelo.
    const [config, precioPersonalizado] = await Promise.all([
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'producto', producto.id),
    ]);
    const costs = ComboConfiguracionService.toMotorCosts(config);
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(producto.precio_base);

    const principalResult = comboPricing.calcularPrincipal(
      { cost: parseFloat(producto.precio_base), salePrice: precioEfectivo },
      costs,
    );

    const sensitivity = this.anotarSensibilidad(comboPricing.calcularSensibilidad(
      { finalPrice: precioEfectivo, totalCost: principalResult.totalCosts },
      config.escenarios_descuento || undefined,
      { minimumMargin: minimumMarginDecimal },
    ));

    return {
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        precio_base: parseFloat(producto.precio_base),
        precio_minimo: producto.precio_minimo !== null ? parseFloat(producto.precio_minimo) : null,
        precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
        precio_efectivo: precioEfectivo,
      },
      profit: principalResult.profit,
      margin: principalResult.margin,
      estado: this.anotarEstado(principalResult.margin, minimumMarginDecimal),
      sensitivity,
    };
  }

  static async analizarSensibilidadCombo(usuario_id, inquilino_id, combo_id) {
    const combo = await ProductoCombo.findOne({
      where: { id: combo_id, inquilino_id, estado: 'ACTIVO' }
    });
    if (!combo) throw new Error('Combo no encontrado.');

    const [config, precioPersonalizado] = await Promise.all([
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'combo', combo.id),
    ]);
    
    const costs = ComboConfiguracionService.toMotorCosts(config);
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(combo.precio_total);

    const principalResult = comboPricing.calcularPrincipal(
      { cost: parseFloat(combo.precio_total), salePrice: precioEfectivo },
      costs,
    );

    const sensitivity = this.anotarSensibilidad(comboPricing.calcularSensibilidad(
      { finalPrice: precioEfectivo, totalCost: principalResult.totalCosts },
      config.escenarios_descuento || undefined,
      { minimumMargin: minimumMarginDecimal },
    ));

    return {
      combo: {
        id: combo.id,
        nombre: combo.nombre,
        precio_base: parseFloat(combo.precio_total),
        precio_minimo: combo.precio_minimo !== null ? parseFloat(combo.precio_minimo) : null,
        precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
        precio_efectivo: precioEfectivo,
      },
      profit: principalResult.profit,
      margin: principalResult.margin,
      estado: this.anotarEstado(principalResult.margin, minimumMarginDecimal),
      sensitivity,
      warnings: [],
    };
  }
}

module.exports = PrecioUsuarioService;
