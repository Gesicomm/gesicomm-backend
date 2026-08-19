'use strict';

const { Op } = require('sequelize');
const { Proveedor } = require('../models');

class ProveedorService {
  static serializar(proveedor) {
    return { id: proveedor.id, nombre: proveedor.nombre, activo: proveedor.activo };
  }

  static async buscar(filtros, usuario_id) {
    const { nombre, solo_activos = true, page = 1, limit = 50 } = filtros;
    const where = { usuario_id };
    if (solo_activos) where.activo = true;
    if (nombre) where.nombre = { [Op.iLike]: `%${nombre}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows, count } = await Proveedor.findAndCountAll({
      where,
      order: [['nombre', 'ASC']],
      limit: parseInt(limit),
      offset,
    });

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      proveedores: rows.map(this.serializar),
    };
  }

  static async crear(datos, usuario_id) {
    const nombre = (datos.nombre || '').trim();
    if (!nombre) throw new Error('El nombre es requerido.');

    const existente = await Proveedor.findOne({ where: { usuario_id, nombre: { [Op.iLike]: nombre } } });
    if (existente) return this.serializar(existente);

    const proveedor = await Proveedor.create({ usuario_id, nombre });
    return this.serializar(proveedor);
  }

  static async actualizar(id, datos, usuario_id) {
    const proveedor = await Proveedor.findOne({ where: { id, usuario_id } });
    if (!proveedor) throw new Error('Proveedor no encontrado.');

    if (datos.nombre !== undefined) {
      const nombre = datos.nombre.trim();
      if (!nombre) throw new Error('El nombre es requerido.');
      proveedor.nombre = nombre;
    }
    if (datos.activo !== undefined) proveedor.activo = datos.activo;

    await proveedor.save();
    return this.serializar(proveedor);
  }

  static async eliminar(id, usuario_id) {
    const proveedor = await Proveedor.findOne({ where: { id, usuario_id } });
    if (!proveedor) throw new Error('Proveedor no encontrado.');
    proveedor.activo = false;
    await proveedor.save();
    return true;
  }
}

module.exports = ProveedorService;
