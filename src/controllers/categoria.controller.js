/**
 * Controller de Categorías.
 *
 * POST /api/categorias/buscar  → Listar con filtros
 * POST /api/categorias         → Crear
 * GET  /api/categorias/:id     → Detalle
 * PUT  /api/categorias/:id     → Actualizar
 * DELETE /api/categorias/:id   → Soft-delete (activo = false)
 */
const { Op } = require('sequelize');
const slugify = require('slugify');
const { Categoria } = require('../models');

// ─── Helper: generar slug único por inquilino ────────────────────────────────
async function generarSlugUnico(nombre, inquilino_id, excluirId = null) {
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

// ─── Serializer ──────────────────────────────────────────────────────────────
function serializar(cat) {
  return {
    id: cat.id,
    nombre: cat.nombre,
    slug: cat.slug,
    parent_id: cat.parent_id,
    activo: cat.activo,
    created_at: cat.created_at,
  };
}

// ─── POST /api/categorias/buscar ──────────────────────────────────────────────────────
async function buscar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const { nombre, solo_activas = true, include_children = false, page = 1, limit = 10 } = req.body;

    const where = { inquilino_id };
    if (solo_activas) where.activo = true;
    // Filtro dinámico por nombre — usa parámetros de Sequelize (sin SQL injection)
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
      distinct: true, // necesario cuando hay includes
    });

    return res.json({
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      categorias: categorias.map(serializar),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener categorías.' });
  }
}

// ─── POST /api/categorias ────────────────────────────────────────────────────
async function crear(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const { nombre, parent_id } = req.body;

    if (!nombre) return res.status(400).json({ message: 'El nombre es requerido.' });

    const slug = await generarSlugUnico(nombre, inquilino_id);
    const categoria = await Categoria.create({ inquilino_id, nombre, slug, parent_id: parent_id || null });

    return res.status(201).json(serializar(categoria));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al crear categoría.' });
  }
}

// ─── GET /api/categorias/:id ─────────────────────────────────────────────────
async function detalle(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;

    const categoria = await Categoria.findOne({
      where: { id, inquilino_id },
      include: [
        { model: Categoria, as: 'padre', attributes: ['id', 'nombre', 'slug'] },
        { model: Categoria, as: 'subcategorias', attributes: ['id', 'nombre', 'slug', 'activo'] },
      ],
    });

    if (!categoria) return res.status(404).json({ message: 'Categoría no encontrada.' });

    return res.json(serializar(categoria));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener categoría.' });
  }
}

// ─── PUT /api/categorias/:id ─────────────────────────────────────────────────
async function actualizar(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;
    const { nombre, parent_id, activo } = req.body;

    const categoria = await Categoria.findOne({ where: { id, inquilino_id } });
    if (!categoria) return res.status(404).json({ message: 'Categoría no encontrada.' });

    if (nombre && nombre !== categoria.nombre) {
      categoria.nombre = nombre;
      categoria.slug = await generarSlugUnico(nombre, inquilino_id, id);
    }
    if (parent_id !== undefined) categoria.parent_id = parent_id;
    if (activo !== undefined) categoria.activo = activo;

    await categoria.save();
    return res.json(serializar(categoria));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al actualizar categoría.' });
  }
}

// ─── DELETE /api/categorias/:id ──────────────────────────────────────────────
async function eliminar(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;

    const categoria = await Categoria.findOne({ where: { id, inquilino_id } });
    if (!categoria) return res.status(404).json({ message: 'Categoría no encontrada.' });

    categoria.activo = false;
    await categoria.save();

    return res.json({ message: 'Categoría dada de baja correctamente.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al dar de baja la categoría.' });
  }
}

module.exports = { buscar, crear, detalle, actualizar, eliminar };
