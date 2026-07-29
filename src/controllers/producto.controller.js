/**
 * Controller de Productos.
 *
 * POST /api/productos/buscar    → Listar con filtros dinámicos
 * POST /api/productos           → Crear producto completo
 * GET  /api/productos/:id       → Detalle
 * PUT  /api/productos/:id       → Actualizar
 * DELETE /api/productos/:id     → Soft-delete (activo = false, SIEMPRE)
 */
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const slugify = require('slugify');
const {
  sequelize, Producto, ProductoVariante, ProductoImagen,
  ProductoRelacionado, HistorialPrecio,
  Categoria, Marca,
} = require('../models');

const { calcularPrecioEfectivo, validarPrecioMinimo } = require('../utils/precio');
const { rollbackSeguro } = require('../utils/transaction');

const UPLOADS_PUBLIC = path.join(process.cwd(), 'public', 'uploads');
const UPLOADS_TMP    = path.join(process.cwd(), 'tmp', 'uploads');

// Asegurar que existan las carpetas
[UPLOADS_PUBLIC, UPLOADS_TMP].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Helper: slug único por inquilino ───────────────────────────────────────
async function generarSlugUnico(nombre, inquilino_id, excluirId = null) {
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

// ─── Helper: recalcular stock del padre desde variantes ─────────────────────
async function recalcularStockPadre(producto_id, transaction) {
  const variantes = await ProductoVariante.findAll({
    where: { producto_id, activo: true },
    transaction,
  });
  const total = variantes.reduce((acc, v) => acc + (parseInt(v.stock) || 0), 0);
  await Producto.update(
    { cantidad_disponible: total },
    { where: { id: producto_id }, transaction }
  );
  return total;
}

// ─── Helper: sincronizar variantes al editar un producto ────────────────────
// Crea las nuevas (sin id), actualiza las existentes (con id) y desactiva
// (soft-delete) las que ya no vienen en el payload. Filas sin nombre se
// ignoran (fila vacía dejada a medio llenar en el formulario).
async function sincronizarVariantes(producto_id, inquilino_id, variantesPayload, transaction) {
  const actuales = await ProductoVariante.findAll({
    where: { producto_id, activo: true },
    transaction,
  });
  const mapaActuales = new Map(actuales.map(v => [v.id, v]));
  const idsConservados = new Set();

  for (const v of variantesPayload) {
    const nombre = (v.nombre || '').trim();
    if (!nombre) continue;

    const datos = {
      nombre,
      sku_variante: v.sku_variante || null,
      stock: parseInt(v.stock) || 0,
      precio_diferencial: v.precio_diferencial ? parseFloat(v.precio_diferencial) : 0,
    };

    const idExistente = v.id ? Number(v.id) : null;
    if (idExistente && mapaActuales.has(idExistente)) {
      idsConservados.add(idExistente);
      await mapaActuales.get(idExistente).update(datos, { transaction });
    } else {
      const nueva = await ProductoVariante.create(
        { inquilino_id, producto_id, ...datos },
        { transaction }
      );
      idsConservados.add(nueva.id);
    }
  }

  for (const actual of actuales) {
    if (!idsConservados.has(actual.id)) {
      await actual.update({ activo: false }, { transaction });
    }
  }
}

// ─── Serializer: filtra precio_costo según rol ───────────────────────────────
function serializar(producto, esAdmin = false) {
  const data = producto.toJSON ? producto.toJSON() : { ...producto };
  if (!esAdmin) delete data.precio_costo;
  return data;
}

// ─── POST /api/productos/buscar ──────────────────────────────────────────────
async function buscar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const esAdmin = req.usuario.rol === 'administrador';
    const {
      texto, categoria_id, marca_id, activo, destacado,
      precio_min, precio_max, stock_bajo, page = 1, limit = 10,
    } = req.body;


    const where = { inquilino_id };
    if (activo !== undefined) where.activo = activo;
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
    const { rows: productos, count } = await Producto.findAndCountAll({
      where,
      // Listado liviano: solo las columnas que consumen ProductList.jsx y los
      // buscadores de producto de ComboEditor.jsx/ComboModal.jsx. El detalle
      // completo (descripciones, variantes, combos, historial...) se pide
      // aparte en GET /api/productos/:id cuando hace falta.
      attributes: [
        'id', 'nombre', 'sku', 'precio_base', 'precio_costo',
        'cantidad_disponible', 'stock_minimo',
        'estado_venta', 'activo', 'destacado', 'categoria_id',
      ],
      // Con `attributes` restringido, Sequelize no resuelve bien el ORDER BY
      // sobre una columna fuera de esa lista cuando hay includes hasMany
      // paginados (arma una subquery que la pierde). subQuery:false lo evita;
      // distinct:true evita que el LEFT JOIN con imagenes infle el conteo.
      subQuery: false,
      distinct: true,
      include: [
        { model: Categoria, as: 'categoria', attributes: ['id', 'nombre', 'slug'] },
        { model: Marca, attributes: ['id', 'nombre', 'slug'] },
        { model: ProductoImagen, as: 'imagenes', where: { es_principal: true }, required: false, attributes: ['url', 'orden'] },
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    return res.json({
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / limit),
      productos: productos.map(p => serializar(p, esAdmin)),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al buscar productos.' });
  }
}

// ─── POST /api/productos ─────────────────────────────────────────────────────
async function crear(req, res) {
  const t = await sequelize.transaction();
  const archivosTemp = [];

  try {
    const inquilino_id = req.usuario.tenantId;
    const usuario_id = req.usuario.id;
    const esAdmin = req.usuario.rol === 'administrador';

    const {
      nombre, categoria_id, tags,
      descripcion_corta, descripcion_larga,
      precio_costo, precio_minimo, precio_base,
      descuento_porcentaje, descuento_inicio, descuento_fin, impuestos_incluidos,
      cantidad_disponible, stock_minimo, unidad_medida,
      activo, estado_venta, destacado, fecha_disponible_desde, fecha_disponible_hasta,
      slug: slugManual, meta_titulo, meta_descripcion,
      variantes = [], combos = [], relacionados = [],
    } = req.body;

    const precioBaseNum = parseFloat(precio_base);
    if (!nombre || isNaN(precioBaseNum)) {
      await rollbackSeguro(t);
      return res.status(400).json({ message: 'Nombre y precio_base son requeridos.' });
    }

    // Validar precio mínimo (producto + variantes)
    const { valido, errores } = validarPrecioMinimo({
      precio_base, descuento_porcentaje, descuento_inicio, descuento_fin,
      precio_minimo, variantes,
    });
    if (!valido) {
      await rollbackSeguro(t);
      return res.status(422).json({ message: 'Validación de precio mínimo fallida.', errores });
    }

    const slug = slugManual
      ? slugManual
      : await generarSlugUnico(nombre, inquilino_id);

    const producto = await Producto.create({
      inquilino_id, nombre,
      categoria_id: categoria_id || null,
      tags: tags || [],
      descripcion_corta, descripcion_larga,
      precio_costo: esAdmin && precio_costo ? parseFloat(precio_costo) : null,
      precio_minimo: precio_minimo ? parseFloat(precio_minimo) : null,
      precio_base: precioBaseNum,
      descuento_porcentaje: parseFloat(descuento_porcentaje) || 0,
      descuento_inicio: descuento_inicio || null,
      descuento_fin: descuento_fin || null,
      impuestos_incluidos: impuestos_incluidos !== false,
      cantidad_disponible: variantes.length > 0 ? 0 : (parseInt(cantidad_disponible) || 0),
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
    }, { transaction: t });

    // Crear variantes
    if (variantes.length > 0) {
      await ProductoVariante.bulkCreate(
        variantes.map(v => ({ ...v, inquilino_id, producto_id: producto.id })),
        { transaction: t }
      );
      await recalcularStockPadre(producto.id, t);
    }



    // Crear relaciones
    if (relacionados.length > 0) {
      await ProductoRelacionado.bulkCreate(
        relacionados.map(r => ({ inquilino_id, producto_id: producto.id, producto_relacionado_id: r })),
        { transaction: t, ignoreDuplicates: true }
      );
    }

    await t.commit();

    // Mover archivos temporales a destino final (post-commit)
    for (const { tmpPath, finalPath } of archivosTemp) {
      if (fs.existsSync(tmpPath)) fs.renameSync(tmpPath, finalPath);
    }

    // El frontend solo usa el `id` de esta respuesta (para asociarle las
    // imágenes en cola) — no hace falta re-consultar con combos/variantes/
    // imagenes (un producto recién creado nunca puede tener combos todavía).
    return res.status(201).json(serializar(producto, esAdmin));
  } catch (err) {
    await rollbackSeguro(t);
    for (const { tmpPath } of archivosTemp) {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
    console.error('[crear producto]', err);
    // Errores de validación de Sequelize: enviar detalle al cliente
    if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
      const mensajes = err.errors?.map(e => e.message) || [err.message];
      return res.status(422).json({ message: 'Error de validación.', errores: mensajes });
    }
    return res.status(500).json({ message: err.message || 'Error al crear producto.' });
  }
}

// ─── GET /api/productos/:id ──────────────────────────────────────────────────
// Detalle liviano para EDITAR el producto (ProductForm.jsx). Solo trae lo que
// ese formulario realmente consume: campos propios + variantes + imágenes.
// `categoria_id`/`marca_id` ya están en el producto — no hace falta el JOIN
// completo a Categoria/Marca solo para reponer un <select>.
//
// Todo lo demás vive en su propio endpoint, para pedirlo solo cuando hace
// falta en vez de siempre:
//   - combos       → GET /productos/:id/combos      (ya existía, ComboService)
//   - historial de precios → GET /productos/:id/historial-precios
// `relaciones`, `Creador` y `Modificador` se sacaron del payload por completo:
// ninguna pantalla del frontend los usa hoy. Si en el futuro hace falta
// mostrar auditoría o productos relacionados, se agregan como su propio
// endpoint liviano, no reincorporados acá.
async function detalle(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;
    const esAdmin = req.usuario.rol === 'administrador';

    const producto = await Producto.findOne({
      where: { id, inquilino_id },
      include: [
        { model: ProductoVariante, as: 'variantes' },
        { model: ProductoImagen, as: 'imagenes', order: [['orden', 'ASC']] },
      ],
    });

    if (!producto) return res.status(404).json({ message: 'Producto no encontrado.' });

    return res.json(serializar(producto, esAdmin));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener producto.' });
  }
}

// ─── GET /api/productos/:id/historial-precios ────────────────────────────────
async function historialPrecios(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;

    const producto = await Producto.findOne({ where: { id, inquilino_id }, attributes: ['id'] });
    if (!producto) return res.status(404).json({ message: 'Producto no encontrado.' });

    const historial = await HistorialPrecio.findAll({
      where: { producto_id: id },
      order: [['fecha_cambio', 'DESC']],
      limit: 20,
    });

    return res.json(historial);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener el historial de precios.' });
  }
}

// ─── PUT /api/productos/:id ──────────────────────────────────────────────────
async function actualizar(req, res) {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;
    const usuario_id = req.usuario.id;
    const esAdmin = req.usuario.rol === 'administrador';

    const producto = await Producto.findOne({ where: { id, inquilino_id }, transaction: t });
    if (!producto) {
      await rollbackSeguro(t);
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    const campos = req.body;
    const precio_base_nuevo = campos.precio_base !== undefined ? parseFloat(campos.precio_base) : parseFloat(producto.precio_base);
    const descuento_nuevo = campos.descuento_porcentaje !== undefined ? parseFloat(campos.descuento_porcentaje) : parseFloat(producto.descuento_porcentaje);
    const descuento_inicio_nuevo = campos.descuento_inicio !== undefined ? campos.descuento_inicio : producto.descuento_inicio;
    const descuento_fin_nuevo = campos.descuento_fin !== undefined ? campos.descuento_fin : producto.descuento_fin;
    const precio_minimo_nuevo = campos.precio_minimo !== undefined ? parseFloat(campos.precio_minimo) : parseFloat(producto.precio_minimo);

    // Validar precio mínimo con los nuevos valores
    const variantesActuales = await ProductoVariante.findAll({ where: { producto_id: id, activo: true }, transaction: t });
    const { valido, errores } = validarPrecioMinimo({
      precio_base: precio_base_nuevo,
      descuento_porcentaje: descuento_nuevo,
      descuento_inicio: descuento_inicio_nuevo,
      descuento_fin: descuento_fin_nuevo,
      precio_minimo: precio_minimo_nuevo,
      variantes: variantesActuales,
    });
    if (!valido) {
      await rollbackSeguro(t);
      return res.status(422).json({ message: 'Validación de precio mínimo fallida.', errores });
    }

    // Detectar cambio de precio → registrar historial
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
      }, { transaction: t });
    }

    // Actualizar campos del producto
    const camposPermitidos = [
      'nombre', 'sku', 'categoria_id', 'marca_id', 'tags',
      'descripcion_corta', 'descripcion_larga',
      'precio_minimo', 'precio_base', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'impuestos_incluidos',
      'cantidad_disponible', 'stock_minimo', 'unidad_medida', 'activo', 'destacado',
      'fecha_disponible_desde', 'fecha_disponible_hasta',
      'meta_titulo', 'meta_descripcion', 'peso', 'dimensiones', 'tipo_producto',
    ];
    if (esAdmin) camposPermitidos.push('precio_costo');

    for (const campo of camposPermitidos) {
      if (campos[campo] !== undefined) producto[campo] = campos[campo];
    }

    // Actualizar slug si cambió el nombre y no se pasó slug manual
    if (campos.nombre && campos.nombre !== producto.nombre) {
      producto.slug = campos.slug || await generarSlugUnico(campos.nombre, inquilino_id, id);
    } else if (campos.slug) {
      producto.slug = campos.slug;
    }

    producto.modificado_por = usuario_id;
    await producto.save({ transaction: t });

    // Sincronizar variantes (crear/actualizar/desactivar) si el payload las trae.
    // `campos.variantes` puede venir como [] explícito para "sin variantes" —
    // eso también debe desactivar las que hubiera.
    if (campos.variantes !== undefined) {
      await sincronizarVariantes(id, inquilino_id, campos.variantes, t);
    }

    // Si el producto tiene variantes activas, su stock SIEMPRE se deriva de
    // ellas — pisa cualquier cantidad_disponible que se haya mandado suelta.
    const tieneVariantes = await ProductoVariante.count({ where: { producto_id: id, activo: true }, transaction: t });
    if (tieneVariantes > 0) await recalcularStockPadre(id, t);



    await t.commit();

    // El frontend (ProductForm.jsx) ni siquiera lee la respuesta de este
    // endpoint — navega directo al listado. Antes se hacía un re-fetch con
    // combos + variantes + imagenes solo para descartarlo. Si algún consumidor
    // futuro necesita el producto actualizado completo, que pida GET /:id
    // (que ya trae variantes/imagenes) en vez de duplicar el join acá.
    return res.json(serializar(producto, esAdmin));
  } catch (err) {
    await rollbackSeguro(t);
    console.error(err);
    return res.status(500).json({ message: 'Error al actualizar producto.' });
  }
}

// ─── DELETE /api/productos/:id ───────────────────────────────────────────────
async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;

    const producto = await Producto.findOne({ where: { id, inquilino_id } });
    if (!producto) return res.status(404).json({ message: 'Producto no encontrado.' });

    // Soft-delete siempre. Sin excepciones.
    producto.activo = false;
    producto.modificado_por = req.usuario.id;
    await producto.save();

    return res.json({ message: 'Producto dado de baja correctamente.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al dar de baja el producto.' });
  }
}

module.exports = { buscar, crear, detalle, historialPrecios, actualizar, eliminar };
