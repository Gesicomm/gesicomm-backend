'use strict';

const { Envio, EnvioItem, MetodoPago, Liquidacion, LiquidacionEnvio, Courier, sequelize } = require('../models');
const { Op } = require('sequelize');
const { registrarHistorial } = require('../utils/historial');
const { desgloseDelivery } = require('../utils/desgloseDelivery');

/**
 * Motor de rendición de couriers — ver plan Gestión de Pedidos, secciones
 * 30-36. Regla 2 del plan: el backend nunca confía en un saldo calculado
 * por el frontend — `previsualizar` y `confirmar` recalculan siempre desde
 * los pedidos reales, y `confirmar` vuelve a recalcular por su cuenta en
 * vez de aceptar el resultado de una `previsualizar` anterior.
 */

/**
 * Trae los pedidos elegibles para liquidar con un courier en un rango de
 * fechas: Entregado o Perdido, todavía pendiente_liquidacion. El costo del
 * servicio de courier se cobra siempre (Entregado o Perdido); el dinero en
 * poder del courier solo existe si el pedido fue Entregado y el método de
 * pago usado tiene custodia_cobro='courier' (si se perdió en tránsito,
 * nunca se llegó a cobrar nada).
 */
async function buscarEnviosElegibles(courier_id, fecha_desde, fecha_hasta, usuario_id, t) {
  return Envio.findAll({
    where: {
      usuario_id,
      courier_id,
      estado: { [Op.in]: ['Entregado', 'Perdido'] },
      estado_financiero: 'pendiente_liquidacion',
      dispatchedAt: { [Op.between]: [fecha_desde, fecha_hasta] },
    },
    include: [
      { model: MetodoPago, attributes: ['id', 'nombre', 'custodia_cobro'] },
      // Las líneas hacen falta para saber si el flete viaja adentro o
      // afuera del `monto` (ver desgloseDelivery). Sin ellas, un pedido del
      // checkout se liquida de menos por el valor del envío.
      { model: EnvioItem, as: 'items', attributes: ['id', 'cantidad', 'precio_unitario', 'subtotal'] },
    ],
    order: [['dispatchedAt', 'ASC'], ['id', 'ASC']],
    transaction: t,
  });
}

/** Calcula el desglose de liquidación sobre un conjunto ya cargado de Envio. */
function calcularDesglose(envios, ajuste_manual = 0) {
  let total_dinero_courier = 0;
  let total_costo_servicios = 0;
  let total_cargos_perdida = 0;

  const detalle = envios.map(e => {
    const monto = Number(e.monto || 0);
    const costo_envio = Number(e.costo_envio || 0);
    const cargo_perdida = Number(e.cargo_perdida_courier || 0);
    const custodia = e.MetodoPago ? e.MetodoPago.custodia_cobro : 'negocio';

    // Dinero en poder del courier: solo si hubo entrega real (Perdido no
    // cobra nada, se perdió antes de llegar al cliente) y el método de
    // pago usado deja el dinero en manos del courier.
    //
    // Lo que el cliente le entrega NO siempre es `monto`. Cuando el pedido
    // nace en el checkout público, `monto` son solo los productos y el
    // flete se cobra aparte (pagoParService: `amount = monto + costo_envio`),
    // así que el courier recibe `monto + flete`. Liquidar contra `monto`
    // pelado le quitaba al comercio exactamente el valor del envío en cada
    // pedido de ese tipo: con Gs 166.138 de producto y Gs 50.000 de flete,
    // el courier entregaba Gs 216.138 y la rendición calculaba como si
    // hubiera recibido Gs 166.138.
    const dv = desgloseDelivery(e);
    const cobrado_al_cliente = monto + dv.envio_fuera_del_monto;
    const dinero_courier = (e.estado === 'Entregado' && custodia === 'courier') ? cobrado_al_cliente : 0;

    total_dinero_courier += dinero_courier;
    total_costo_servicios += costo_envio;
    total_cargos_perdida += cargo_perdida;

    return {
      envio_id: e.id,
      cliente: e.cliente,
      fecha: e.dispatchedAt,
      estado: e.estado,
      metodo_pago: e.MetodoPago ? e.MetodoPago.nombre : null,
      custodia_cobro: custodia,
      monto,
      costo_envio,
      // Lo que el cliente efectivamente puso en la mano del courier, que es
      // el número que hay que poder contrastar contra el efectivo al rendir.
      cobrado_al_cliente,
      delivery_a_cargo: dv.delivery_a_cargo,
      cargo_perdida_courier: cargo_perdida,
      dinero_courier,
    };
  });

  const ajuste = Number(ajuste_manual || 0);
  const saldo_final = total_dinero_courier + total_cargos_perdida - total_costo_servicios + ajuste;

  let mensaje_saldo;
  if (saldo_final > 0) {
    mensaje_saldo = `El courier debe transferir a la tienda: Gs. ${saldo_final.toLocaleString('es-PY')}`;
  } else if (saldo_final < 0) {
    mensaje_saldo = `La tienda debe pagar al courier: Gs. ${Math.abs(saldo_final).toLocaleString('es-PY')}`;
  } else {
    mensaje_saldo = 'Liquidación equilibrada.';
  }

  return {
    total_dinero_courier,
    total_costo_servicios,
    total_cargos_perdida,
    ajuste_manual: ajuste,
    saldo_final,
    mensaje_saldo,
    cantidad_pedidos: envios.length,
    detalle,
  };
}

