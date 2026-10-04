'use strict';

const { sequelize, PrecioUsuario } = require('../models');
const PrecioUsuarioService = require('./precioUsuario.service');
const ImagenService = require('./imagen.service');

const MAX_PRECIO = 9999999999;
const clave = item => `${item.tipo}:${item.id}`;
const numero = valor => valor == null ? null : Number(valor);

function errorValidacion(message, errores = []) {
  const error = new Error(message);
  error.status = 400;
  error.errores = errores.slice(0, 100);
  return error;
}

function normalizarItems(items) {
  if (!Array.isArray(items) || items.length > 50000) throw errorValidacion('La selección no es válida.');
  const vistos = new Set();
  return items.map(item => {
    if (!item || !['producto', 'combo'].includes(item.tipo) || !Number.isSafeInteger(item.id) || item.id <= 0) {
      throw errorValidacion('Cada fila debe tener un tipo y un ID numérico válidos.');
    }
    if (vistos.has(clave(item))) throw errorValidacion('La selección contiene filas repetidas.');
    vistos.add(clave(item));
    return item;
  });
}

class PrecioUsuarioMasivoService {
  // Consulta plana: no se cargan imágenes ni relaciones por cada fila.
  static consulta(usuario_id, inquilino_id, esAdmin, filtros = {}, items = null) {
    if (!filtros || typeof filtros !== 'object' || Array.isArray(filtros)) throw errorValidacion('Los filtros no son válidos.');
    const replacements = { usuario_id, inquilino_id };
    const base = `
      SELECT 'producto' AS tipo, p.id, p.id AS producto_id, p.sku, p.nombre, p.creado_por, p.created_at,
        cat.nombre AS categoria, pr.nombre AS proveedor,
        CASE WHEN p.creado_por = :usuario_id AND p.precio_costo IS NOT NULL
          THEN p.precio_costo ELSE p.precio_base END AS costo,
        p.precio_base, p.precio_minimo, pu.precio AS precio_usuario,
        COALESCE(pu.precio, p.precio_base) AS precio_actual
      FROM productos p
      LEFT JOIN categorias cat ON cat.id = p.categoria_id AND cat.inquilino_id = :inquilino_id
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      LEFT JOIN precios_usuario pu ON pu.tipo = 'producto' AND pu.referencia_id = p.id
        AND pu.usuario_id = :usuario_id AND pu.inquilino_id = :inquilino_id
      WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
      ${PrecioUsuarioService.visibilidadCatalogoSql(esAdmin)}
      UNION ALL
      SELECT 'combo' AS tipo, c.id, c.producto_id, NULL AS sku, c.nombre, c.creado_por, c.created_at,
        cat.nombre AS categoria, pr.nombre AS proveedor, c.precio_total AS costo,
        c.precio_total AS precio_base, c.precio_minimo, pu.precio AS precio_usuario,
        COALESCE(pu.precio, c.precio_total) AS precio_actual
      FROM producto_combos c
      INNER JOIN productos p ON p.id = c.producto_id AND p.inquilino_id = :inquilino_id AND p.activo = true
      LEFT JOIN categorias cat ON cat.id = p.categoria_id AND cat.inquilino_id = :inquilino_id
      LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      LEFT JOIN precios_usuario pu ON pu.tipo = 'combo' AND pu.referencia_id = c.id
        AND pu.usuario_id = :usuario_id AND pu.inquilino_id = :inquilino_id
      WHERE c.inquilino_id = :inquilino_id AND c.estado = 'ACTIVO'
      ${PrecioUsuarioService.visibilidadComboSql(esAdmin)}
      ${PrecioUsuarioService.visibilidadCatalogoSql(esAdmin)}
    `;
    const condiciones = [];
    for (const campo of ['busqueda', 'categoria', 'proveedor', 'tipo', 'origen', 'orden']) {
      if (filtros[campo] != null && typeof filtros[campo] !== 'string') throw errorValidacion('Los filtros deben ser texto.');
    }
    const texto = filtros.busqueda?.trim();
    if (texto) {
      replacements.busqueda = `%${texto.replace(/[\\%_]/g, '\\$&')}%`;
      condiciones.push('(t.nombre ILIKE :busqueda OR t.sku ILIKE :busqueda)');
    }
    for (const campo of ['categoria', 'proveedor']) {
      if (filtros[campo]) {
        replacements[campo] = filtros[campo];
        condiciones.push(`t.${campo} = :${campo}`);
      }
    }
    if (filtros.tipo && filtros.tipo !== 'todos') {
      if (!['producto', 'combo'].includes(filtros.tipo)) throw errorValidacion('Tipo de producto inválido.');
      replacements.tipo = filtros.tipo;
      condiciones.push('t.tipo = :tipo');
    }
    if (filtros.origen && filtros.origen !== 'todos') {
      if (!['propios', 'gesicomm'].includes(filtros.origen)) throw errorValidacion('Origen inválido.');
      condiciones.push(filtros.origen === 'propios' ? 't.creado_por = :usuario_id' : 't.creado_por IS DISTINCT FROM :usuario_id');
    }
    if (items !== null) {
      const productos = items.filter(i => i.tipo === 'producto').map(i => i.id);
      const combos = items.filter(i => i.tipo === 'combo').map(i => i.id);
      const seleccion = [];
      if (productos.length) { replacements.productos = productos; seleccion.push("(t.tipo = 'producto' AND t.id IN (:productos))"); }
      if (combos.length) { replacements.combos = combos; seleccion.push("(t.tipo = 'combo' AND t.id IN (:combos))"); }
      condiciones.push(seleccion.length ? `(${seleccion.join(' OR ')})` : 'false');
    }
    return { base, sql: `SELECT * FROM (${base}) t${condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : ''}`, replacements };
  }

