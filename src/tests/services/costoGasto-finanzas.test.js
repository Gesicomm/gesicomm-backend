const {
  calcularIvaFacturadoEnvio,
  dineroEnManoCourier,
  saldoCourierPorRendir,
} = require('../../services/costoGasto.service');

describe('reglas financieras de CostoGastoService', () => {
  describe('IVA estimado de pedidos facturados', () => {
    it('extrae el IVA cuando el producto ya lo incluye en el precio', () => {
      const envio = {
        quiere_factura: true,
        monto: 110000,
        costo_envio: 0,
        delivery_a_cargo: 'cliente',
        cupon_descuento: 0,
        items: [{
          cantidad: 1,
          precio_unitario: 110000,
          subtotal: 110000,
          Producto: { impuestos_incluidos: true },
        }],
      };

      expect(calcularIvaFacturadoEnvio(envio)).toBe(10000);
    });

    it('calcula 10% adicional cuando el producto no incluye IVA', () => {
      const envio = {
        quiere_factura: true,
        monto: 100000,
        costo_envio: 0,
        delivery_a_cargo: 'cliente',
        cupon_descuento: 0,
        items: [{
          cantidad: 1,
          precio_unitario: 100000,
          subtotal: 100000,
          Producto: { impuestos_incluidos: false },
        }],
      };

      expect(calcularIvaFacturadoEnvio(envio)).toBe(10000);
    });

    it('no estima IVA si el pedido no pidió factura', () => {
      expect(calcularIvaFacturadoEnvio({
        quiere_factura: false,
        monto: 110000,
        items: [{ subtotal: 110000, Producto: { impuestos_incluidos: true } }],
      })).toBe(0);
    });
  });

  describe('dinero pendiente de rendición courier', () => {
    const pedidoCheckout = {
      monto: 100000,
      costo_envio: 15000,
      delivery_a_cargo: 'cliente',
      cupon_descuento: 0,
      estado_financiero: 'pendiente_liquidacion',
      MetodoPago: { custodia_cobro: 'courier' },
      items: [{ subtotal: 100000 }],
    };

    it('suma el flete cobrado por fuera cuando el courier tiene la plata', () => {
      expect(dineroEnManoCourier(pedidoCheckout)).toBe(115000);
    });

    it('calcula el saldo neto que el courier debe rendir al negocio', () => {
      expect(saldoCourierPorRendir(pedidoCheckout)).toBe(100000);
    });

    it('no trata como caja retenida un pedido ya liquidado', () => {
      expect(dineroEnManoCourier({
        ...pedidoCheckout,
        estado_financiero: 'liquidado',
      })).toBe(0);
    });

    it('no trata como caja retenida un método custodiado por el negocio', () => {
      expect(dineroEnManoCourier({
        ...pedidoCheckout,
        MetodoPago: { custodia_cobro: 'negocio' },
      })).toBe(0);
    });
  });
});
