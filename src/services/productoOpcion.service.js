'use strict';

const { Op } = require('sequelize');
const { ProductoOpcion, ProductoOpcionValor } = require('../models');

class ProductoOpcionService {

  static normalizar(s) {
    return String(s || '').trim().toLowerCase();
  }

  static async listarPorProducto(producto_id, inquilino_id) {
    return await ProductoOpcion.findAll({
      where: { producto_id, inquilino_id },
      include: [{ model: ProductoOpcionValor, as: 'valores' }],
      order: [
        ['orden', 'ASC'],
        [{ model: ProductoOpcionValor, as: 'valores' }, 'orden', 'ASC'],
      ],
    });
  }

  /**
   * Sincroniza Opciones y sus Valores de un producto: upsert por id cuando
   * viene, crea si no, y borra (hard-delete) las que ya no están en el
   * payload — a diferencia de ProductoVariante, son config del producto sin
   * historial propio, no necesitan soft-delete. El borrado de una Opción o
   * un Valor cae en cascada (FK) sobre producto_variante_valores.
   *
   * El volumen es siempre chico (pocas opciones, pocos valores por opción),
   * así que se procesa fila por fila en vez de bulk — más simple de leer
   * para una estructura anidada, sin costo real de N+1 acá.
   *
   * Devuelve las opciones ordenadas por `orden` (con sus valores, también
   * ordenados) y un mapa "opcion::valor" -> opcion_valor_id (claves
   * normalizadas trim+lowercase), para que ProductoVarianteService resuelva
   * cada variante contra texto en vez de necesitar ids temporales del
   * cliente para valores recién creados en el mismo submit.
   */
  static async sincronizarOpciones(producto_id, inquilino_id, opcionesPayload, transaction) {
    const actuales = await ProductoOpcion.findAll({
      where: { producto_id },
      include: [{ model: ProductoOpcionValor, as: 'valores' }],
      transaction,
    });
    const actualesPorId = new Map(actuales.map(o => [o.id, o]));
    const idsConservados = new Set();
    const opcionesOrdenadas = [];

    for (let i = 0; i < opcionesPayload.length; i++) {
      const op = opcionesPayload[i] || {};
      const nombre = (op.nombre || '').trim();
      if (!nombre) continue;

      let opcion;
      const idExistente = op.id ? Number(op.id) : null;
      if (idExistente && actualesPorId.has(idExistente)) {
        opcion = actualesPorId.get(idExistente);
        await opcion.update({ nombre, orden: i }, { transaction });
        idsConservados.add(idExistente);
      } else {
        opcion = await ProductoOpcion.create(
          { inquilino_id, producto_id, nombre, orden: i },
          { transaction }
        );
        opcion.valores = [];
      }

      const valoresActuales = opcion.valores || [];
      const valoresActualesPorId = new Map(valoresActuales.map(v => [v.id, v]));
      const idsValoresConservados = new Set();
      const valoresOrdenados = [];

      const valoresPayload = op.valores || [];
      for (let j = 0; j < valoresPayload.length; j++) {
        const vp = valoresPayload[j] || {};
        const valorTexto = (vp.valor || '').trim();
        if (!valorTexto) continue;

        let valorInstancia;
        const idValorExistente = vp.id ? Number(vp.id) : null;
        if (idValorExistente && valoresActualesPorId.has(idValorExistente)) {
          valorInstancia = valoresActualesPorId.get(idValorExistente);
          await valorInstancia.update({ valor: valorTexto, orden: j }, { transaction });
          idsValoresConservados.add(idValorExistente);
        } else {
          valorInstancia = await ProductoOpcionValor.create(
            { opcion_id: opcion.id, valor: valorTexto, orden: j },
            { transaction }
          );
        }
        valoresOrdenados.push(valorInstancia);
      }

      const idsValoresABorrar = valoresActuales
        .filter(v => !idsValoresConservados.has(v.id))
        .map(v => v.id);
      if (idsValoresABorrar.length > 0) {
        await ProductoOpcionValor.destroy({ where: { id: { [Op.in]: idsValoresABorrar } }, transaction });
      }

      opcionesOrdenadas.push({ id: opcion.id, nombre, orden: i, valores: valoresOrdenados });
    }

    const idsOpcionesABorrar = actuales
      .filter(o => !idsConservados.has(o.id))
      .map(o => o.id);
    if (idsOpcionesABorrar.length > 0) {
      await ProductoOpcion.destroy({ where: { id: { [Op.in]: idsOpcionesABorrar } }, transaction });
    }

    const mapaValores = new Map();
    for (const opcion of opcionesOrdenadas) {
      for (const valor of opcion.valores) {
        mapaValores.set(`${this.normalizar(opcion.nombre)}::${this.normalizar(valor.valor)}`, valor.id);
      }
    }

    return { opcionesOrdenadas, mapaValores };
  }
}

module.exports = ProductoOpcionService;
