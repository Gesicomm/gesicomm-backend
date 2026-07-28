/**
 * Controller de Marcas.
 *
 * POST /api/marcas/buscar  → Listar con filtros
 * POST /api/marcas         → Crear
 * GET  /api/marcas/:id     → Detalle
 * PUT  /api/marcas/:id     → Actualizar
 * DELETE /api/marcas/:id   → Soft-delete (activo = false)
 */
const { Op } = require('sequelize');
const slugify = require('slugify');
const { Marca } = require('../models');

async function generarSlugUnico(nombre, inquilino_id, excluirId = null) {
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

function serializar(marca) {
  return { id: marca.id, nombre: marca.nombre, slug: marca.slug, activo: marca.activo };
}

async function buscar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const { nombre, solo_activas = true, page = 1, limit = 10 } = req.body;
    const where = { inquilino_id };
    if (solo_activas) where.activo = true;
    // Filtro dinámico por nombre — usa parámetros de Sequelize (sin SQL injection)
    if (nombre) where.nombre = { [Op.iLike]: `%${nombre}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows: marcas, count } = await Marca.findAndCountAll({
      where,
      order: [['nombre', 'ASC']],
      limit: parseInt(limit),
      offset,
    });

    return res.json({
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      marcas: marcas.map(serializar),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener marcas.' });
  }
}


async function crear(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ message: 'El nombre es requerido.' });
    const slug = await generarSlugUnico(nombre, inquilino_id);
    const marca = await Marca.create({ inquilino_id, nombre, slug });
    return res.status(201).json(serializar(marca));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al crear marca.' });
  }
}

async function detalle(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;
    const marca = await Marca.findOne({ where: { id, inquilino_id } });
    if (!marca) return res.status(404).json({ message: 'Marca no encontrada.' });
    return res.json(serializar(marca));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener marca.' });
  }
}

async function actualizar(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;
    const { nombre, activo } = req.body;
    const marca = await Marca.findOne({ where: { id, inquilino_id } });
    if (!marca) return res.status(404).json({ message: 'Marca no encontrada.' });
    if (nombre && nombre !== marca.nombre) {
      marca.nombre = nombre;
      marca.slug = await generarSlugUnico(nombre, inquilino_id, id);
    }
    if (activo !== undefined) marca.activo = activo;
    await marca.save();
    return res.json(serializar(marca));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al actualizar marca.' });
  }
}

async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;
    const marca = await Marca.findOne({ where: { id, inquilino_id } });
    if (!marca) return res.status(404).json({ message: 'Marca no encontrada.' });
    marca.activo = false;
    await marca.save();
    return res.json({ message: 'Marca dada de baja correctamente.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al dar de baja la marca.' });
  }
}

module.exports = { buscar, crear, detalle, actualizar, eliminar };
