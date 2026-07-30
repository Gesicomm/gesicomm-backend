'use strict';

const { Op } = require('sequelize');
const slugify = require('slugify');
const { Marca } = require('../models');

class MarcaService {
  static async generarSlugUnico(nombre, inquilino_id, excluirId = null) {
    const base = slugify(nombre, { lower: true, strict: true });
    let slug = base;
    let contador = 1;
    while (true) {
      const where = { slug, inquilino_id };
      if (excluirId) where.id = { [Op.ne]: excluirId };
      const existe = await Marca.findOne({ where });
      if (!existe) break;
      slug = `${base}-${++contador}`;
    }
    return slug;
  }

  static serializar(marca) {
    return { id: marca.id, nombre: marca.nombre, slug: marca.slug, activo: marca.activo };
  }

  static async buscar(filtros, inquilino_id) {
    const { nombre, solo_activas = true, page = 1, limit = 10 } = filtros;
    const where = { inquilino_id };
    if (solo_activas) where.activo = true;
    if (nombre) where.nombre = { [Op.iLike]: `%${nombre}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows: marcas, count } = await Marca.findAndCountAll({
      where,
      order: [['nombre', 'ASC']],
      limit: parseInt(limit),
      offset,
    });

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      marcas: marcas.map(this.serializar),
    };
  }

  static async crear(datos, inquilino_id) {
    const { nombre } = datos;
    if (!nombre) throw new Error('El nombre es requerido.');
    const slug = await this.generarSlugUnico(nombre, inquilino_id);
    const marca = await Marca.create({ inquilino_id, nombre, slug });
    return this.serializar(marca);
  }

  static async detalle(id, inquilino_id) {
    const marca = await Marca.findOne({ where: { id, inquilino_id } });
    if (!marca) throw new Error('Marca no encontrada.');
    return this.serializar(marca);
  }

  static async actualizar(id, datos, inquilino_id) {
    const { nombre, activo } = datos;
    const marca = await Marca.findOne({ where: { id, inquilino_id } });
    if (!marca) throw new Error('Marca no encontrada.');

    if (nombre && nombre !== marca.nombre) {
      marca.nombre = nombre;
      marca.slug = await this.generarSlugUnico(nombre, inquilino_id, id);
    }
    if (activo !== undefined) marca.activo = activo;

    await marca.save();
    return this.serializar(marca);
  }

  static async eliminar(id, inquilino_id) {
    const marca = await Marca.findOne({ where: { id, inquilino_id } });
    if (!marca) throw new Error('Marca no encontrada.');
    marca.activo = false;
    await marca.save();
    return true;
  }
}

module.exports = MarcaService;
