'use strict';

const { Op } = require('sequelize');
const slugify = require('slugify');
const { Categoria } = require('../models');

class CategoriaService {
  static async generarSlugUnico(nombre, inquilino_id, excluirId = null) {
    const base = slugify(nombre, { lower: true, strict: true });
    let slug = base;
    let contador = 1;
    while (true) {
      const where = { slug, inquilino_id };
      if (excluirId) where.id = { [Op.ne]: excluirId };
      const existe = await Categoria.findOne({ where });
      if (!existe) break;
      slug = `${base}-${++contador}`;
    }
    return slug;
  }

  static serializar(cat) {
    return {
      id: cat.id,
      nombre: cat.nombre,
      slug: cat.slug,
      parent_id: cat.parent_id,
      activo: cat.activo,
      created_at: cat.created_at,
    };
  }

  static async buscar(filtros, inquilino_id) {
    const { nombre, solo_activas = true, include_children = false, page = 1, limit = 10 } = filtros;
    const where = { inquilino_id };
    if (solo_activas) where.activo = true;
    if (nombre) where.nombre = { [Op.iLike]: `%${nombre}%` };

    const include = [];
    if (include_children) {
      include.push({ model: Categoria, as: 'subcategorias', required: false });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows: categorias, count } = await Categoria.findAndCountAll({
      where,
      include,
      order: [['nombre', 'ASC']],
      limit: parseInt(limit),
      offset,
      distinct: true,
    });

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      categorias: categorias.map(this.serializar),
    };
  }

  static async crear(datos, inquilino_id) {
    const { nombre, parent_id } = datos;
    if (!nombre) throw new Error('El nombre es requerido.');
    const slug = await this.generarSlugUnico(nombre, inquilino_id);
    const categoria = await Categoria.create({ inquilino_id, nombre, slug, parent_id: parent_id || null });
    return this.serializar(categoria);
  }

  static async detalle(id, inquilino_id) {
    const categoria = await Categoria.findOne({
      where: { id, inquilino_id },
      // Optional: Solo hacer include si es necesario, pero mantenemos por simplicidad o podríamos separarlo.
      include: [
        { model: Categoria, as: 'padre', attributes: ['id', 'nombre', 'slug'] },
        { model: Categoria, as: 'subcategorias', attributes: ['id', 'nombre', 'slug', 'activo'] },
      ],
    });
    if (!categoria) throw new Error('Categoría no encontrada.');
    return this.serializar(categoria);
  }

  static async actualizar(id, datos, inquilino_id) {
    const { nombre, parent_id, activo } = datos;
    const categoria = await Categoria.findOne({ where: { id, inquilino_id } });
    if (!categoria) throw new Error('Categoría no encontrada.');

    if (nombre && nombre !== categoria.nombre) {
      categoria.nombre = nombre;
      categoria.slug = await this.generarSlugUnico(nombre, inquilino_id, id);
    }
    if (parent_id !== undefined) categoria.parent_id = parent_id;
    if (activo !== undefined) categoria.activo = activo;

    await categoria.save();
    return this.serializar(categoria);
  }

  static async eliminar(id, inquilino_id) {
    const categoria = await Categoria.findOne({ where: { id, inquilino_id } });
    if (!categoria) throw new Error('Categoría no encontrada.');
    categoria.activo = false;
    await categoria.save();
    return true;
  }
}

module.exports = CategoriaService;
