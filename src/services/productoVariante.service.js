'use strict';

const { Op } = require('sequelize');
const { ProductoVariante } = require('../models');

class ProductoVarianteService {

  static async listarPorProducto(producto_id, inquilino_id) {
    return await ProductoVariante.findAll({
      where: { producto_id, inquilino_id, activo: true },
      order: [['id', 'ASC']]
    });
  }

  /**
   * Sincroniza variantes en operaciones por lote (upsert / insert / update
   * masivo), no una consulta por variante — con varias variantes, el
   * for-loop anterior encadenaba N ida-y-vueltas a la base de forma
   * secuencial dentro de la misma transacción.
   */
  static async sincronizar(producto_id, inquilino_id, variantesPayload, transaction) {
    if (!variantesPayload) return;

    const actuales = await ProductoVariante.findAll({
      where: { producto_id, activo: true },
      transaction,
    });
    const idsActuales = new Set(actuales.map(v => v.id));

    const paraActualizar = [];
    const paraCrear = [];
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
      if (idExistente && idsActuales.has(idExistente)) {
        idsConservados.add(idExistente);
        paraActualizar.push({ id: idExistente, inquilino_id, producto_id, ...datos });
      } else {
        paraCrear.push({ inquilino_id, producto_id, ...datos });
      }
    }

    if (paraActualizar.length > 0) {
      await ProductoVariante.bulkCreate(paraActualizar, {
        // updateOnDuplicate solo toca las columnas listadas acá — a
        // diferencia de instance.save(), NO bumpea el timestamp solo, hay
        // que pedirlo explícito. OJO: necesita el nombre de COLUMNA real
        // ('updated_at'), no el atributo de Sequelize ('updatedAt') — con
        // el nombre de atributo lo ignora en silencio (verificado con el
        // SQL generado), porque el modelo mapea updatedAt a una columna
        // con otro nombre (`updatedAt: 'updated_at'` en ProductoVariante.js).
        updateOnDuplicate: ['nombre', 'sku_variante', 'stock', 'precio_diferencial', 'updated_at'],
        transaction,
      });
    }

    if (paraCrear.length > 0) {
      await ProductoVariante.bulkCreate(paraCrear, { transaction });
    }

    const idsABorrar = actuales.filter(a => !idsConservados.has(a.id)).map(a => a.id);
    if (idsABorrar.length > 0) {
      await ProductoVariante.update(
        { activo: false },
        { where: { id: { [Op.in]: idsABorrar } }, transaction },
      );
    }
  }

  static async crearMultiples(producto_id, inquilino_id, variantesPayload, transaction) {
    if (!variantesPayload || variantesPayload.length === 0) return;
    
    await ProductoVariante.bulkCreate(
      variantesPayload.map(v => ({ ...v, inquilino_id, producto_id })),
      { transaction }
    );
  }
}

module.exports = ProductoVarianteService;
