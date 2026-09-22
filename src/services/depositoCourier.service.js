'use strict';

const { Op } = require('sequelize');
const { sequelize, Deposito, Courier, DepositoCourier, DeliveryZonaTarifa } = require('../models');

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/**
 * Qué couriers puede despachar cada depósito.
 *
 * Regla de ownership (no se confía en los ids que manda el frontend):
 *  - el depósito tiene que ser del comercio;
 *  - el courier tiene que ser del comercio;
 *  - ambos tienen que estar activos para poder vincularse.
 *
 * Acá vivía la mezcla: la lista devolvía los couriers del comercio MÁS los de
 * Gesicomm, como si fueran lo mismo. No lo son. Los operadores de la red de
 * Gesicomm son proveedores logísticos, se administran desde Fulfillment y no
 * se vinculan al depósito privado de nadie.
 */
class DepositoCourierService {
  /** El depósito, validando que sea del comercio. */
  static async depositoDelUsuario(depositoId, usuarioId) {
    const deposito = await Deposito.findOne({ where: { id: depositoId, usuario_id: usuarioId } });
    if (!deposito) throw errorHttp('Depósito no encontrado.', 404);
    return deposito;
  }

  /** Couriers que este comercio puede vincular: exclusivamente los suyos. */
  static async couriersDisponibles(usuarioId) {
    return Courier.findAll({
      where: { activo: true, usuario_id: usuarioId },
      order: [['nombre', 'ASC']],
    });
  }

  /**
   * Devuelve los couriers disponibles marcando cuáles están habilitados en
   * ese depósito, más cuántas ciudades cubre cada uno — sin cobertura el
   * vínculo no sirve para nada y conviene que se vea.
   */
  static async listarPorDeposito(depositoId, usuarioId) {
    const deposito = await this.depositoDelUsuario(depositoId, usuarioId);

    const [disponibles, vinculos, coberturas] = await Promise.all([
      this.couriersDisponibles(usuarioId),
      DepositoCourier.findAll({ where: { deposito_id: deposito.id } }),
      DeliveryZonaTarifa.findAll({
        where: { activo: true },
        attributes: ['courier_id', [sequelize.fn('COUNT', sequelize.col('id')), 'ciudades']],
        group: ['courier_id'],
        raw: true,
      }),
    ]);

    const porCourier = new Map(vinculos.map((v) => [v.courier_id, v]));
    const ciudadesPorCourier = new Map(coberturas.map((c) => [c.courier_id, Number(c.ciudades) || 0]));

    return {
      deposito: { id: deposito.id, nombre: deposito.nombre, ciudad: deposito.ciudad, activo: deposito.activo },
      couriers: disponibles.map((c) => {
        const vinculo = porCourier.get(c.id);
        return {
          id: c.id,
          nombre: c.nombre,
          habilitado: Boolean(vinculo?.activo),
          prioridad: vinculo?.prioridad ?? 0,
          ciudades_cubiertas: ciudadesPorCourier.get(c.id) || 0,
        };
      }),
    };
  }

  /**
   * Reemplaza el set de couriers habilitados del depósito. El borrado está
   * acotado a ESE depósito: nunca toca los vínculos de otro.
   */
  static async reemplazar(depositoId, usuarioId, courierIds = []) {
    const deposito = await this.depositoDelUsuario(depositoId, usuarioId);

    const pedidos = [...new Set((courierIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

    if (pedidos.length > 0) {
      const permitidos = await this.couriersDisponibles(usuarioId);
      const idsPermitidos = new Set(permitidos.map((c) => c.id));
      const invalidos = pedidos.filter((id) => !idsPermitidos.has(id));
      if (invalidos.length > 0) {
        throw errorHttp(
          `Estos couriers no se pueden vincular (no son tuyos, no son de Gesicomm o están inactivos): ${invalidos.join(', ')}.`,
          403,
        );
      }
    }

    await sequelize.transaction(async (t) => {
      await DepositoCourier.destroy({ where: { deposito_id: deposito.id }, transaction: t });
      if (pedidos.length > 0) {
        await DepositoCourier.bulkCreate(
          pedidos.map((courierId, i) => ({
            deposito_id: deposito.id,
            courier_id: courierId,
            prioridad: i,
            activo: true,
          })),
          { transaction: t },
        );
      }
    });

    return this.listarPorDeposito(deposito.id, usuarioId);
  }

  /**
   * Couriers habilitados para despachar desde un depósito. Es la entrada del
   * motor de fulfillment propio: depósito → couriers → cobertura → tarifa.
   */
  static async couriersHabilitados(depositoId) {
    const porDeposito = await this.couriersHabilitadosPorDeposito([depositoId]);
    return porDeposito.get(Number(depositoId)) || [];
  }

  /**
   * Igual que couriersHabilitados pero para varios depósitos en UNA consulta.
   * La pantalla de fulfillment lista todos los depósitos del comercio con sus
   * couriers, y pedirlos de a uno era un N+1 que crecía con cada depósito.
   */
  static async couriersHabilitadosPorDeposito(depositoIds) {
    const ids = [...new Set((depositoIds || []).map(Number).filter(Boolean))];
    const mapa = new Map(ids.map((id) => [id, []]));
    if (ids.length === 0) return mapa;

    const vinculos = await DepositoCourier.findAll({
      where: { deposito_id: { [Op.in]: ids }, activo: true },
      include: [{ model: Courier, as: 'courier', where: { activo: true }, required: true }],
      order: [['deposito_id', 'ASC'], ['prioridad', 'ASC']],
    });

    for (const vinculo of vinculos) {
      mapa.get(vinculo.deposito_id)?.push(vinculo.courier);
    }
    return mapa;
  }
}

module.exports = DepositoCourierService;
module.exports.errorHttp = errorHttp;
