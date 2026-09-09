'use strict';

/**
 * Separa, para UN pedido, la plata que es del producto de la que es del
 * delivery, y cuánto de ese delivery lo puso el cliente y cuánto el negocio.
 *
 * Vive acá y no dentro de un servicio porque lo necesitan DOS módulos que no
 * se hablan entre sí y que tienen que dar el mismo número:
 *
 *   - `pedidosAnalyticsService` — para la rentabilidad del dashboard.
 *   - `liquidacion.service`     — para saber cuánta plata tiene el courier
 *                                 en la mano al momento de rendir.
 *
 * Si cada uno hiciera su propia cuenta, el dashboard y la rendición podrían
 * decir cosas distintas sobre el mismo pedido, y esa discusión se salda con
 * plata real.
 *
 * ── Las dos convenciones del `monto` ───────────────────────────────────
 *
 * El sistema guarda esta plata de dos formas según por dónde entró el pedido:
 *
 *   - Carga manual (NuevoPedidoModal): `monto = subtotales + costo_envio`.
 *     El flete viaja DENTRO del monto.
 *   - Checkout de la landing (landing.service.js/crearCheckout):
 *     `monto = subtotales − cupón`, y al cliente se le cobra
 *     `monto + costo_envio` aparte (ver pagoParService:
 *     `amount = monto + costo_envio`). El flete viaja FUERA del monto.
 *
 * `envio_en_monto` es la parte del flete que está adentro del monto. Es pura
 * aritmética sobre los subtotales de las líneas, no una inferencia.
 *
 * ── Quién paga ─────────────────────────────────────────────────────────
 *
 * Lo dice `envios.delivery_a_cargo`, no se deduce. Se intentó deducirlo del
 * hueco entre el monto y los ítems y la medición lo desmintió: la misma
 * regla daba 13/1 a favor de 'cliente' sobre los pedidos entregados y
 * 45/143 en contra sobre las 188 filas de la base.
 *
 * NULL (pedidos anteriores a la columna) se lee como 'cliente', que es la
 * regla normal del negocio.
 *
 * @param {object} e Envio con `items` cargados (necesita `subtotal` o
 *   `precio_unitario`+`cantidad` en cada línea para poder separar el flete
 *   que viaja dentro del monto).
 */
function desgloseDelivery(e) {
  const monto = Number(e.monto || 0);
  const costoEnvio = Number(e.costo_envio || 0);

  const sumaSubtotales = (e.items || []).reduce(
    (acc, it) => acc + Number(it.subtotal || (it.precio_unitario * (it.cantidad || 1)) || 0),
    0,
  );
  // Sin líneas con precio no hay con qué comparar: se asume que el monto es
  // todo producto antes que inventar un flete que no se puede probar.
  const baseProductos = sumaSubtotales > 0
    ? sumaSubtotales - Number(e.cupon_descuento || 0)
    : monto;

  // Se acota a [0, costo_envio] a propósito: la diferencia entre el monto y
  // los subtotales también puede venir de un ajuste manual al cerrar la
  // venta, y en ese caso es venta, no flete.
  const envioEnMonto = Math.min(Math.max(monto - baseProductos, 0), costoEnvio);

  const loPagaElNegocio = e.delivery_a_cargo === 'negocio';
  const envioCobrado = loPagaElNegocio ? 0 : costoEnvio;

  return {
    // Lo que el pedido facturó de PRODUCTO. Es la base de la rentabilidad.
    venta_producto: monto - envioEnMonto,
    // Lo que el cliente puso para el flete: plata de paso, ni venta ni costo.
    envio_cobrado: envioCobrado,
    // Lo que se le paga al courier.
    envio_pagado: costoEnvio,
    // Lo que puso el negocio: esto sí es un costo de venta.
    envio_absorbido: loPagaElNegocio ? costoEnvio : 0,
    // Cuánto del flete viaja adentro del `monto`.
    envio_en_monto: envioEnMonto,
    // Cuánto del flete el cliente paga POR FUERA del monto. Es lo que la
    // rendición tiene que sumarle a `monto` para saber cuánta plata recibió
    // realmente el courier de manos del cliente.
    envio_fuera_del_monto: Math.max(0, envioCobrado - envioEnMonto),
    delivery_a_cargo: loPagaElNegocio ? 'negocio' : 'cliente',
  };
}

module.exports = { desgloseDelivery };