  static fila(f) {
    return {
      tipo: f.tipo, id: Number(f.id), sku: f.sku, nombre: f.nombre,
      categoria: f.categoria, proveedor: f.proveedor,
      // Precio configurado en Mi catálogo, igual que el editor individual.
      costo: numero(f.costo), precio_minimo: numero(f.precio_minimo), precio_actual: numero(f.precio_actual),
    };
  }

  // Solo se consultan las miniaturas de la página actual, en dos consultas.
  // Un combo usa su foto propia y, si no tiene, la de su producto principal.
  static async imagenes(filas, inquilino_id) {
    const productos = [...new Set(filas.map(f => Number(f.producto_id ?? (f.tipo === 'producto' ? f.id : null))).filter(Boolean))];
    const combos = filas.filter(f => f.tipo === 'combo').map(f => Number(f.id));
    const [fotosProductos, fotosCombos] = await Promise.all([
      productos.length ? sequelize.query(`
        SELECT DISTINCT ON (producto_id) producto_id, url, storage_key
        FROM producto_imagenes WHERE inquilino_id = :inquilino_id AND producto_id IN (:productos)
        ORDER BY producto_id, (variante_id IS NOT NULL) ASC, es_principal DESC, orden ASC, id ASC
      `, { replacements: { inquilino_id, productos }, type: sequelize.QueryTypes.SELECT }) : [],
      combos.length ? sequelize.query(`
        SELECT DISTINCT ON (combo_id) combo_id, url, storage_key
        FROM producto_combo_imagenes WHERE inquilino_id = :inquilino_id AND combo_id IN (:combos)
        ORDER BY combo_id, es_principal DESC, orden ASC, id ASC
      `, { replacements: { inquilino_id, combos }, type: sequelize.QueryTypes.SELECT }) : [],
    ]);
    const porProducto = new Map(fotosProductos.map(f => [Number(f.producto_id), ImagenService.serializar(f).url]));
    const porCombo = new Map(fotosCombos.map(f => [Number(f.combo_id), ImagenService.serializar(f).url]));
    return new Map(filas.map(f => [clave(f), (f.tipo === 'combo' ? porCombo.get(Number(f.id)) : null)
      || porProducto.get(Number(f.producto_id ?? f.id)) || null]));
  }

