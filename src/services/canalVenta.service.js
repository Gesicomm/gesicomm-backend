'use strict';

const { Op } = require('sequelize');
const slugify = require('slugify');
const { CanalVenta } = require('../models');

/**
 * Canales de venta del sistema. Mismo patrón que
 * categoriaCostoGasto.service.js: se seedean como globales
 * (inquilino_id NULL) al arrancar el server y cada tenant puede sumar los
 * suyos sin tocar código.
 */

// Los tres canales con los que opera el comercio hoy. El slug es lo que
// usan los reportes para agrupar, así que no cambia aunque se renombre el
// canal desde la UI.
// Son estos tres y nada más. "Meta" no es un canal de venta: es el gasto en
// anuncios (se carga como CostoGasto de categoría Publicidad). El tráfico
// que llega por un anuncio entra igual por la landing, o sea por "Web".
const CANALES_DEFAULT = [
  // "Web" es la venta que entra por la landing del comercio.
  { nombre: 'Web', slug: 'web', orden: 1 },
  { nombre: 'Orgánico', slug: 'organico', orden: 2 },
  { nombre: 'WhatsApp', slug: 'whatsapp', orden: 3 },
];

class CanalVentaService {
  static async seedDefaults() {
    for (const c of CANALES_DEFAULT) {
      await CanalVenta.findOrCreate({
        where: { inquilino_id: null, slug: c.slug },
        defaults: { inquilino_id: null, nombre: c.nombre, slug: c.slug, orden: c.orden },
      });
    }
  }

  /**
   * Id del canal global con ese slug, o null si no está.
   *
   * Lo usa el checkout público de la landing: un pedido tiene que nacer con
   * su canal puesto. Si el canal se resuelve recién en la reportería, cada
   * pedido nuevo queda en "Sin canal" hasta que alguien corra una migración.
   */
  static async idPorSlug(slug) {
    const canal = await CanalVenta.findOne({
      where: { slug, inquilino_id: null },
      attributes: ['id'],
    });
    return canal ? canal.id : null;
  }

  /** Canales globales + los propios del tenant, en orden de presentación. */
  static async listar(inquilino_id) {
    const canales = await CanalVenta.findAll({
      where: {
        activo: true,
        [Op.or]: [{ inquilino_id: null }, { inquilino_id }],
      },
      order: [['orden', 'ASC'], ['nombre', 'ASC']],
    });
    return canales.map(this.serializar);
  }

  static async crear(datos, inquilino_id) {
    const nombre = (datos.nombre || '').trim();
    if (!nombre) throw new Error('El nombre es requerido.');

    const base = slugify(nombre, { lower: true, strict: true });
    let slug = base;
    let contador = 1;
    // El slug es único por tenant contra los propios Y contra los globales,
    // porque los reportes agrupan por slug: dos canales con el mismo slug
    // se sumarían como si fueran uno solo.
    while (await CanalVenta.findOne({ where: { slug, [Op.or]: [{ inquilino_id: null }, { inquilino_id }] } })) {
      slug = `${base}-${contador++}`;
    }

    const canal = await CanalVenta.create({
      inquilino_id,
      nombre,
      slug,
      orden: Number(datos.orden) || 99,
    });
    return this.serializar(canal);
  }

  static async actualizar(id, datos, inquilino_id) {
    const canal = await CanalVenta.findOne({ where: { id, inquilino_id } });
    // Buscar con inquilino_id (y no solo por id) es lo que impide editar un
    // canal global o el de otro tenant desde este endpoint.
    if (!canal) throw new Error('Canal de venta no encontrado.');

    if (datos.nombre !== undefined) {
      const nombre = String(datos.nombre).trim();
      if (!nombre) throw new Error('El nombre es requerido.');
      canal.nombre = nombre;
    }
    if (datos.orden !== undefined) canal.orden = Number(datos.orden) || 0;
    if (datos.activo !== undefined) canal.activo = Boolean(datos.activo);

    await canal.save();
    return this.serializar(canal);
  }

  static serializar(canal) {
    return {
      id: canal.id,
      nombre: canal.nombre,
      slug: canal.slug,
      orden: canal.orden,
      activo: canal.activo,
      es_global: canal.inquilino_id === null,
    };
  }
}

module.exports = CanalVentaService;
