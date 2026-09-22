'use strict';

const { Op } = require('sequelize');
const slugify = require('slugify');
const { CategoriaCostoGasto } = require('../models');

/**
 * Taxonomía fija inicial (spec sección 7). Se seedea una sola vez como
 * categorías globales (inquilino_id null); cada tenant puede además crear
 * las suyas propias vía crear().
 */
const CATEGORIAS_DEFAULT = [
  { grupo: 'operacion', nombre: 'Producción' },
  { grupo: 'operacion', nombre: 'Insumos' },
  { grupo: 'operacion', nombre: 'Packaging' },
  { grupo: 'operacion', nombre: 'Logística' },
  { grupo: 'operacion', nombre: 'Mantenimiento' },
  { grupo: 'administracion', nombre: 'Alquiler' },
  { grupo: 'administracion', nombre: 'Servicios' },
  { grupo: 'administracion', nombre: 'Salarios' },
  { grupo: 'administracion', nombre: 'Contabilidad' },
  { grupo: 'administracion', nombre: 'Servicios profesionales' },
  { grupo: 'marketing', nombre: 'Publicidad' },
  { grupo: 'marketing', nombre: 'Marketing' },
  { grupo: 'marketing', nombre: 'Comisiones' },
  { grupo: 'tecnologia', nombre: 'Software' },
  { grupo: 'tecnologia', nombre: 'Suscripciones' },
  { grupo: 'tecnologia', nombre: 'Hosting' },
  { grupo: 'tecnologia', nombre: 'Dominios' },
  { grupo: 'financiero', nombre: 'Comisiones bancarias' },
  { grupo: 'financiero', nombre: 'Intereses' },
  { grupo: 'financiero', nombre: 'Costos financieros' },
  { grupo: 'otros', nombre: 'Otros ingresos' },
  { grupo: 'otros', nombre: 'Otros costos' },
  { grupo: 'otros', nombre: 'Otros gastos' },
];

class CategoriaCostoGastoService {
  static serializar(cat) {
    return { id: cat.id, grupo: cat.grupo, nombre: cat.nombre, slug: cat.slug, activo: cat.activo, es_global: cat.inquilino_id === null };
  }

  /** Idempotente: se llama al arrancar el servidor (ver server.js). */
  static async seedDefaults() {
    for (const c of CATEGORIAS_DEFAULT) {
      const slug = slugify(c.nombre, { lower: true, strict: true });
      await CategoriaCostoGasto.findOrCreate({
        where: { inquilino_id: null, slug },
        defaults: { inquilino_id: null, grupo: c.grupo, nombre: c.nombre, slug },
      });
    }
  }

  /** Categorías globales + las propias del tenant, agrupadas por "grupo". */
  static async listar(inquilino_id) {
    const categorias = await CategoriaCostoGasto.findAll({
      where: {
        activo: true,
        [Op.or]: [{ inquilino_id: null }, { inquilino_id }],
      },
      order: [['grupo', 'ASC'], ['nombre', 'ASC']],
    });
    return categorias.map(this.serializar);
  }

  static async crear(datos, inquilino_id) {
    const nombre = (datos.nombre || '').trim();
    const grupo = datos.grupo;
    if (!nombre) throw new Error('El nombre es requerido.');
    if (!grupo) throw new Error('El grupo es requerido.');

    const base = slugify(nombre, { lower: true, strict: true });
    let slug = base;
    let contador = 1;
    while (await CategoriaCostoGasto.findOne({ where: { inquilino_id, slug } })) {
      slug = `${base}-${++contador}`;
    }

    const categoria = await CategoriaCostoGasto.create({ inquilino_id, grupo, nombre, slug });
    return this.serializar(categoria);
  }

  static async eliminar(id, inquilino_id) {
    const categoria = await CategoriaCostoGasto.findOne({ where: { id, inquilino_id } });
    if (!categoria) throw new Error('Categoría no encontrada.');
    categoria.activo = false;
    await categoria.save();
    return true;
  }
}

module.exports = CategoriaCostoGastoService;
