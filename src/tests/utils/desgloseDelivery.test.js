const { desgloseDelivery } = require('../../utils/desgloseDelivery');

/**
 * Esta regla la comparten dos módulos que mueven plata real —el dashboard de
 * rentabilidad y el motor de rendición con couriers— y tienen que llegar al
 * mismo número sobre el mismo pedido. Por eso se prueba sin base: son cuentas
 * puras, y un cambio silencioso acá descuadra una rendición.
 */
describe('desgloseDelivery', () => {
  // Pedido cargado a mano: el modal arma `monto = subtotales + costo_envio`,
  // así que el flete viaja DENTRO del monto.
  const manual = {
    monto: 199000,
    costo_envio: 30000,
    cupon_descuento: 0,
    delivery_a_cargo: 'cliente',
    items: [{ subtotal: 169000 }],
  };

  // Pedido del checkout público: `monto` son solo los productos y al cliente
  // se le cobra `monto + costo_envio` aparte.
  const checkout = {
    monto: 166138,
    costo_envio: 50000,
    cupon_descuento: 0,
    delivery_a_cargo: 'cliente',
    items: [{ subtotal: 166138 }],
  };

  describe('separar producto de flete', () => {
    it('saca del monto el flete que viaja adentro', () => {
      // Sin esto el producto facturaba Gs 199.000 cuando su precio era 169.000.
      expect(desgloseDelivery(manual).venta_producto).toBe(169000);
    });

    it('deja el monto intacto cuando el flete va por fuera', () => {
      expect(desgloseDelivery(checkout).venta_producto).toBe(166138);
    });

    it('descuenta el cupón antes de comparar, para no leerlo como flete', () => {
      const conCupon = { ...manual, monto: 179000, cupon_descuento: 20000 };
      // productos 169.000 − cupón 20.000 = 149.000; monto 179.000 ⇒ 30.000 de flete
      expect(desgloseDelivery(conCupon).venta_producto).toBe(149000);
    });

    it('nunca descubre más flete del que el pedido tuvo', () => {
      // Un ajuste manual que sube el monto es VENTA, no flete: se acota al
      // costo_envio real para no inventar plata de paso.
      const ajustado = { ...manual, monto: 250000 };
      const d = desgloseDelivery(ajustado);
      expect(d.envio_en_monto).toBe(30000);
      expect(d.venta_producto).toBe(220000);
    });

    it('sin líneas con precio asume que todo el monto es producto', () => {
      const sinItems = { ...manual, items: [] };
      expect(desgloseDelivery(sinItems).venta_producto).toBe(199000);
    });
  });

  describe('quién paga el flete', () => {
    it('a cargo del cliente: es plata de paso, no cuesta nada', () => {
      const d = desgloseDelivery(manual);
      expect(d.envio_cobrado).toBe(30000);
      expect(d.envio_absorbido).toBe(0);
    });

    it('a cargo del negocio: es costo de venta', () => {
      const d = desgloseDelivery({ ...checkout, delivery_a_cargo: 'negocio' });
      expect(d.envio_cobrado).toBe(0);
      expect(d.envio_absorbido).toBe(50000);
      // La venta del producto no cambia: quién paga el flete no mueve el precio.
      expect(d.venta_producto).toBe(166138);
    });

    it('NULL (pedido anterior a la columna) se lee como cliente', () => {
      // El pasado no se backfilleó a propósito: la regla deducida daba 45/143
      // contra 'cliente' sobre la base entera. Leerlo como 'cliente' mantiene
      // los reportes históricos en el mismo número.
      const d = desgloseDelivery({ ...manual, delivery_a_cargo: null });
      expect(d.delivery_a_cargo).toBe('cliente');
      expect(d.envio_absorbido).toBe(0);
    });

    it('el ejemplo del negocio: venta 100.000, delivery 15.000 a su cargo', () => {
      const d = desgloseDelivery({
        monto: 100000,
        costo_envio: 15000,
        cupon_descuento: 0,
        delivery_a_cargo: 'negocio',
        items: [{ subtotal: 100000 }],
      });
      const costoProducto = 60000;
      expect(d.venta_producto - costoProducto - d.envio_absorbido).toBe(25000);
    });
  });

  describe('cuánto recibió el courier en la mano (rendición)', () => {
    const enManoDelCourier = (e) => e.monto + desgloseDelivery(e).envio_fuera_del_monto;

    it('pedido manual: el monto ya trae el flete', () => {
      expect(enManoDelCourier(manual)).toBe(199000);
    });

    it('pedido del checkout: hay que sumarle el flete que se cobró aparte', () => {
      // Este era el bug: la rendición usaba `monto` pelado y le quitaba al
      // comercio exactamente el valor del envío en cada pedido de este tipo.
      expect(enManoDelCourier(checkout)).toBe(216138);
    });

    it('si el flete lo paga el negocio, el cliente no le entrega nada extra', () => {
      expect(enManoDelCourier({ ...checkout, delivery_a_cargo: 'negocio' })).toBe(166138);
    });

    it('cobró 149.000 con 49.000 de flete: al comercio le corresponden 100.000', () => {
      const pedido = {
        monto: 149000,
        costo_envio: 49000,
        cupon_descuento: 0,
        delivery_a_cargo: 'cliente',
        items: [{ subtotal: 100000 }],
      };
      expect(enManoDelCourier(pedido) - pedido.costo_envio).toBe(100000);
    });
  });

  /**
   * El formulario de carga manual manda UN solo dato: el tilde "Incluye
   * delivery". Tildado significa que el envío va incluido en lo que ofrece el
   * negocio, o sea que lo paga el negocio y no se le cobra al cliente.
   *
   * Estos dos casos son exactamente los payloads que arma NuevoPedidoModal,
   * y son el contrato entre esa pantalla y toda la reportería: si el modal
   * cambia cómo calcula el monto, esto se rompe acá y no en la rentabilidad
   * de fin de mes.
   */
  describe('contrato con el formulario de carga manual', () => {
    const productos = 100000;
    const flete = 15000;

    it('SIN tildar: el flete se suma al total y no le cuesta nada al negocio', () => {
      const d = desgloseDelivery({
        monto: productos + flete, // el modal se lo suma al cliente
        costo_envio: flete,
        cupon_descuento: 0,
        delivery_a_cargo: 'cliente',
        items: [{ subtotal: productos }],
      });
      expect(d.venta_producto).toBe(productos);
      expect(d.envio_absorbido).toBe(0);
    });

    it('TILDADO: el total son solo los productos y el flete es costo de venta', () => {
      const d = desgloseDelivery({
        monto: productos, // el modal NO se lo suma al cliente
        costo_envio: flete,
        cupon_descuento: 0,
        delivery_a_cargo: 'negocio',
        items: [{ subtotal: productos }],
      });
      expect(d.venta_producto).toBe(productos);
      expect(d.envio_absorbido).toBe(flete);
    });

    it('el tilde no cambia la venta del producto, solo a quién se le cobra', () => {
      const base = { costo_envio: flete, cupon_descuento: 0, items: [{ subtotal: productos }] };
      const cobrado = desgloseDelivery({ ...base, monto: productos + flete, delivery_a_cargo: 'cliente' });
      const absorbido = desgloseDelivery({ ...base, monto: productos, delivery_a_cargo: 'negocio' });
      expect(cobrado.venta_producto).toBe(absorbido.venta_producto);
      // Y la diferencia entre los dos escenarios es exactamente el flete.
      const utilidad = (d) => d.venta_producto - 60000 - d.envio_absorbido;
      expect(utilidad(cobrado) - utilidad(absorbido)).toBe(flete);
    });
  });

  it('tolera un pedido sin ningún dato de plata', () => {
    const d = desgloseDelivery({});
    expect(d.venta_producto).toBe(0);
    expect(d.envio_cobrado).toBe(0);
    expect(d.envio_absorbido).toBe(0);
  });
});
