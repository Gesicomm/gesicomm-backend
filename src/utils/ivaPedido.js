'use strict';

const { desgloseDelivery } = require('./desgloseDelivery');

/**
 * IVA (10%) de un pedido que pidió factura. Una sola regla para Control
 * Financiero, el Dashboard General y el reporte de Facturación e IVA: antes
 * el dashboard multiplicaba siempre el monto × 10% e ignoraba la marca
 * "Precio incluye IVA" del producto, así que con precios con IVA incluido
 * (lo normal en Paraguay) inflaba el impuesto y no coincidía con Finanzas.
 *
 * - Producto con IVA incluido: el IVA ya está adentro del precio y se
 *   extrae (precio − precio / 1,10, es decir precio / 11).
 * - Producto sin IVA: se calcula 10% sobre el precio.
 *
 * La base es la venta de producto del pedido (sin el flete que viaje dentro
 * del monto, ver desgloseDelivery), repartida entre las líneas según su
 * subtotal para aplicar a cada una la marca de su producto.
 */
function montoNumero(valor) {
  return Math.round(Number(valor) || 0);
}

function ivaDesdeImporte(importe, impuestosIncluidos = true) {
  const n = Number(importe) || 0;
  if (n <= 0) return 0;
  return impuestosIncluidos === false ? n * 0.10 : n - (n / 1.10);
}

function calcularIvaFacturadoEnvio(envio) {
  if (!envio?.quiere_factura) return 0;
  const items = envio.items || [];
  const ventaProducto = montoNumero(desgloseDelivery(envio).venta_producto);
  const sumaSubtotales = items.reduce(
    (acc, item) => acc + montoNumero(item.subtotal || ((Number(item.precio_unitario) || 0) * (Number(item.cantidad) || 1))),
    0
  );
  if (!items.length || !sumaSubtotales) return Math.round(ivaDesdeImporte(ventaProducto, true));

  return Math.round(items.reduce((acc, item) => {
    const subtotal = montoNumero(item.subtotal || ((Number(item.precio_unitario) || 0) * (Number(item.cantidad) || 1)));
    const importeItem = ventaProducto * (subtotal / sumaSubtotales);
    const impuestosIncluidos = item.Producto?.impuestos_incluidos ?? true;
    return acc + ivaDesdeImporte(importeItem, impuestosIncluidos);
  }, 0));
}

module.exports = { ivaDesdeImporte, calcularIvaFacturadoEnvio };
