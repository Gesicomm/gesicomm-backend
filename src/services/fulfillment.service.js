'use strict';

const { Tienda, Deposito, ProveedorLogistico } = require('../models');
const DepositoCourierService = require('./depositoCourier.service');
const ProveedorLogisticoService = require('./proveedorLogistico.service');
const TarifaDelivery = require('./tarifaDelivery.service');

const MODALIDADES = ['GESICOMM', 'PROPIA'];

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/**
 * Cómo entrega el comercio lo que vende.
 *
 *   PROPIA   → despacha desde un depósito suyo, con los couriers que habilitó
 *              en ese depósito (ver depositoCourier.service).
 *   GESICOMM → despacha Gesicomm con sus proveedores logísticos
 *              con sus proveedores logísticos, configurados por el admin.
 *
 * En las dos ramas el costo sale del MISMO motor: courier → cobertura →
 * tarifa (tarifaDelivery.service). Lo único que cambia es de quién son los
 * couriers y quién administra sus tarifas.
 *
 * Ojo con no confundir esto con `Envio.tipo_logistica_abastecimiento`: aquél
 * decide dónde se recibe el stock comprado, éste qué pasa cuando se vende.
 */
class FulfillmentService {
  static async tiendaDe(usuarioId) {
    const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId } });
    if (!tienda) throw errorHttp('Todavía no tenés una tienda creada.', 404);
    return tienda;
  }

  /**
   * Proveedores logísticos de la red, con cuánta cobertura tiene cada uno.
   *
   * No son couriers: un courier pertenece a un comercio y entrega los pedidos
   * de ese comercio. Estos operan la red de Gesicomm y se administran desde
   * Fulfillment. La resolución es una sola para todos, no una por proveedor.
   */
  static async proveedoresDeGesicomm() {
    const proveedores = await ProveedorLogistico.findAll({
      where: { activo: true },
      order: [['nombre', 'ASC']],
    });
    if (proveedores.length === 0) return [];

    const opciones = await TarifaDelivery.resolverOpcionesDeRed({
      proveedorIds: proveedores.map((p) => p.id),
    });

    const porProveedor = new Map();
    for (const opcion of opciones) {
      const lista = porProveedor.get(opcion.proveedor_id) || [];
      lista.push(opcion);
      porProveedor.set(opcion.proveedor_id, lista);
    }

    return proveedores.map((p) => {
      const propias = porProveedor.get(p.id) || [];
      return {
        id: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        ciudades: propias.length,
        costo_desde: propias.length ? Math.min(...propias.map((o) => o.costo)) : null,
      };
    });
  }

  /**
   * Todo lo que la pantalla de configuración necesita para que el comercio
   * elija con información: qué tiene hoy, qué depósitos puede usar y qué
   * cobertura ofrece cada opción.
   */
  static async obtenerConfiguracion(usuarioId) {
    const tienda = await this.tiendaDe(usuarioId);

    const [depositos, proveedoresGesicomm] = await Promise.all([
      Deposito.findAll({ where: { usuario_id: usuarioId, activo: true }, order: [['nombre', 'ASC']] }),
      this.proveedoresDeGesicomm(),
    ]);

    const couriersPorDeposito = await DepositoCourierService.couriersHabilitadosPorDeposito(
      depositos.map((d) => d.id),
    );
    const depositosConCouriers = depositos.map((d) => {
      const habilitados = couriersPorDeposito.get(d.id) || [];
      return {
        id: d.id,
        nombre: d.nombre,
        ciudad: d.ciudad,
        couriers_habilitados: habilitados.length,
        couriers: habilitados.map((c) => ({ id: c.id, nombre: c.nombre, alcance: c.alcance })),
      };
    });

    const costosGesicomm = proveedoresGesicomm.map((p) => p.costo_desde).filter((n) => n !== null);

    return {
      modalidad: tienda.modalidad_fulfillment,
      deposito_fulfillment_id: tienda.deposito_fulfillment_id,
      propia: {
        depositos: depositosConCouriers,
        // Sin depósito, o con un depósito sin couriers, la modalidad propia
        // no puede cotizar nada: conviene decirlo antes de que la elija.
        disponible: depositosConCouriers.some((d) => d.couriers_habilitados > 0),
      },
      gesicomm: {
        // A propósito no se listan los proveedores: quién hace la última
        // milla es operación interna de Gesicomm, no parte de lo que el
        // comercio contrata. Lo que necesita saber es si puede elegir la
        // modalidad y desde cuánto sale.
        disponible: proveedoresGesicomm.some((p) => p.ciudades > 0),
        costo_desde: costosGesicomm.length ? Math.min(...costosGesicomm) : null,
      },
    };
  }

  static async guardarConfiguracion(usuarioId, { modalidad, depositoId } = {}) {
    const tienda = await this.tiendaDe(usuarioId);

    const valor = String(modalidad || '').trim().toUpperCase();
    if (!MODALIDADES.includes(valor)) {
      throw errorHttp(`Modalidad inválida: "${modalidad}". Usá GESICOMM o PROPIA.`);
    }

    const cambios = { modalidad_fulfillment: valor };

    if (valor === 'PROPIA') {
      // El depósito se valida contra los del comercio: no alcanza con que
      // llegue un id en el body.
      const deposito = await Deposito.findOne({
        where: { id: depositoId, usuario_id: usuarioId, activo: true },
      });
      if (!deposito) {
        throw errorHttp('Elegí un depósito activo tuyo para despachar tus pedidos.');
      }

      const couriers = await DepositoCourierService.couriersHabilitados(deposito.id);
      if (couriers.length === 0) {
        throw errorHttp(
          `El depósito "${deposito.nombre}" no tiene couriers habilitados: no va a poder cotizar envíos. Habilitá al menos uno antes de usar logística propia.`,
        );
      }
      cambios.deposito_fulfillment_id = deposito.id;
    } else {
      const disponibles = await this.proveedoresDeGesicomm();
      if (!disponibles.some((p) => p.ciudades > 0)) {
        throw errorHttp('Gesicomm todavía no tiene cobertura configurada para gestionar tus entregas.');
      }
      // El depósito propio se conserva: si el comercio vuelve a PROPIA no
      // tiene que volver a elegirlo.
    }

    await tienda.update(cambios);
    return this.obtenerConfiguracion(usuarioId);
  }

  /**
   * Quién puede entregar un pedido de este comercio, según su modalidad: sus
   * couriers si despacha él, los proveedores de la red si despacha Gesicomm.
   */
  static async operadoresParaEntrega(usuarioId) {
    const tienda = await this.tiendaDe(usuarioId);

    if (tienda.modalidad_fulfillment === 'GESICOMM') {
      return ProveedorLogistico.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] });
    }
    if (!tienda.deposito_fulfillment_id) return [];
    return DepositoCourierService.couriersHabilitados(tienda.deposito_fulfillment_id);
  }

  /**
   * Cobertura y costo de entrega de un comercio, resueltos por su modalidad:
   *
   *   GESICOMM → centros de la red → proveedores logísticos → cobertura → tarifa
   *   PROPIA   → depósito configurado → couriers habilitados → cobertura → tarifa
   *
   * Fallback deliberado: si la modalidad es PROPIA y todavía no se eligió
   * depósito (o el elegido se quedó sin couriers), se devuelve la cobertura
   * completa del comercio, que es exactamente lo que el checkout hacía antes
   * de que existiera el fulfillment. Sin esto, cualquier comercio que no haya
   * entrado a configurar el depósito se quedaría de un día para el otro sin
   * ninguna opción de envío — es decir, sin poder vender.
   */
  static async resolverOpcionesDeEntrega(usuarioId, { paymentMethod = 'efectivo', items = [] } = {}) {
    if (!usuarioId) return [];

    const tienda = await Tienda.findOne({ where: { usuario_id: usuarioId } });
    const porUsuario = () => TarifaDelivery.resolverOpcionesDelivery(usuarioId, { paymentMethod, items });

    if (!tienda) return porUsuario();

    if (tienda.modalidad_fulfillment === 'GESICOMM') {
      // Sin acotar centros: hoy no existe una asignación comercio->centro, así
      // que la red se ofrece entera y gana el más barato por destino.
      const centros = await ProveedorLogisticoService.centrosActivos();
      return TarifaDelivery.resolverOpcionesDeRed(
        { centroIds: centros.map((c) => c.id) },
        { paymentMethod, items },
      );
    }

    if (tienda.deposito_fulfillment_id) {
      const couriers = await DepositoCourierService.couriersHabilitados(tienda.deposito_fulfillment_id);
      if (couriers.length > 0) {
        return TarifaDelivery.resolverOpcionesPorCouriers(couriers.map((c) => c.id), { paymentMethod, items });
      }
    }

    return porUsuario();
  }
}

module.exports = FulfillmentService;
