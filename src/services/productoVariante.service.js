'use strict';

const { Op } = require('sequelize');
const { ProductoVariante, ProductoVarianteValor, ProductoOpcionValor, ProductoOpcion } = require('../models');
const ProductoOpcionService = require('./productoOpcion.service');

class ProductoVarianteService {

  static async listarPorProducto(producto_id, inquilino_id) {
    return await ProductoVariante.findAll({
      where: { producto_id, inquilino_id, activo: true },
      include: [{
        model: ProductoOpcionValor,
        as: 'valoresOpcion',
        through: { attributes: [] },
        include: [{ model: ProductoOpcion, as: 'opcion', attributes: ['id', 'nombre', 'orden'] }],
      }],
      order: [['id', 'ASC']]
    });
  }

  /**
   * Resuelve el `nombre` y los `opcion_valor_id` de una variante entrante.
   *
   * Con Opciones (mapaValores presente y `v.valores` no vacío): el nombre se
   * IGNORA si lo manda el cliente — se deriva de los valores elegidos,
   * ordenados según el orden de las Opciones ya sincronizadas, y cada
   * `{opcion, valor}` se resuelve contra el mapa por texto normalizado
   * (trim+lowercase), no por id — así el cliente no necesita conocer ids
   * temporales de valores recién creados en el mismo submit.
   *
   * Sin Opciones (modo legacy, como hoy): el nombre es el texto libre que
   * manda el cliente, sin valores asociados.
   */
  static _resolverNombreYValores(v, mapaValores, opcionesOrdenadas) {
    if (mapaValores && Array.isArray(v.valores) && v.valores.length > 0) {
      const valorPorOpcion = new Map(
        v.valores.map(x => [ProductoOpcionService.normalizar(x.opcion), x.valor])
      );
      const valorIds = [];
      const partesNombre = [];
      for (const opcion of opcionesOrdenadas) {
        const valorTexto = valorPorOpcion.get(ProductoOpcionService.normalizar(opcion.nombre));
        if (valorTexto === undefined) continue;
        const clave = `${ProductoOpcionService.normalizar(opcion.nombre)}::${ProductoOpcionService.normalizar(valorTexto)}`;
        const opcionValorId = mapaValores.get(clave);
        if (!opcionValorId) continue;
        valorIds.push(opcionValorId);
        partesNombre.push(valorTexto);
      }
      const nombre = partesNombre.join(' / ');
      if (!nombre) return null;
      return { nombre, valorIds };
    }

    const nombre = (v.nombre || '').trim();
    if (!nombre) return null;
    return { nombre, valorIds: [] };
  }

  static async _sincronizarBridgeValores(variantesConValores, transaction) {
    const ids = variantesConValores.map(x => x.id);
    if (ids.length === 0) return;
    await ProductoVarianteValor.destroy({ where: { variante_id: { [Op.in]: ids } }, transaction });
    const filas = variantesConValores.flatMap(({ id, valorIds }) =>
      valorIds.map(opcion_valor_id => ({ variante_id: id, opcion_valor_id }))
    );
    if (filas.length > 0) {
      await ProductoVarianteValor.bulkCreate(filas, { transaction });
    }
  }

  /**
   * Sincroniza variantes en operaciones por lote (upsert / insert / update
   * masivo), no una consulta por variante — con varias variantes, el
   * for-loop anterior encadenaba N ida-y-vueltas a la base de forma
   * secuencial dentro de la misma transacción.
   *
   * `opcionesPayload` es opcional: si no viene (o viene vacío), el producto
   * queda en modo legacy — nombre de texto libre, sin tocar Opciones/Valores
   * ni producto_variante_valores. Productos existentes sin Opciones no se
   * migran solos.
   */
  static async sincronizar(producto_id, inquilino_id, variantesPayload, transaction, opcionesPayload) {
    if (!variantesPayload) return;

    let mapaValores = null;
    let opcionesOrdenadas = [];
    if (opcionesPayload && opcionesPayload.length > 0) {
      const resultado = await ProductoOpcionService.sincronizarOpciones(producto_id, inquilino_id, opcionesPayload, transaction);
      mapaValores = resultado.mapaValores;
      opcionesOrdenadas = resultado.opcionesOrdenadas;
    }

    const actuales = await ProductoVariante.findAll({
      where: { producto_id, activo: true },
      transaction,
    });
    const idsActuales = new Set(actuales.map(v => v.id));

    const paraActualizar = [];
    const paraCrear = [];
    const valoresParaActualizar = [];
    const valoresParaCrear = [];
    const idsConservados = new Set();

    for (const v of variantesPayload) {
      const resolucion = this._resolverNombreYValores(v, mapaValores, opcionesOrdenadas);
      if (!resolucion) continue;

      const datos = { nombre: resolucion.nombre, ...this.normalizarStock(v) };

      const idExistente = v.id ? Number(v.id) : null;
      if (idExistente && idsActuales.has(idExistente)) {
        idsConservados.add(idExistente);
        paraActualizar.push({ id: idExistente, inquilino_id, producto_id, ...datos });
        valoresParaActualizar.push({ id: idExistente, valorIds: resolucion.valorIds });
      } else {
        paraCrear.push({ inquilino_id, producto_id, ...datos });
        valoresParaCrear.push(resolucion.valorIds);
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
        updateOnDuplicate: ['nombre', 'sku_variante', 'stock', 'stock_salon', 'stock_deposito', 'precio_diferencial', 'updated_at'],
        transaction,
      });
    }