/** Previsualización — no persiste nada. */
async function previsualizar({ courier_id, fecha_desde, fecha_hasta, usuario_id, ajuste_manual = 0 }) {
  const envios = await buscarEnviosElegibles(courier_id, fecha_desde, fecha_hasta, usuario_id, null);
  return calcularDesglose(envios, ajuste_manual);
}

/**
 * Confirma y persiste la liquidación: crea Liquidacion + LiquidacionEnvio,
 * y pasa los pedidos incluidos a estado_financiero='liquidado'. Todo dentro
 * de una única transacción — si algo falla, no queda una liquidación
 * parcial (Regla 3/4 del plan).
 */
async function confirmar({ courier_id, fecha_desde, fecha_hasta, usuario_id, usuario_registro_id, ajuste_manual = 0, observacion = null }) {
  const t = await sequelize.transaction();
  try {
    const envios = await buscarEnviosElegibles(courier_id, fecha_desde, fecha_hasta, usuario_id, t);
    if (envios.length === 0) {
      throw new Error('No hay pedidos pendientes de liquidación para este courier en el rango seleccionado.');
    }

    const desglose = calcularDesglose(envios, ajuste_manual);

    const liquidacion = await Liquidacion.create({
      usuario_id,
      courier_id,
      fecha_desde,
      fecha_hasta,
      total_dinero_courier: desglose.total_dinero_courier,
      total_costo_servicios: desglose.total_costo_servicios,
      total_cargos_perdida: desglose.total_cargos_perdida,
      ajuste_manual: desglose.ajuste_manual,
      saldo_final: desglose.saldo_final,
      observacion,
      usuario_registro_id,
    }, { transaction: t });

    await LiquidacionEnvio.bulkCreate(
      envios.map(e => ({ liquidacion_id: liquidacion.id, envio_id: e.id })),
      { transaction: t }
    );

    const hoy = new Date().toISOString().split('T')[0];
    await Envio.update(
      { estado_financiero: 'liquidado', fecha_rendicion: hoy },
      { where: { id: { [Op.in]: envios.map(e => e.id) } }, transaction: t }
    );

    const codigoLiquidacion = `R-${String(liquidacion.id).padStart(4, '0')}`;
    for (const e of envios) {
      await registrarHistorial(e.id, usuario_registro_id, `Incluido en rendición #${codigoLiquidacion}`, t);
    }

    await t.commit();

    return Liquidacion.findByPk(liquidacion.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre'] },
        { model: LiquidacionEnvio, as: 'envios_incluidos' },
      ],
    });
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

/** Historial de liquidaciones de un courier — ver plan sección 36. */
async function listarPorCourier(courier_id, usuario_id) {
  return Liquidacion.findAll({
    where: { courier_id, usuario_id },
    include: [
      { model: Courier, attributes: ['id', 'nombre'] },
      { model: LiquidacionEnvio, as: 'envios_incluidos' },
    ],
    order: [['created_at', 'DESC']],
  });
}

module.exports = { previsualizar, confirmar, listarPorCourier };
