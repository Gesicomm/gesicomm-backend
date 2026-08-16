'use strict';

const { Op } = require('sequelize');
const slugify = require('slugify');
const { sequelize, Producto, HistorialPrecio, ProductoVariante, Oferta, OfertaComponente } = require('../models');
const { calcularPrecioEfectivo, validarPrecioMinimo } = require('../utils/precio');
const PricingService = require('./pricing.service');

class ProductoService {
  
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

    const total = variantes.reduce((acc, v) => acc + (parseInt(v.stock) || 0), 0);
    await Producto.update(
      { cantidad_disponible: total },
      { where: { id: producto_id }, transaction }
    );
    return total;
  }

  static serializar(producto, esAdmin = false) {
    const data = producto.toJSON ? producto.toJSON() : { ...producto };
    if (!esAdmin) delete data.precio_costo;
    return data;
  }

  static async buscar(filtros, inquilino_id, esAdmin) {
    const {
      texto, categoria_id, marca_id, activo, destacado,
      precio_min, precio_max, stock_bajo, page = 1, limit = 10,
      creado_por
    } = filtros;

    const where = { inquilino_id };
    if (activo !== undefined) where.activo = activo;
    if (creado_por !== undefined) where.creado_por = creado_por;
    if (destacado !== undefined) where.destacado = destacado;
    if (categoria_id) where.categoria_id = categoria_id;
    if (marca_id) where.marca_id = marca_id;
    if (precio_min !== undefined) where.precio_base = { ...where.precio_base, [Op.gte]: precio_min };
    if (precio_max !== undefined) where.precio_base = { ...where.precio_base, [Op.lte]: precio_max };
    if (stock_bajo) where.cantidad_disponible = { [Op.lte]: sequelize.col('stock_minimo') };
    if (texto) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${texto}%` } },
        { sku: { [Op.iLike]: `%${texto}%` } },
        { descripcion_corta: { [Op.iLike]: `%${texto}%` } },
      ];
    }

    const offset = (page - 1) * limit;

    // Sin eager loading (include), consulta directa
    const { rows: productos, count } = await Producto.findAndCountAll({
      where,
      attributes: [
        'id', 'nombre', 'sku', 'precio_base', 'precio_costo',
        'cantidad_disponible', 'stock_minimo',
        'estado_venta', 'activo', 'destacado', 'categoria_id', 'marca_id', 'creado_por'
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    const productosSerializados = productos.map(p => this.serializar(p, esAdmin));

    if (productosSerializados.length > 0) {
      const { ProductoImagen } = require('../models');
      const productIds = productosSerializados.map(p => p.id);
      const imagenes = await ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: productIds } },
        attributes: ['producto_id', 'url', 'es_principal'],
        order: [['es_principal', 'DESC'], ['created_at', 'ASC']]
      });
      const imgMap = new Map();
      // As they are ordered by es_principal DESC, the first one encountered per product will be the principal or the oldest one
      imagenes.forEach(img => {
        if (!imgMap.has(img.producto_id)) {
          imgMap.set(img.producto_id, img.url);
        }
      });
      
      productosSerializados.forEach(p => {
        p.imagenes = imgMap.has(p.id) ? [{ url: imgMap.get(p.id) }] : [];
      });
    }

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / limit),
      productos: productosSerializados,
    };
  }

  static async detalle(id, inquilino_id, esAdmin) {
    const producto = await Producto.findOne({
      where: { id, inquilino_id },
      // Sin includes, totalmente aislado
    });

    if (!producto) throw new Error('Producto no encontrado.');

    return this.serializar(producto, esAdmin);
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

  static async crear(datos, inquilino_id, usuario_id, esAdmin, transaction) {
    const {
      nombre, categoria_id, marca_id, tags,
      descripcion_corta, descripcion_larga,
      precio_costo, precio_minimo, precio_base, precio_tachado,
      descuento_porcentaje, descuento_inicio, descuento_fin, impuestos_incluidos,
      cantidad_disponible, stock_minimo, unidad_medida,
      activo, estado_venta, destacado, fecha_disponible_desde, fecha_disponible_hasta,
      slug: slugManual, meta_titulo, meta_descripcion,
    } = datos;

    const precioBaseNum = parseFloat(precio_base);
    if (!nombre || isNaN(precioBaseNum)) {
      throw new Error('Nombre y precio_base son requeridos.');
    }

    const slug = slugManual ? slugManual : await this.generarSlugUnico(nombre, inquilino_id);

    const producto = await Producto.create({
      inquilino_id, nombre,
      categoria_id: categoria_id || null,
      marca_id: marca_id || null,
      tags: tags || [],
      descripcion_corta, descripcion_larga,
      precio_costo: esAdmin && precio_costo ? parseFloat(precio_costo) : null,
      precio_minimo: precio_minimo ? parseFloat(precio_minimo) : null,
      precio_base: precioBaseNum,
      precio_tachado: precio_tachado ? parseFloat(precio_tachado) : null,
      descuento_porcentaje: parseFloat(descuento_porcentaje) || 0,
      descuento_inicio: descuento_inicio || null,
      descuento_fin: descuento_fin || null,
      impuestos_incluidos: impuestos_incluidos !== false,
      cantidad_disponible: parseInt(cantidad_disponible) || 0,
      stock_minimo: parseInt(stock_minimo) || 0,
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

    return this.serializar(producto, esAdmin);
  }

  static async actualizar(id, campos, inquilino_id, usuario_id, esAdmin, transaction) {
    const producto = await Producto.findOne({ where: { id, inquilino_id }, transaction });
    if (!producto) throw new Error('Producto no encontrado.');

    if (!esAdmin && producto.creado_por !== usuario_id) {
      throw new Error('No tienes permiso para modificar un producto que no creaste.');
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
      'nombre', 'sku', 'categoria_id', 'marca_id', 'tags',
      'descripcion_corta', 'descripcion_larga',
      'precio_minimo', 'precio_base', 'precio_tachado', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'impuestos_incluidos',
      'cantidad_disponible', 'stock_minimo', 'unidad_medida', 'activo', 'destacado',
      'fecha_disponible_desde', 'fecha_disponible_hasta',
      'meta_titulo', 'meta_descripcion', 'peso', 'dimensiones', 'tipo_producto',
    ];
    if (esAdmin) camposPermitidos.push('precio_costo');

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

    return this.serializar(producto, esAdmin);
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
