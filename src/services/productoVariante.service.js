'use strict';

const { ProductoVariante } = require('../models');

class ProductoVarianteService {
  
  static async listarPorProducto(producto_id, inquilino_id) {
    return await ProductoVariante.findAll({
      where: { producto_id, inquilino_id, activo: true },
      order: [['id', 'ASC']]
    });
  }

  static async sincronizar(producto_id, inquilino_id, variantesPayload, transaction) {
    if (!variantesPayload) return;

    const actuales = await ProductoVariante.findAll({
      where: { producto_id, activo: true },
      transaction,
    });
    const mapaActuales = new Map(actuales.map(v => [v.id, v]));
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
      if (idExistente && mapaActuales.has(idExistente)) {
        idsConservados.add(idExistente);
        await mapaActuales.get(idExistente).update(datos, { transaction });
      } else {
        const nueva = await ProductoVariante.create(
          { inquilino_id, producto_id, ...datos },
          { transaction }
        );
        idsConservados.add(nueva.id);
      }
    }

    for (const actual of actuales) {
      if (!idsConservados.has(actual.id)) {
        await actual.update({ activo: false }, { transaction });
      }
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
