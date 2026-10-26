'use strict';

const { Op } = require('sequelize');
const slugify = require('slugify');
const { Categoria } = require('../models');

class CategoriaService {
  static alcance(inquilino_id, tiendaId, esAdmin = false, escribir = false) {
    if (!tiendaId && !esAdmin) throw Object.assign(new Error('Seleccioná una tienda para administrar categorías.'), { status:409 });
    if (escribir) return { inquilino_id, tienda_id: tiendaId || null };
    return { inquilino_id, [Op.or]: [{tienda_id:tiendaId || null}, {tienda_id:null}] };
  }
  static async validarAsignacion(id, inquilino_id, tiendaId, transaction) {
    if (!id) return;
    const categoria = await Categoria.findOne({ where: { id, inquilino_id, [Op.or]: [{tienda_id:tiendaId || null},{tienda_id:null}] }, transaction });
    if (!categoria) throw Object.assign(new Error('La categoría no pertenece a esta tienda.'), { status:400 });
  }

  static async generarSlugUnico(nombre, inquilino_id, excluirId = null, transaction = null) {
    const base = slugify(nombre, { lower: true, strict: true });
    let slug = base;
    let contador = 1;
    while (true) {
      const where = { slug, inquilino_id };
      if (excluirId) where.id = { [Op.ne]: excluirId };
      const existe = await Categoria.findOne({ where, transaction });
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

  static async buscar(filtros, inquilino_id, tiendaId = null, esAdmin = false) {
    const { nombre, solo_activas = true, include_children = false, page = 1, limit = 10 } = filtros;
    const where = this.alcance(inquilino_id, tiendaId, esAdmin);
    if (solo_activas) where.activo = true;
    if (nombre) where.nombre = { [Op.iLike]: `%${nombre}%` };

    const include = [];
    if (include_children) {
      include.push({ model: Categoria, as: 'subcategorias', required: false, where: this.alcance(inquilino_id, tiendaId, esAdmin) });
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

  static async crear(datos, inquilino_id, tiendaId = null, esAdmin = false) {
    const { nombre, parent_id } = datos;
    if (!nombre) throw new Error('El nombre es requerido.');
    const alcance = this.alcance(inquilino_id, tiendaId, esAdmin, true);
    await this.validarAsignacion(parent_id, inquilino_id, tiendaId);
    const slug = await this.generarSlugUnico(nombre, inquilino_id);
    const categoria = await Categoria.create({ ...alcance, nombre, slug, parent_id: parent_id || null });
    return this.serializar(categoria);
  }

  static async detalle(id, inquilino_id, tiendaId = null, esAdmin = false) {
    const categoria = await Categoria.findOne({
      where: { id, ...this.alcance(inquilino_id, tiendaId, esAdmin) },
      // Optional: Solo hacer include si es necesario, pero mantenemos por simplicidad o podríamos separarlo.
      include: [
        { model: Categoria, as: 'padre', required:false, where:this.alcance(inquilino_id, tiendaId, esAdmin), attributes: ['id', 'nombre', 'slug'] },
        { model: Categoria, as: 'subcategorias', required:false, where:this.alcance(inquilino_id, tiendaId, esAdmin), attributes: ['id', 'nombre', 'slug', 'activo'] },
      ],
    });
    if (!categoria) throw new Error('Categoría no encontrada.');
    return this.serializar(categoria);
  }

  static async actualizar(id, datos, inquilino_id, tiendaId = null, esAdmin = false) {
    const { nombre, parent_id, activo } = datos;
    const categoria = await Categoria.findOne({ where: { id, ...this.alcance(inquilino_id, tiendaId, esAdmin, true) } });
    if (!categoria) throw new Error('Categoría no encontrada.');

    if (nombre && nombre !== categoria.nombre) {
      categoria.nombre = nombre;
      categoria.slug = await this.generarSlugUnico(nombre, inquilino_id, id);
    }
    if (parent_id !== undefined) {
      await this.validarAsignacion(parent_id, inquilino_id, tiendaId);
      if (Number(parent_id) === Number(id)) throw Object.assign(new Error('Una categoría no puede ser su propia categoría padre.'),{status:400});
      categoria.parent_id = parent_id;
    }
    if (activo !== undefined) categoria.activo = activo;

    await categoria.save();
    return this.serializar(categoria);
  }

  static async eliminar(id, inquilino_id, tiendaId = null, esAdmin = false) {
    const categoria = await Categoria.findOne({ where: { id, ...this.alcance(inquilino_id, tiendaId, esAdmin, true) } });
    if (!categoria) throw new Error('Categoría no encontrada.');
    categoria.activo = false;
    await categoria.save();
    return true;
  }
}

module.exports = CategoriaService;
