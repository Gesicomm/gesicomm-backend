'use strict';

const { Op } = require('sequelize');
const slugify = require('slugify');
const { sequelize, Producto, HistorialPrecio, ProductoVariante, Oferta, OfertaComponente, ProductoFaq, PrecioUsuario, Deposito, InventarioUbicacion } = require('../models');
const { calcularPrecioEfectivo, validarPrecioMinimo } = require('../utils/precio');
const PricingService = require('./pricing.service');

class ProductoService {
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

  
  static async generarSlugUnico(nombre, inquilino_id, excluirId = null) {
    const base = slugify(nombre, { lower: true, strict: true });
    let slug = base;
    let contador = 1;

    while (true) {
      const where = { slug, inquilino_id };
      if (excluirId) where.id = { [Op.ne]: excluirId };
      const existe = await Producto.findOne({ where });
      if (!existe) break;
      slug = `${base}-${++contador}`;
    }

    return slug;
  }

  static async recalcularStockPadre(producto_id, transaction) {
    const variantes = await ProductoVariante.findAll({
      where: { producto_id, activo: true },
      transaction,
    });

    // Si el producto no tiene variantes activas, NO se pisa la cantidad_disponible manual
    if (!variantes || variantes.length === 0) {
      return null;
    }

    const stock_salon = variantes.reduce((acc, v) => acc + (parseInt(v.stock_salon, 10) || 0), 0);
    const stock_deposito = variantes.reduce((acc, v) => acc + (parseInt(v.stock_deposito, 10) || 0), 0);
    const total = stock_salon + stock_deposito;
    await Producto.update(
      { cantidad_disponible: total, stock_salon, stock_deposito },
      { where: { id: producto_id }, transaction }
    );
    return total;
  }

  static serializar(producto, esAdmin = false, usuarioId = null) {
    const data = producto.toJSON ? producto.toJSON() : { ...producto };
    data.precio_ancla = data.precio_tachado ?? null;
    // precio_costo: visible para el admin o para quien creó el producto —
    // el resto de usuarios no debe ver el costo de productos ajenos.
    const puedeVerCosto = esAdmin || (usuarioId != null && data.creado_por === usuarioId);
    if (!puedeVerCosto) { delete data.precio_costo; delete data.precio_dolar; }
    // precio_minimo: piso de precio que solo define el admin — invisible e
    // inmodificable para el rol 'usuario', incluso en sus propios productos.
    if (!esAdmin) delete data.precio_minimo;
    // Misma regla que actualizar() y que los endpoints de imágenes. Se
    // expone resuelta para que el frontend no tenga que volver a deducirla
    // (y pueda esconder lo que no se va a poder guardar, en vez de dejar
    // intentarlo y fallar).
    data.puede_editar = esAdmin || (usuarioId != null && data.creado_por === usuarioId);
    return data;
  }