    let creadas = [];
    if (paraCrear.length > 0) {
      creadas = await ProductoVariante.bulkCreate(paraCrear, { transaction });
    }

    const idsABorrar = actuales.filter(a => !idsConservados.has(a.id)).map(a => a.id);
    if (idsABorrar.length > 0) {
      await ProductoVariante.update(
        { activo: false },
        { where: { id: { [Op.in]: idsABorrar } }, transaction },
      );
    }

    if (mapaValores) {
      const variantesConValores = [
        ...valoresParaActualizar,
        ...creadas.map((instancia, i) => ({ id: instancia.id, valorIds: valoresParaCrear[i] })),
      ];
      await this._sincronizarBridgeValores(variantesConValores, transaction);
    }
  }

  static async crearMultiples(producto_id, inquilino_id, variantesPayload, transaction, opcionesPayload) {
    if (!variantesPayload || variantesPayload.length === 0) return;

    let mapaValores = null;
    let opcionesOrdenadas = [];
    if (opcionesPayload && opcionesPayload.length > 0) {
      const resultado = await ProductoOpcionService.sincronizarOpciones(producto_id, inquilino_id, opcionesPayload, transaction);
      mapaValores = resultado.mapaValores;
      opcionesOrdenadas = resultado.opcionesOrdenadas;
    }

    const filas = [];
    const valoresPorIndice = [];
    for (const v of variantesPayload) {
      const resolucion = this._resolverNombreYValores(v, mapaValores, opcionesOrdenadas);
      if (!resolucion) continue;
      filas.push({ inquilino_id, producto_id, nombre: resolucion.nombre, ...this.normalizarStock(v) });
      valoresPorIndice.push(resolucion.valorIds);
    }
    if (filas.length === 0) return;

    const creadas = await ProductoVariante.bulkCreate(filas, { transaction });

    if (mapaValores) {
      const filasBridge = creadas.flatMap((variante, i) =>
        valoresPorIndice[i].map(opcion_valor_id => ({ variante_id: variante.id, opcion_valor_id }))
      );
      if (filasBridge.length > 0) {
        await ProductoVarianteValor.bulkCreate(filasBridge, { transaction });
      }
    }
  }

  /**
   * El stock de una variante se carga separado (salón / depósito) pero se
   * vende junto: `stock` es SIEMPRE la suma y es lo único que mira el motor
   * de precios/stock y el checkout. Nunca se toma el `stock` que manda el
   * cliente — si llegara desincronizado, la variante quedaría vendiendo una
   * cantidad que no coincide con el desglose que ve el comercio.
   *
   * Payloads viejos (los que todavía mandan solo `stock`) siguen andando:
   * ese total se toma como stock de salón.
   */
  static normalizarStock(v) {
    const traeDesglose = v.stock_salon !== undefined || v.stock_deposito !== undefined;
    const salon = Math.max(0, parseInt(traeDesglose ? v.stock_salon : v.stock, 10) || 0);
    const deposito = Math.max(0, parseInt(v.stock_deposito, 10) || 0);
    return {
      sku_variante: v.sku_variante || null,
      stock_salon: salon,
      stock_deposito: deposito,
      stock: salon + deposito,
      precio_diferencial: v.precio_diferencial ? parseFloat(v.precio_diferencial) : 0,
    };
  }
}

module.exports = ProductoVarianteService;