  static async buscar(usuario_id, inquilino_id, esAdmin, body = {}) {
    const page = Number(body.page ?? 1), limit = Number(body.limit ?? 25);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw errorValidacion('La paginación no es válida (máximo 100 filas por página).');
    }
    const { base, sql, replacements } = this.consulta(usuario_id, inquilino_id, esAdmin, body);
    const ordenes = { nombre: 'nombre ASC', recientes: 'created_at DESC', 'precio-asc': 'precio_actual ASC', 'precio-desc': 'precio_actual DESC' };
    const orden = Object.hasOwn(ordenes, body.orden || 'nombre') ? ordenes[body.orden || 'nombre'] : null;
    if (!orden) throw errorValidacion('Orden inválido.');
    const [cuenta, filas, categorias, proveedores] = await Promise.all([
      sequelize.query(`SELECT COUNT(*) AS total FROM (${sql}) f`, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`${sql} ORDER BY ${orden}, tipo ASC, id ASC LIMIT :limit OFFSET :offset`, {
        replacements: { ...replacements, limit, offset: (page - 1) * limit }, type: sequelize.QueryTypes.SELECT,
      }),
      sequelize.query(`SELECT DISTINCT categoria AS nombre FROM (${base}) f WHERE categoria IS NOT NULL ORDER BY categoria`, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`SELECT DISTINCT proveedor AS nombre FROM (${base}) f WHERE proveedor IS NOT NULL ORDER BY proveedor`, { replacements, type: sequelize.QueryTypes.SELECT }),
    ]);
    const total = Number(cuenta[0]?.total || 0);
    const fotos = await this.imagenes(filas, inquilino_id);
    return { items: filas.map(f => ({ ...this.fila(f), imagen: fotos.get(clave(f)) })), total, page, totalPages: Math.ceil(total / limit), categorias: categorias.map(c => c.nombre), proveedores: proveedores.map(p => p.nombre) };
  }

  static async actualizar(usuario_id, inquilino_id, esAdmin, body = {}) {
    const manual = body.modo === 'manual';
    if (!manual && body.modo !== 'reajuste') throw errorValidacion('Elegí edición manual o reajuste.');
    const porcentaje = body.porcentaje;
    if (!manual && (typeof porcentaje !== 'number' || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 1000)) {
      throw errorValidacion('Ingresá un porcentaje entre 0 y 1000.');
    }
    const seleccion = body.seleccion || {};
    if (!manual && typeof seleccion.todos !== 'boolean') throw errorValidacion('La selección no es válida.');
    const items = manual ? normalizarItems(body.cambios) : seleccion.todos ? null : normalizarItems(seleccion.items);
    if (items && !items.length) throw errorValidacion('Seleccioná al menos una fila.');
    if (manual && items.length > 1000) throw errorValidacion('Guardá hasta 1000 cambios por vez.');
    const excluidos = !manual && seleccion.todos ? normalizarItems(seleccion.excluidos || []) : [];
    const exclusiones = new Set(excluidos.map(clave));
    const precios = new Map((items || []).map(i => [clave(i), i.precio]));
    const filtros = !manual && seleccion.todos ? seleccion.filtros || {} : {};
    const { sql, replacements } = this.consulta(usuario_id, inquilino_id, esAdmin, filtros, items);

    return sequelize.transaction({ isolationLevel: 'REPEATABLE READ' }, async transaction => {
      const filas = await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT, transaction });
      if (items && filas.length !== items.length) throw errorValidacion('Hay productos que ya no están disponibles o no pertenecen a tu catálogo. Recargá la tabla.');
      const cambios = [], errores = [];
      let seleccionados = 0;
      for (const cruda of filas) {
        const item = this.fila(cruda);
        if (exclusiones.has(clave(item))) continue;
        seleccionados++;
        const precio = manual ? precios.get(clave(item)) : Math.round(item.costo * (1 + porcentaje / 100));
        let motivo;
        if (!manual && (item.costo === null || !Number.isFinite(item.costo) || item.costo <= 0)) motivo = 'No tiene un costo válido para reajustar.';
        else if (typeof precio !== 'number' || !Number.isSafeInteger(precio) || precio <= 0 || precio > MAX_PRECIO) motivo = 'El precio debe ser un entero positivo y menor a 10.000.000.000 Gs.';
        else if (precio < (item.costo || 0)) motivo = 'El precio no puede ser menor al costo.';
        else if (precio < (item.precio_minimo || 0)) motivo = `El precio calculado (${precio} Gs) es menor al mínimo (${item.precio_minimo} Gs).`;
        if (motivo) errores.push({ tipo: item.tipo, id: item.id, nombre: item.nombre, motivo });
        // Guardar también si el efectivo coincide pero aún no hay precio propio.
        else if (numero(cruda.precio_usuario) !== precio) cambios.push({ usuario_id, inquilino_id, tipo: item.tipo, referencia_id: item.id, precio });
      }
      if (!seleccionados) throw errorValidacion('Seleccioná al menos una fila.');
      if (errores.length) throw errorValidacion(`No se aplicó ningún cambio: ${errores.length} fila(s) requieren corrección.`, errores);
      for (let i = 0; i < cambios.length; i += 1000) {
        await PrecioUsuario.bulkCreate(cambios.slice(i, i + 1000), {
          transaction, updateOnDuplicate: ['precio', 'updated_at'], conflictAttributes: ['usuario_id', 'tipo', 'referencia_id'],
        });
      }
      return { seleccionados, actualizados: cambios.length, sin_cambios: seleccionados - cambios.length };
    });
  }
}

module.exports = PrecioUsuarioMasivoService;
