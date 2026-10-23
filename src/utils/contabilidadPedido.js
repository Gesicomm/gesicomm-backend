'use strict';

const { desgloseDelivery } = require('./desgloseDelivery');

/**
 * Reglas contables de UN pedido, compartidas por el Dashboard General
 * (pedidosAnalyticsService), Control Financiero (costoGasto.service) y los
 * reportes del Dashboard Operativo. Cada pantalla tiene que llegar al mismo
 * número sobre el mismo pedido; si cada una hiciera su cuenta, se despegan
 * (pasó: la tarjeta de Rentabilidad y el gráfico daban ganancias distintas
 * para el mismo período).
 *
 * Auditoría del 2026-10-23 — lo que se corrigió y por qué:
 *
 * 1. ENVÍO NETO. "Ventas netas" es solo producto (sin el delivery). Si del
 *    otro lado se resta el flete COMPLETO pagado al courier, el delivery que
 *    pagó el cliente se cuenta como gasto pero nunca como ingreso, y la
 *    ganancia queda subestimada en exactamente ese importe. El costo de
 *    envío del negocio es lo que pagó al courier MENOS lo que le cobró al
 *    cliente por el delivery.
 *
 * 2. COMISIÓN SOBRE LO COBRADO. La pasarela cobra su % sobre todo lo que
 *    pagó el cliente, delivery incluido. En el checkout de la landing el
 *    delivery viaja fuera del `monto` (ver desgloseDelivery): calcular la
 *    comisión sobre el `monto` pelado la subestimaba.
 *
 * 3. PEDIDOS FALLIDOS. Un pedido devuelto o perdido no tiene venta, pero sí
 *    costo: el viaje del courier y la mercadería que se perdió o volvió
 *    dañada. Como la rentabilidad solo miraba pedidos entregados, esa plata
 *    no restaba en ningún lado.
 */

const montoNumero = (v) => Number(v) || 0;

/** Todo lo que pagó el cliente: el monto más el delivery cobrado aparte. */
function cobroTotalCliente(e) {
  return montoNumero(e.monto) + montoNumero(desgloseDelivery(e).envio_fuera_del_monto);
}

/** Lo que el cliente pagó de delivery, esté adentro o afuera del monto. */
function deliveryCobradoAlCliente(e) {
  const d = desgloseDelivery(e);
  return montoNumero(d.envio_en_monto) + montoNumero(d.envio_fuera_del_monto);
}

/** Lo que el envío le costó al negocio: courier menos lo que cobró de delivery. */
function costoEnvioNeto(e) {
  return Math.max(0, montoNumero(e.costo_envio) - deliveryCobradoAlCliente(e));
}

/** Comisión de la pasarela / POS sobre lo que efectivamente se cobró. */
function comisionDelPedido(e) {
  return cobroTotalCliente(e) * (montoNumero(e.comision_pct_aplicada) / 100);
}

/**
 * Mercadería perdida de una línea: unidades perdidas o devueltas DAÑADAS,
 * valuadas a lo que costaron. Lo devuelto en buen estado vuelve al stock y
 * no es pérdida.
 */
function perdidaDeItem(item) {
  let unidades = 0;
  let importe = 0;
  for (const comp of item.componentes_vendidos || []) {
    const perdidas = (comp.cantidad_perdida || 0) + (comp.cantidad_devuelta_danada || 0);
    if (perdidas <= 0) continue;
    unidades += perdidas;
    importe += perdidas * (Number(comp.costo_unitario) || 0);
  }
  return { unidades, importe };
}

const ESTADOS_FALLIDOS_CON_COSTO = ['devuelto', 'perdido', 'no entregado', 'fallido'];

/**
 * Lo que le costó al negocio un pedido que no se entregó.
 *
 * - envio: el viaje del courier (se le paga aunque el pedido vuelva).
 * - mercaderia: lo perdido o devuelto dañado, a costo.
 * - recupero: si el pedido se perdió y se le cargó al courier, el cargo
 *   (valor de venta − su servicio, ver registrarPerdidaComponentes). Como
 *   ese cargo ya descuenta el servicio, el envío no se resta otra vez.
 *
 * Cancelados y rechazados no entran: no salieron, y su `costo_envio` es la
 * tarifa estimada al cargar el pedido, no un viaje que se haya pagado.
 */
function costoPedidoFallido(e) {
  const st = String(e.estado || '').toLowerCase();
  if (!ESTADOS_FALLIDOS_CON_COSTO.includes(st)) return { envio: 0, mercaderia: 0, recupero: 0, total: 0 };

  const mercaderia = (e.items || []).reduce((acc, item) => acc + perdidaDeItem(item).importe, 0);
  const conCargoAlCourier = st === 'perdido' && e.cargo_perdida_courier !== null && e.cargo_perdida_courier !== undefined;
  const envio = conCargoAlCourier ? 0 : montoNumero(e.costo_envio);
  const recupero = conCargoAlCourier ? montoNumero(e.cargo_perdida_courier) : 0;
  return { envio, mercaderia, recupero, total: envio + mercaderia - recupero };
}

module.exports = {
  cobroTotalCliente,
  deliveryCobradoAlCliente,
  costoEnvioNeto,
  comisionDelPedido,
  perdidaDeItem,
  costoPedidoFallido,
};
