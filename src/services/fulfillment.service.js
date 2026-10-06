'use strict';

const { Op } = require('sequelize');
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
 *   PROPIA   → despacha desde un depósito suyo. El courier se decide en el
 *              pedido, igual que el flujo operativo de Pedidos → Delivery.
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
  // tiendaId es la tienda activa de la sesión (req.usuario.tiendaId): con
  // 2+ tiendas de una cuenta, modalidad_fulfillment y deposito_fulfillment_id
  // son por tienda, no por cuenta — sin tiendaId se cae a "la" tienda del
  // usuario solo como compatibilidad para cuentas de una sola tienda.
  static async tiendaDe(usuarioId, tiendaId = null) {
    const tienda = tiendaId
      ? await Tienda.findOne({ where: { id: tiendaId, usuario_id: usuarioId } })
      : await Tienda.findOne({ where: { usuario_id: usuarioId } });
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

  static normalizarFiltroTexto(valor) {
    const texto = String(valor || '').trim();
    return texto || null;
  }

  static depositoConCouriers(d, couriersPorDeposito) {
    const habilitados = couriersPorDeposito.get(d.id) || [];
    return {
      id: d.id,
      nombre: d.nombre,
      ciudad: d.ciudad,
      departamento: d.departamento,
      direccion: d.direccion,
      couriers_habilitados: habilitados.length,
      couriers: habilitados.map((c) => ({ id: c.id, nombre: c.nombre, alcance: c.alcance })),
    };
  }

  static filtroCouriersSubquery(usuarioId, modo) {
    const usuarioSeguro = Number(usuarioId) || 0;
    const subquery = `
      SELECT dc.deposito_id
      FROM deposito_courier dc
      INNER JOIN couriers c ON c.id = dc.courier_id
      WHERE dc.activo = true
        AND c.activo = true
        AND c.usuario_id = ${usuarioSeguro}
    `;

    if (modo === 'con_couriers') return { [Op.in]: Deposito.sequelize.literal(`(${subquery})`) };
    if (modo === 'sin_couriers') return { [Op.notIn]: Deposito.sequelize.literal(`(${subquery})`) };
    return null;
  }

  static async opcionesFiltrosDepositos(usuarioId) {
    const base = { usuario_id: usuarioId, activo: true };
    const [ciudades, departamentos] = await Promise.all([
      Deposito.findAll({
        where: { ...base, ciudad: { [Op.ne]: null } },
        attributes: ['ciudad'],
        group: ['ciudad'],
        order: [['ciudad', 'ASC']],
        raw: true,
      }),
      Deposito.findAll({
        where: { ...base, departamento: { [Op.ne]: null } },
        attributes: ['departamento'],
        group: ['departamento'],
        order: [['departamento', 'ASC']],
        raw: true,
      }),
    ]);

    return {
      ciudades: ciudades.map((r) => r.ciudad).filter(Boolean),
      departamentos: departamentos.map((r) => r.departamento).filter(Boolean),
    };
  }

  static async listarDepositosPropios(usuarioId, payload = {}) {
    const filtros = payload.filtros || payload.filters || {};
    const buscar = this.normalizarFiltroTexto(payload.buscar || filtros.buscar);
    const ciudad = this.normalizarFiltroTexto(payload.ciudad || filtros.ciudad);
    const departamento = this.normalizarFiltroTexto(payload.departamento || filtros.departamento);
    const estadoCouriers = String(payload.estadoCouriers || filtros.estadoCouriers || 'todos').trim();
    const depositoSeleccionadoId = Number(payload.depositoSeleccionadoId || payload.seleccionadoId || 0) || null;

    const page = Math.max(1, parseInt(payload.page, 10) || 1);
    const limit = Math.min(30, Math.max(1, parseInt(payload.limit, 10) || 6));
    const offset = (page - 1) * limit;

    const where = { usuario_id: usuarioId, activo: true };
    if (ciudad) where.ciudad = ciudad;
    if (departamento) where.departamento = departamento;
    if (buscar) {
      const term = `%${buscar}%`;
      where[Op.or] = [
        { nombre: { [Op.iLike]: term } },
        { ciudad: { [Op.iLike]: term } },
        { departamento: { [Op.iLike]: term } },
        { direccion: { [Op.iLike]: term } },
        { referencia: { [Op.iLike]: term } },
      ];
    }

    const filtroCouriers = this.filtroCouriersSubquery(usuarioId, estadoCouriers);
    if (filtroCouriers) where.id = filtroCouriers;

    const [{ count, rows }, opcionesFiltros] = await Promise.all([
      Deposito.findAndCountAll({
        where,
        order: [['nombre', 'ASC']],
        limit,
        offset,
      }),
      this.opcionesFiltrosDepositos(usuarioId),
    ]);

    const ids = rows.map((d) => d.id);
    const couriersPorDeposito = await DepositoCourierService.couriersHabilitadosPorDeposito(ids);
    let seleccionado = null;

    if (depositoSeleccionadoId && !ids.includes(depositoSeleccionadoId)) {
      const deposito = await Deposito.findOne({
        where: { id: depositoSeleccionadoId, usuario_id: usuarioId, activo: true },
      });
      if (deposito) {
        const couriersSeleccionado = await DepositoCourierService.couriersHabilitadosPorDeposito([deposito.id]);
        seleccionado = this.depositoConCouriers(deposito, couriersSeleccionado);
      }
    }

    return {
      data: rows.map((d) => this.depositoConCouriers(d, couriersPorDeposito)),
      seleccionado,
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      filtros: opcionesFiltros,
    };
  }

  /**
   * Todo lo que la pantalla de configuración necesita para que el comercio
   * elija con información: qué tiene hoy, qué depósitos puede usar y qué
   * cobertura ofrece cada opción.
   */
  static async obtenerConfiguracion(usuarioId, tiendaId = null) {
    const tienda = await this.tiendaDe(usuarioId, tiendaId);

    const [depositos, proveedoresGesicomm] = await Promise.all([
      Deposito.findAll({
        where: { usuario_id: usuarioId, activo: true },
        attributes: ['id'],
        order: [['nombre', 'ASC']],
      }),
      this.proveedoresDeGesicomm(),
    ]);

    const totalDepositos = depositos.length;

    const costosGesicomm = proveedoresGesicomm.map((p) => p.costo_desde).filter((n) => n !== null);

    return {
      modalidad: tienda.modalidad_fulfillment,
      deposito_fulfillment_id: tienda.deposito_fulfillment_id,
      propia: {
        depositos: [],
        total_depositos: totalDepositos,
        disponible: totalDepositos > 0,
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

  static async guardarConfiguracion(usuarioId, { modalidad, depositoId } = {}, tiendaId = null) {
    const tienda = await this.tiendaDe(usuarioId, tiendaId);

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
    return this.obtenerConfiguracion(usuarioId, tiendaId);
  }

  /**
   * Quién puede entregar un pedido de este comercio, según su modalidad: sus
   * couriers si despacha él, los proveedores de la red si despacha Gesicomm.
   */
  static async operadoresParaEntrega(usuarioId, tiendaId = null) {
    const tienda = await this.tiendaDe(usuarioId, tiendaId);

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