  static async buscar(filtros, inquilino_id, esAdmin, usuarioId = null) {
    const {
      texto, categoria_id, marca_id, proveedor_id, activo, destacado,
      precio_min, precio_max, stock_bajo, sin_stock, con_ofertas,
      con_variantes, ordenar_por, page = 1, limit = 10,
      creado_por
    } = filtros;

    const where = { inquilino_id };
    if (activo !== undefined) where.activo = activo;
    if (esAdmin && creado_por !== undefined) where.creado_por = creado_por;
    if (destacado !== undefined) where.destacado = destacado;
    if (categoria_id) where.categoria_id = categoria_id;
    if (marca_id) where.marca_id = marca_id;
    if (proveedor_id) where.proveedor_id = proveedor_id;
    if (precio_min !== undefined) where.precio_base = { ...where.precio_base, [Op.gte]: precio_min };
    if (precio_max !== undefined) where.precio_base = { ...where.precio_base, [Op.lte]: precio_max };
    if (sin_stock) {
      where.cantidad_disponible = { [Op.lte]: 0 };
    } else if (stock_bajo) {
      where.cantidad_disponible = { [Op.lte]: sequelize.col('stock_minimo') };
    }
    if (texto) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${texto}%` } },
        { sku: { [Op.iLike]: `%${texto}%` } },
        { descripcion_corta: { [Op.iLike]: `%${texto}%` } },
      ];
    }
    if (!esAdmin && usuarioId != null) {
      if (creado_por !== undefined || filtros.mios_solamente || filtros.solamenteMios) {
        where.creado_por = usuarioId;
      } else {
        const administradoresIds = await this.obtenerIdsAdministradores(inquilino_id);
        const creadoresVisibles = [...new Set([usuarioId, ...administradoresIds].filter(id => id != null))];
        where[Op.and] = [
          ...(where[Op.and] || []),
          {
            [Op.or]: [
              { creado_por: null },
              { creado_por: { [Op.in]: creadoresVisibles } },
            ],
          },
        ];
      }
    }

    const filtrosPorIds = [];
    if (con_variantes) {
      const variantes = await ProductoVariante.findAll({
        where: { inquilino_id, activo: true },
        attributes: ['producto_id'],
        group: ['producto_id'],
        raw: true,
      });
      filtrosPorIds.push(variantes.map(v => v.producto_id));
    }
    if (con_ofertas) {
      const ofertas = await Oferta.findAll({
        where: { inquilino_id, activo: true },
        attributes: ['producto_ancla_id'],
        group: ['producto_ancla_id'],
        raw: true,
      });
      filtrosPorIds.push(ofertas.map(o => o.producto_ancla_id));
    }
    if (filtrosPorIds.length > 0) {
      const idsFiltrados = filtrosPorIds.reduce((acc, ids) => {
        const setIds = new Set(ids);
        return acc.filter(id => setIds.has(id));
      });
      where.id = { [Op.in]: idsFiltrados.length ? idsFiltrados : [-1] };
    }

    const offset = (page - 1) * limit;
    const ordenes = {
      recientes: [['created_at', 'DESC']],
      nombre: [['nombre', 'ASC']],
      precio_asc: [['precio_base', 'ASC']],
      precio_desc: [['precio_base', 'DESC']],
      stock_asc: [['cantidad_disponible', 'ASC']],
    };
    const order = ordenes[ordenar_por] || ordenes.recientes;

    const queryParams = {
      where,
      attributes: [
        // slug: es la URL pública del producto dentro de la landing de la
        // tienda (https://<tienda>.gesicomm.com/<slug>) — lo usa el wizard
        // de campañas para mostrar el link del anuncio sin tener que pedir
        // el detalle de cada producto por separado.
        'id', 'nombre', 'slug', 'sku', 'tags', 'precio_base', 'precio_costo', 'precio_dolar', 'es_dolar', 'precio_tachado',
        'descuento_porcentaje',
        'cantidad_disponible', 'stock_minimo', 'stock_salon', 'stock_deposito', 'stock_minimo_salon',
        'estado_venta', 'activo', 'destacado', 'categoria_id', 'marca_id', 'proveedor_id', 'creado_por'
      ],
      order,
    };

    if (!filtros.sin_limite && !filtros.sinLimite) {
      queryParams.limit = parseInt(limit);
      queryParams.offset = offset;
    }

    const { rows: productos, count } = await Producto.findAndCountAll(queryParams);

    const productosSerializados = productos.map(p => this.serializar(p, esAdmin, usuarioId));

    if (!esAdmin && usuarioId != null && productosSerializados.length > 0) {
      const preciosPropios = await PrecioUsuario.findAll({
        where: {
          usuario_id: usuarioId,
          tipo: 'producto',
          referencia_id: { [Op.in]: productosSerializados.map(p => p.id) },
        },
        attributes: ['referencia_id', 'precio'],
      });
      const precioPorProducto = new Map(preciosPropios.map(p => [Number(p.referencia_id), parseFloat(p.precio)]));
      productosSerializados.forEach(p => {
        const precioBase = parseFloat(p.precio_base) || 0;
        const precioUsuario = precioPorProducto.has(Number(p.id)) ? precioPorProducto.get(Number(p.id)) : null;
        // Para el editor de combos y otros flujos de tienda:
        // costo_tienda = lo que la tienda paga por el catálogo Gesicomm;
        // precio_efectivo = lo que la tienda configuró para vender.
        // No se expone precio_costo de productos ajenos.
        p.costo_tienda = precioBase;
        p.precio_usuario = precioUsuario;
        p.precio_efectivo = precioUsuario !== null ? precioUsuario : precioBase;
      });
    }

    if (productosSerializados.length > 0) {
      const { ProductoImagen } = require('../models');
      const productIds = productosSerializados.map(p => p.id);
      const [imagenes, variantes, ofertas] = await Promise.all([
        ProductoImagen.findAll({
          where: { producto_id: { [Op.in]: productIds } },
          attributes: ['producto_id', 'url', 'es_principal'],
          order: [['es_principal', 'DESC'], ['created_at', 'ASC']]
        }),
        ProductoVariante.findAll({
          where: { producto_id: { [Op.in]: productIds }, activo: true },
          attributes: ['producto_id', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
          group: ['producto_id'],
          raw: true,
        }),
        Oferta.findAll({
          where: { producto_ancla_id: { [Op.in]: productIds }, activo: true },
          attributes: ['producto_ancla_id', [sequelize.fn('COUNT', sequelize.col('id')), 'total']],
          group: ['producto_ancla_id'],
          raw: true,
        }),
      ]);
      const imgMap = new Map();
      const variantesMap = new Map(variantes.map(v => [v.producto_id, parseInt(v.total, 10) || 0]));
      const ofertasMap = new Map(ofertas.map(o => [o.producto_ancla_id, parseInt(o.total, 10) || 0]));
      // As they are ordered by es_principal DESC, the first one encountered per product will be the principal or the oldest one
      imagenes.forEach(img => {
        if (!imgMap.has(img.producto_id)) {
          imgMap.set(img.producto_id, img.url);
        }
      });
      
      productosSerializados.forEach(p => {
        p.imagenes = imgMap.has(p.id) ? [{ url: imgMap.get(p.id) }] : [];
        p.variantes_count = variantesMap.get(p.id) || 0;
        p.ofertas_count = ofertasMap.get(p.id) || 0;
        p.tags_count = Array.isArray(p.tags) ? p.tags.length : 0;
      });
    }

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / limit),
      productos: productosSerializados,
    };
  }

  static async detalle(id, inquilino_id, esAdmin, usuarioId = null) {
    const where = { id, inquilino_id };
    if (!esAdmin && usuarioId != null) {
      const administradoresIds = await this.obtenerIdsAdministradores(inquilino_id);
      const creadoresVisibles = [...new Set([usuarioId, ...administradoresIds].filter(id => id != null))];
      where[Op.or] = [
        { creado_por: null },
        { creado_por: { [Op.in]: creadoresVisibles } },
      ];
    }
    const producto = await Producto.findOne({
      where,
      // Sin includes, totalmente aislado
    });

    if (!producto) throw new Error('Producto no encontrado.');

    const data = this.serializar(producto, esAdmin, usuarioId);
    if (usuarioId != null) {
      data.stock_depositos = await this.obtenerStockPorDeposito(producto.id, usuarioId);
    }
    return data;
  }

  static async obtenerDepositosPropiosIds(usuarioId, transaction) {
    const depositos = await Deposito.findAll({
      where: { usuario_id: usuarioId },
      attributes: ['id'],
      transaction,
    });
    return depositos.map((d) => d.id);
  }

  static async obtenerStockPorDeposito(productoId, usuarioId, transaction) {
    const depositoIds = await this.obtenerDepositosPropiosIds(usuarioId, transaction);
    if (depositoIds.length === 0) return [];

    const filas = await InventarioUbicacion.findAll({
      where: {
        producto_id: productoId,
        deposito_id: { [Op.in]: depositoIds },
      },
      attributes: ['deposito_id', 'variante_id', 'cantidad_disponible'],
      transaction,
    });

    return filas.map((f) => ({
      deposito_id: Number(f.deposito_id),
      variante_id: f.variante_id == null ? null : Number(f.variante_id),
      cantidad: parseInt(f.cantidad_disponible, 10) || 0,
    }));
  }

  static async sincronizarStockDeposito(productoId, usuarioId, stockDepositosPayload, transaction) {
    const [producto, variantes] = await Promise.all([
      Producto.findByPk(productoId, { transaction }),
      ProductoVariante.findAll({ where: { producto_id: productoId, activo: true }, transaction }),
    ]);
    if (!producto) throw new Error('Producto no encontrado.');

    const stockEsperado = variantes.length > 0
      ? variantes.map((v) => ({
        variante_id: v.id,
        cantidad: Math.max(0, (parseInt(v.stock_salon, 10) || 0) + (parseInt(v.stock_deposito, 10) || 0)),
      }))
      : [{
        variante_id: null,
        cantidad: Math.max(0, (parseInt(producto.stock_salon, 10) || 0) + (parseInt(producto.stock_deposito, 10) || 0)),
      }];

    const totalDeposito = stockEsperado.reduce((acc, fila) => acc + fila.cantidad, 0);
    const depositoIdsPropios = await this.obtenerDepositosPropiosIds(usuarioId, transaction);
    const depositosPermitidos = new Set(depositoIdsPropios.map(Number));
    const normalizadas = Array.isArray(stockDepositosPayload)
      ? stockDepositosPayload
        .map((fila) => ({
          deposito_id: Number(fila.deposito_id),
          variante_id: fila.variante_id == null ? null : Number(fila.variante_id),
          cantidad: Math.max(0, parseInt(fila.cantidad, 10) || 0),
        }))
        .filter((fila) => fila.deposito_id && fila.cantidad > 0)
      : [];

    if (totalDeposito > 0 && normalizadas.length === 0) {
      const err = new Error('Distribuí el stock entre tus ubicaciones.');
      err.seccion = 'stock';
      throw err;
    }

    const totalDistribuido = normalizadas.reduce((acc, fila) => acc + fila.cantidad, 0);
    if (totalDistribuido !== totalDeposito) {
      const err = new Error(`La distribución por ubicación (${totalDistribuido}) debe sumar el stock total (${totalDeposito}).`);
      err.seccion = 'stock';
      throw err;
    }

    if (normalizadas.some((fila) => !depositosPermitidos.has(fila.deposito_id))) {
      const err = new Error('Uno de los depósitos seleccionados no existe, está inactivo o no pertenece a este comercio.');
      err.seccion = 'stock';
      throw err;
    }

    if (variantes.length > 0) {
      const variantesPermitidas = new Set(variantes.map((v) => Number(v.id)));
      if (normalizadas.some((fila) => !fila.variante_id || !variantesPermitidas.has(fila.variante_id))) {
        const err = new Error('Distribuí el stock de depósito por variante y depósito.');
        err.seccion = 'stock';
        throw err;
      }

      const totalPorVariante = normalizadas.reduce((acc, fila) => {
        acc.set(fila.variante_id, (acc.get(fila.variante_id) || 0) + fila.cantidad);
        return acc;
      }, new Map());
      const varianteDesbalanceada = stockEsperado.find((fila) => (totalPorVariante.get(fila.variante_id) || 0) !== fila.cantidad);
      if (varianteDesbalanceada) {
        const esperado = varianteDesbalanceada.cantidad;
        const recibido = totalPorVariante.get(varianteDesbalanceada.variante_id) || 0;
        const err = new Error(`La distribución de una variante (${recibido}) debe sumar su stock en depósito (${esperado}).`);
        err.seccion = 'stock';
        throw err;
      }
    }

    const existentes = depositoIdsPropios.length > 0
      ? await InventarioUbicacion.findAll({
        where: {
          producto_id: productoId,
          deposito_id: { [Op.in]: depositoIdsPropios },
        },
        transaction,
      })
      : [];

    const clave = (deposito, variante) => `${deposito}:${variante || 'SIN_VARIANTE'}`;
    const deseadas = new Map(
      normalizadas.map((fila) => [clave(fila.deposito_id, fila.variante_id), fila]),
    );

    for (const fila of existentes) {
      const filaDeseada = deseadas.get(clave(fila.deposito_id, fila.variante_id));

      if (filaDeseada) {
        await fila.update({ cantidad_disponible: filaDeseada.cantidad }, { transaction });
        deseadas.delete(clave(fila.deposito_id, fila.variante_id));
      } else if ((parseInt(fila.cantidad_reservada, 10) || 0) > 0) {
        await fila.update({ cantidad_disponible: 0 }, { transaction });
      } else {
        await fila.destroy({ transaction });
      }
    }

    if (deseadas.size === 0) return;

    await InventarioUbicacion.bulkCreate(
      [...deseadas.values()].map((fila) => ({
        usuario_id: usuarioId,
        producto_id: productoId,
        variante_id: fila.variante_id,
        deposito_id: fila.deposito_id,
        cantidad_disponible: fila.cantidad,
        cantidad_reservada: 0,
      })),
      { transaction },
    );
  }

  /**
   * Simulador de precio del admin (tab Precios/Ofertas de ProductForm) —
   * llama EXACTAMENTE al mismo PricingService.resolverPrecioItem que usa
   * el checkout público (landing.service.js), para que el número que ve
   * el administrador nunca pueda divergir del que termina pagando el
   * cliente. No es una landing (el producto puede no estar publicado
   * todavía en ninguna), así que resuelve directo por producto_id en vez
   * de por content_id de un catálogo curado.
   *
   * @param {number} producto_id
   * @param {number} inquilino_id
   * @param {{cantidad:number, variante_id?:number, oferta_id?:number}} opciones
   */
  static async simularPrecio(producto_id, inquilino_id, { cantidad, variante_id, oferta_id } = {}) {
    const producto = await Producto.findOne({ where: { id: producto_id, inquilino_id } });
    if (!producto) throw new Error('Producto no encontrado.');

    const [variantesDelProducto, ofertasDelProducto] = await Promise.all([
      ProductoVariante.findAll({ where: { producto_id, activo: true } }),
      Oferta.findAll({
        where: { producto_ancla_id: producto_id, activo: true },
        include: [{ model: OfertaComponente, as: 'componentes' }],
      }),
    ]);

    const resuelto = PricingService.resolverPrecioItem({
      entidad: producto,
      esCombo: false,
      cantidad,
      ofertaId: oferta_id || null,
      varianteId: variante_id || null,
      precioUsuario: undefined, // el simulador del admin ve el precio de lista, no el de un revendedor puntual
      ofertasDelProducto,
      variantesDelProducto,
    });

    return {
      precio_lista: resuelto.precio_lista,
      precio_unitario: resuelto.precio_unitario,
      subtotal: resuelto.subtotal,
      cantidad: resuelto.cantidad,
      oferta_aplicada: resuelto.oferta_aplicada
        ? { id: resuelto.oferta_aplicada.id, nombre: resuelto.oferta_aplicada.nombre, tipo_contenido: resuelto.oferta_aplicada.tipo_contenido }
        : null,
      oferta_auto_aplicada: resuelto.oferta_auto_aplicada,
      variante_aplicada: resuelto.variante_aplicada
        ? { id: resuelto.variante_aplicada.id, nombre: resuelto.variante_aplicada.nombre }
        : null,
    };
  }

  /**
   * SKU obligatorio y único por inquilino. Es la clave con la que se
   * identifican los productos en la importación masiva de precios (Excel de
   * Mi catálogo) y en la carga desde la API del proveedor, así que:
   *   - se guarda sin espacios alrededor;
   *   - la unicidad se controla SIN distinguir mayúsculas: el índice de la
   *     base (sku, inquilino_id) sí distingue, y dejaría convivir "ws-1" con
   *     "WS-1", que para la importación serían el mismo SKU.
   * Devuelve el SKU normalizado.
   */
  static async validarSku(sku, inquilino_id, excluirId = null, transaction) {
    const limpio = typeof sku === 'string' ? sku.trim() : (sku == null ? '' : String(sku).trim());
    if (!limpio) throw new Error('El SKU es obligatorio.');
    if (limpio.length > 100) throw new Error('El SKU no puede superar los 100 caracteres.');

    const where = {
      inquilino_id,
      [Op.and]: [sequelize.where(sequelize.fn('upper', sequelize.fn('trim', sequelize.col('sku'))), limpio.toUpperCase())],
    };
    if (excluirId) where.id = { [Op.ne]: excluirId };
    const existente = await Producto.findOne({ where, attributes: ['id', 'nombre'], transaction });
    if (existente) throw new Error(`El SKU "${limpio}" ya está usado en el producto "${existente.nombre}".`);
    return limpio;
  }

  static async crear(datos, inquilino_id, usuario_id, esAdmin, transaction) {
    const precioAncla = datos.precio_ancla !== undefined ? datos.precio_ancla : datos.precio_tachado;
    const {
      nombre, sku, categoria_id, marca_id, proveedor_id, tags,
      descripcion_corta, descripcion_larga, faq_titulo,
      precio_costo, precio_minimo, precio_base, precio_dolar, es_dolar,
      descuento_porcentaje, descuento_inicio, descuento_fin, impuestos_incluidos,
      cantidad_disponible, stock_minimo, stock_salon, stock_deposito, stock_minimo_salon, unidad_medida,
      activo, estado_venta, destacado, fecha_disponible_desde, fecha_disponible_hasta,
      slug: slugManual, meta_titulo, meta_descripcion,
      propuesta_valor, beneficios, confianza, preguntas_frecuentes, sobre_este_producto,
      ficha_rubro, ficha_datos,
    } = datos;

    const precioBaseNum = parseFloat(precio_base);
    if (!nombre || isNaN(precioBaseNum)) {
      throw new Error('Nombre y precio_base son requeridos.');
    }

    const skuValido = await this.validarSku(sku, inquilino_id, null, transaction);
    const slug = slugManual ? slugManual : await this.generarSlugUnico(nombre, inquilino_id);

    const producto = await Producto.create({
      inquilino_id, nombre,
      sku: skuValido,
      categoria_id: categoria_id || null,
      marca_id: marca_id || null,
      proveedor_id: proveedor_id || null,
      tags: tags || [],
      descripcion_corta, descripcion_larga, faq_titulo: faq_titulo || null,
      propuesta_valor, beneficios, confianza, preguntas_frecuentes, sobre_este_producto,
      // Rubro de ficha y sus campos propios. `ficha_datos` nunca es null:
      // la columna es NOT NULL DEFAULT '{}' y el frontend espera un objeto.
      ficha_rubro: ficha_rubro || null,
      ficha_datos: ficha_datos || {},
      precio_costo: precio_costo ? parseFloat(precio_costo) : null,
      precio_dolar: precio_dolar ? parseFloat(precio_dolar) : null,
      es_dolar: !!es_dolar,
      precio_minimo: esAdmin && precio_minimo ? parseFloat(precio_minimo) : null,
      precio_base: precioBaseNum,
      precio_tachado: precioAncla ? parseFloat(precioAncla) : null,
      descuento_porcentaje: parseFloat(descuento_porcentaje) || 0,
      descuento_inicio: descuento_inicio || null,
      descuento_fin: descuento_fin || null,
      impuestos_incluidos: impuestos_incluidos !== false,
      // El total NO se carga a mano: es la suma del desglose, igual que en
      // las variantes. Si el formulario todavía manda solo el total (o es un
      // alta vieja), ese número se toma como stock de salón.
      ...this.normalizarStock({ cantidad_disponible, stock_salon, stock_deposito }),
      stock_minimo: parseInt(stock_minimo) || 0,
      stock_minimo_salon: stock_minimo_salon === '' || stock_minimo_salon == null ? null : parseInt(stock_minimo_salon),
      unidad_medida: unidad_medida || 'unidad',
      activo: activo !== false,
      estado_venta: estado_venta || 'en_venta',
      destacado: destacado || false,
      fecha_disponible_desde: fecha_disponible_desde || null,
      fecha_disponible_hasta: fecha_disponible_hasta || null,
      slug, meta_titulo, meta_descripcion,
      creado_por: usuario_id,
      modificado_por: usuario_id,
    }, { transaction });

    return this.serializar(producto, esAdmin, usuario_id);
  }

  /**
   * Resuelve el desglose de stock y el total a partir de lo que mande el
   * formulario. Mismo criterio que productoVariante.service.normalizarStock:
   * el total es SIEMPRE salón + depósito, y si no viene desglose (formulario
   * viejo, importación, alta por API) ese total se toma como stock de salón.
   */
  static normalizarStock({ cantidad_disponible, stock_salon, stock_deposito }) {
    const traeDesglose = stock_salon !== undefined || stock_deposito !== undefined;
    const salon = Math.max(0, parseInt(traeDesglose ? stock_salon : cantidad_disponible, 10) || 0);
    const deposito = Math.max(0, parseInt(stock_deposito, 10) || 0);
    return {
      stock_salon: salon,
      stock_deposito: deposito,
      cantidad_disponible: salon + deposito,
    };
  }

  static async actualizar(id, campos, inquilino_id, usuario_id, esAdmin, transaction) {

    if (campos.precio_ancla !== undefined && campos.precio_tachado === undefined) {
      campos.precio_tachado = campos.precio_ancla;
    }

    const producto = await Producto.findOne({ where: { id, inquilino_id }, transaction });
    if (!producto) throw new Error('Producto no encontrado.');

    if (!esAdmin && producto.creado_por !== usuario_id) {
      throw new Error('No tienes permiso para modificar un producto que no creaste.');
    }

    // Productos viejos sin SKU se pueden seguir editando sin cargarlo; lo que
    // no se permite es borrar un SKU que ya existe ni duplicar uno.
    if (campos.sku !== undefined) {
      const skuEnviado = campos.sku == null ? '' : String(campos.sku).trim();
      if (!skuEnviado && !producto.sku) {
        delete campos.sku;
      } else {
        campos.sku = await this.validarSku(skuEnviado, inquilino_id, producto.id, transaction);
      }
    }

    // Cualquier toque al stock recalcula el total desde el desglose, para que
    // cantidad_disponible nunca diga algo distinto a salón + depósito.
    // Los valores actuales del producto son la base: si el formulario manda
    // solo uno de los dos campos, el otro tiene que quedar como estaba y no
    // borrarse por venir `undefined`.
    if (campos.stock_salon !== undefined || campos.stock_deposito !== undefined) {
      Object.assign(campos, this.normalizarStock({
        stock_salon: campos.stock_salon !== undefined ? campos.stock_salon : producto.stock_salon,
        stock_deposito: campos.stock_deposito !== undefined ? campos.stock_deposito : producto.stock_deposito,
      }));
    }

    const precio_base_nuevo = campos.precio_base !== undefined ? parseFloat(campos.precio_base) : parseFloat(producto.precio_base);
    const descuento_nuevo = campos.descuento_porcentaje !== undefined ? parseFloat(campos.descuento_porcentaje) : parseFloat(producto.descuento_porcentaje);
    const descuento_inicio_nuevo = campos.descuento_inicio !== undefined ? campos.descuento_inicio : producto.descuento_inicio;
    const descuento_fin_nuevo = campos.descuento_fin !== undefined ? campos.descuento_fin : producto.descuento_fin;
    const precio_minimo_nuevo = campos.precio_minimo !== undefined ? parseFloat(campos.precio_minimo) : parseFloat(producto.precio_minimo);

    // Si el update no toca ningún campo de precio, no hay nada nuevo que
    // validar contra el mínimo — el estado ya guardado se asume válido de
    // cuando se guardó. Evita una consulta de variantes en el caso común
    // (activar/desactivar, editar descripción, cambiar stock, etc.).
    const tocaPrecio = ['precio_base', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'precio_minimo']
      .some(campo => campos[campo] !== undefined);

    if (tocaPrecio) {
      const variantesActuales = await ProductoVariante.findAll({ where: { producto_id: id, activo: true }, transaction });
      const { valido, errores } = validarPrecioMinimo({
        precio_base: precio_base_nuevo,
        descuento_porcentaje: descuento_nuevo,
        descuento_inicio: descuento_inicio_nuevo,
        descuento_fin: descuento_fin_nuevo,
        precio_minimo: precio_minimo_nuevo,
        variantes: variantesActuales,
      });

      if (!valido) {
        const err = new Error('Validación de precio mínimo fallida.');
        err.errores = errores;
        throw err;
      }
    }

    const precioBaseAnterior = parseFloat(producto.precio_base);
    const descuentoAnterior = parseFloat(producto.descuento_porcentaje) || 0;
    const cambioPrecio = precio_base_nuevo !== precioBaseAnterior || descuento_nuevo !== descuentoAnterior;

    if (cambioPrecio) {
      await HistorialPrecio.create({
        inquilino_id,
        producto_id: id,
        usuario_id,
        precio_base_anterior: precioBaseAnterior,
        precio_base_nuevo,
        descuento_anterior: descuentoAnterior,
        descuento_nuevo,
        precio_efectivo_anterior: calcularPrecioEfectivo(
          precioBaseAnterior, descuentoAnterior,
          producto.descuento_inicio, producto.descuento_fin
        ),
        precio_efectivo_nuevo: calcularPrecioEfectivo(
          precio_base_nuevo, descuento_nuevo,
          descuento_inicio_nuevo, descuento_fin_nuevo
        ),
        fecha_cambio: new Date(),
      }, { transaction });
    }

    const camposPermitidos = [
      'nombre', 'sku', 'categoria_id', 'marca_id', 'proveedor_id', 'tags',
      'descripcion_corta', 'descripcion_larga', 'faq_titulo', 'relacionados_titulo',
      'precio_costo', 'precio_dolar', 'es_dolar', 'precio_base', 'precio_tachado', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'impuestos_incluidos',
      'cantidad_disponible', 'stock_minimo', 'stock_salon', 'stock_deposito', 'stock_minimo_salon',
      'unidad_medida', 'activo', 'estado_venta', 'destacado',
      'fecha_disponible_desde', 'fecha_disponible_hasta',
      'meta_titulo', 'meta_descripcion', 'peso', 'dimensiones', 'tipo_producto',
      'propuesta_valor', 'beneficios', 'confianza', 'preguntas_frecuentes', 'sobre_este_producto',
      'ficha_rubro', 'ficha_datos',
    ];
    // precio_minimo: piso de precio — solo el admin puede fijarlo, incluso
    // sobre productos que no creó (ver serializar()).
    if (esAdmin) camposPermitidos.push('precio_minimo');

    for (const campo of camposPermitidos) {
      if (campos[campo] !== undefined) producto[campo] = campos[campo];
    }

    if (campos.nombre && campos.nombre !== producto.nombre) {
      producto.slug = campos.slug || await this.generarSlugUnico(campos.nombre, inquilino_id, id);
    } else if (campos.slug) {
      producto.slug = campos.slug;
    }

    producto.modificado_por = usuario_id;
    await producto.save({ transaction });

    return this.serializar(producto, esAdmin, usuario_id);
  }

  /** FAQ propia del producto ("Todo lo que necesitas saber") — ver ProductoFaq.js. */
  static async listarFaq(id, inquilino_id) {
    const producto = await Producto.findOne({ where: { id, inquilino_id }, attributes: ['id'] });
    if (!producto) throw new Error('Producto no encontrado.');
    return ProductoFaq.findAll({ where: { producto_id: id }, order: [['orden', 'ASC']] });
  }

  static async sincronizarFaq(id, inquilino_id, faq = [], transaction) {
    const producto = await Producto.findOne({ where: { id, inquilino_id }, attributes: ['id'], transaction });
    if (!producto) throw new Error('Producto no encontrado.');
    await ProductoFaq.destroy({ where: { producto_id: id }, transaction });
    if (!faq.length) return;
    await ProductoFaq.bulkCreate(faq.map((f, idx) => ({
      producto_id: id,
      pregunta: f.pregunta.trim(),
      respuesta: f.respuesta.trim(),
      orden: f.orden !== undefined ? Number(f.orden) : idx,
    })), { transaction });
  }

  /**
   * "Productos relacionados" de la página pública de un producto — usa la
   * curación manual (tabla productos_relacionados) si el comercio eligió
   * algo; si no, cae en automático: productos con la misma categoria_id
   * (el mismo tag que ya se arma "a la hora de crear productos", ver
   * ProductForm.jsx), excluyendo el propio producto. Esta tabla ya existía
   * (se llenaba al crear un producto) pero nunca se leía en ningún lado —
   * acá es donde finalmente se resuelve.
   */
  /**
   * @param {object} [opciones]
   * @param {number[]|null} [opciones.idsForzados] - relacionados elegidos en
   *   UNA landing concreta (Landing.content.productos[].relacionados). Si
   *   vienen, mandan sobre la curación global del producto y sobre el relleno
   *   automático por categoría: son de esa landing, no del producto.
   * @param {string|null} [opciones.titulo] - título propio de esa landing.
   */
  static async listarRelacionados(id, inquilino_id, { idsForzados = null, titulo = null } = {}) {
    const { ProductoRelacionado, ProductoImagen } = require('../models');
    const producto = await Producto.findOne({
      where: { id, inquilino_id },
      attributes: ['id', 'categoria_id', 'relacionados_titulo'],
    });
    if (!producto) throw new Error('Producto no encontrado.');

    const manuales = await ProductoRelacionado.findAll({
      where: { producto_id: id },
      order: [['orden', 'ASC']],
    });

    let ids = manuales.map(m => m.producto_relacionado_id);
    let automatico = false;

    // La elección de la landing gana: es una curación explícita del comercio
    // para esa página, no un default que haya que completar.
    if (Array.isArray(idsForzados)) {
      ids = idsForzados.map(Number).filter(Boolean);
    } else if (!ids.length && producto.categoria_id) {
      automatico = true;
      const porCategoria = await Producto.findAll({
        where: {
          inquilino_id, categoria_id: producto.categoria_id, activo: true,
          estado_venta: 'en_venta', id: { [Op.ne]: id },
        },
        attributes: ['id'],
        order: [['created_at', 'DESC']],
        limit: 8,
      });
      ids = porCategoria.map(p => p.id);
    }

    const tituloFinal = titulo || producto.relacionados_titulo || null;
    if (!ids.length) return { titulo: tituloFinal, automatico: false, items: [] };

    const [productos, imagenes] = await Promise.all([
      Producto.findAll({
        where: { id: { [Op.in]: ids }, inquilino_id, activo: true },
        attributes: ['id', 'slug', 'nombre', 'precio_base', 'precio_tachado', 'cantidad_disponible'],
      }),
      ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: ids } },
        attributes: ['producto_id', 'url', 'es_principal', 'variante_id'],
        order: [['es_principal', 'DESC'], ['created_at', 'ASC']],
      }),
    ]);

    // Galería completa además de la principal: las tarjetas de relacionados
    // van pasando de una foto a la otra al pasar el mouse por encima (ver
    // ImagenProductoHover). Se usan las imágenes generales del producto y,
    // si TODAS están atadas a una variante, se usan igual — mismo criterio
    // que landing.service.obtenerPublica.
    const mapaGaleria = new Map();
    ids.forEach(pid => {
      const propias = imagenes.filter(img => img.producto_id === pid);
      if (!propias.length) return;
      const generales = propias.filter(img => !img.variante_id);
      mapaGaleria.set(pid, (generales.length ? generales : propias).map(img => img.url));
    });
    const mapaImagen = new Map([...mapaGaleria].map(([pid, urls]) => [pid, urls[0]]));
    const mapaProducto = new Map(productos.map(p => [p.id, p]));

    // Se preserva el orden de `ids` (manual, o más reciente primero si es
    // automático) — no el orden en que Postgres devolvió el findAll.
    const items = ids.map(pid => mapaProducto.get(pid)).filter(Boolean).map(p => ({
      id: p.id,
      slug: p.slug,
      nombre: p.nombre,
      precio: parseFloat(p.precio_base),
      precio_tachado: p.precio_tachado ? parseFloat(p.precio_tachado) : null,
      imagen: mapaImagen.get(p.id) || null,
      imagenes: mapaGaleria.get(p.id) || [],
      stock: p.cantidad_disponible,
    }));

    return { titulo: tituloFinal, automatico, items };
  }

  /** Curación manual — reemplaza la lista completa (destroy-all + bulkCreate), mismo criterio que sincronizarFaq. */
  static async sincronizarRelacionados(id, inquilino_id, relacionadoIds = [], transaction) {
    const { ProductoRelacionado } = require('../models');
    const producto = await Producto.findOne({ where: { id, inquilino_id }, attributes: ['id'], transaction });
    if (!producto) throw new Error('Producto no encontrado.');
    await ProductoRelacionado.destroy({ where: { producto_id: id }, transaction });
    const idsLimpios = [...new Set(relacionadoIds.map(Number))].filter(rid => rid && rid !== Number(id));
    if (!idsLimpios.length) return;
    await ProductoRelacionado.bulkCreate(idsLimpios.map((rid, idx) => ({
      inquilino_id,
      producto_id: id,
      producto_relacionado_id: rid,
      orden: idx,
    })), { transaction });
  }

  static async eliminar(id, inquilino_id, usuario_id, esAdmin = false) {
    const producto = await Producto.findOne({ where: { id, inquilino_id } });
    if (!producto) throw new Error('Producto no encontrado.');

    if (!esAdmin && producto.creado_por !== usuario_id) {
      throw new Error('No tienes permiso para dar de baja un producto que no creaste.');
    }

    producto.activo = false;
    producto.modificado_por = usuario_id;
    await producto.save();
    return true;
  }
}

module.exports = ProductoService;
