'use strict';

/**
 * Tests del motor de precios con ofertas de DOS precios (normal y
 * promocional de checkout). Motor puro: no toca DB ni Express.
 *
 * El caso que originó estos tests: un order bump de Gs 5.000 configurado
 * sobre un producto de Gs 222.222 hacía que el pedido entero se cobrara
 * 5.000, porque el bump reemplazaba la oferta del producto principal en vez
 * de sumarse como línea aparte, y porque la oferta tenía un solo `precio`.
 *
 * Ejecutar: npx jest src/services/pricing.ofertas.test.js --verbose
 */

const PricingService = require('./pricing.service');

const PRODUCTO = {
  id: 75,
  nombre: 'Aspiradora',
  precio_base: 222222,
  precio_minimo: null,
  descuento_porcentaje: 0,
  descuento_inicio: null,
  descuento_fin: null,
  cantidad_disponible: 10,
};

const BUMP = {
  id: 1,
  estrategia: 'order_bump',
  tipo_contenido: 'combo',
  producto_ancla_id: 75,
  precio_normal: 60000,
  precio_order_bump: 5000,
  precio: 60000,
  componentes: [{ producto_id: 178, cantidad: 1 }],
};

// Combo: se elige en la FICHA del producto (no en el checkout). Conserva un
// precio_order_bump de datos viejos a propósito, para verificar que ya no se
// cobra.
const COMBO_CHECKOUT = {
  id: 3,
  estrategia: 'combo',
  tipo_contenido: 'combo',
  producto_ancla_id: 75,
  precio_normal: 150000,
  precio_order_bump: 120000,
  precio: 150000,
  componentes: [{ producto_id: 75, cantidad: 1 }, { producto_id: 178, cantidad: 2 }],
};

const PACK_NORMAL = {
  id: 2,
  estrategia: 'normal',
  tipo_contenido: 'pack',
  producto_ancla_id: 75,
  precio_normal: 400000,
  precio_order_bump: null,
  precio: 400000,
  componentes: [{ producto_id: 75, cantidad: 2 }],
};

const OFERTAS = [BUMP, COMBO_CHECKOUT, PACK_NORMAL];

function resolver(extra = {}) {
  return PricingService.resolverPrecioItem({
    entidad: PRODUCTO,
    esCombo: false,
    cantidad: 1,
    ofertasDelProducto: OFERTAS,
    ...extra,
  });
}

describe('precioDeOferta — los dos precios de una oferta', () => {
  test('por canal normal cobra precio_normal, nunca el promocional', () => {
    expect(PricingService.precioDeOferta(BUMP, 'normal')).toEqual({ aplicado: 60000, normal: 60000 });
  });

  test('solo el order bump cobra el promocional', () => {
    expect(PricingService.precioDeOferta(BUMP, 'order_bump')).toEqual({ aplicado: 5000, normal: 60000 });
    // Un combo se elige en la ficha del producto, antes de comprar: siempre
    // se cobra su precio normal, aunque tuviera un promocional guardado de
    // cuando los combos vivían en el checkout.
    expect(PricingService.precioDeOferta(COMBO_CHECKOUT, 'combo')).toEqual({ aplicado: 150000, normal: 150000 });
  });

  test('sin promocional cargado cae al normal, no a 0', () => {
    const sinPromo = { ...BUMP, precio_order_bump: null };
    expect(PricingService.precioDeOferta(sinPromo, 'order_bump')).toEqual({ aplicado: 60000, normal: 60000 });
  });

  test('oferta anterior a la migración (solo `precio`) sigue resolviendo', () => {
    const vieja = { estrategia: 'order_bump', precio: 33000 };
    expect(PricingService.precioDeOferta(vieja, 'order_bump')).toEqual({ aplicado: 33000, normal: 33000 });
  });
});

describe('resolverOrigen — el canal sale de la oferta, no del cliente', () => {
  test('usa la estrategia configurada', () => {
    expect(PricingService.resolverOrigen(BUMP)).toBe('order_bump');
    expect(PricingService.resolverOrigen(COMBO_CHECKOUT)).toBe('combo');
    expect(PricingService.resolverOrigen(PACK_NORMAL)).toBe('normal');
  });

  test('una estrategia desconocida cae a normal', () => {
    expect(PricingService.resolverOrigen({ estrategia: 'inventada' })).toBe('normal');
    expect(PricingService.resolverOrigen(undefined)).toBe('normal');
  });
});

describe('resolverPrecioItem — el bump no puede pisar el precio normal', () => {
  test('la línea del producto sin oferta mantiene su precio de catálogo', () => {
    const r = resolver();
    expect(r.precio_unitario).toBe(222222);
    expect(r.precio_normal).toBe(222222);
    expect(r.origen_venta).toBe('normal');
  });

  test('la línea del bump se cobra al promocional y recuerda el normal', () => {
    const r = resolver({ ofertaId: BUMP.id });
    expect(r.precio_unitario).toBe(5000);
    expect(r.precio_normal).toBe(60000);
    expect(r.origen_venta).toBe('order_bump');
  });

  test('producto + bump en el mismo pedido = 222.222 + 5.000, no 5.000', () => {
    const principal = resolver();
    const bump = resolver({ ofertaId: BUMP.id });
    expect(principal.subtotal + bump.subtotal).toBe(227222);
  });

  test('un combo se cobra a su precio normal, no al promocional', () => {
    const r = resolver({ ofertaId: COMBO_CHECKOUT.id });
    expect(r.precio_unitario).toBe(150000);
    expect(r.precio_normal).toBe(150000);
    // El origen igual queda registrado: la reportería sigue pudiendo separar
    // una venta por combo de una venta suelta.
    expect(r.origen_venta).toBe('combo');
  });

  test('el pack normal se cobra al normal aunque exista un bump en el producto', () => {
    const r = resolver({ ofertaId: PACK_NORMAL.id, cantidad: 1 });
    expect(r.precio_unitario).toBe(400000);
    expect(r.precio_normal).toBe(400000);
    expect(r.origen_venta).toBe('normal');
  });

  test('auto-match por cantidad sigue eligiendo solo packs normales', () => {
    const r = resolver({ cantidad: 2 });
    expect(r.oferta_aplicada?.id).toBe(PACK_NORMAL.id);
    // El precio del pack es el total de las 2 unidades, así que el unitario
    // es la mitad — y el "normal" acompaña al unitario.
    expect(r.precio_unitario).toBe(200000);
    expect(r.precio_normal).toBe(200000);
    expect(r.origen_venta).toBe('normal');
  });

  test('una oferta de otro producto ancla no se aplica', () => {
    const ajena = { ...BUMP, id: 99, producto_ancla_id: 999 };
    const r = resolver({ ofertaId: 99, ofertasDelProducto: [ajena] });
    expect(r.oferta_aplicada).toBeNull();
    expect(r.precio_unitario).toBe(222222);
    expect(r.origen_venta).toBe('normal');
  });

  test('una variante no arrastra precio_normal de una oferta', () => {
    const variantes = [{ id: 5, nombre: 'XL', precio_diferencial: 10000, stock: 3 }];
    const r = resolver({ varianteId: 5, variantesDelProducto: variantes, ofertasDelProducto: [] });
    expect(r.precio_unitario).toBe(232222);
    expect(r.precio_normal).toBe(232222);
    expect(r.origen_venta).toBe('normal');
  });
});

describe('ofertaVigente — activo dice si existe, las fechas si está corriendo', () => {
  const hoy = '2026-09-15';
  const base = { activo: true, fecha_inicio: null, fecha_fin: null };

  test('sin fechas, siempre vigente', () => {
    expect(PricingService.ofertaVigente(base, hoy)).toBe(true);
  });

  test('inactiva nunca es vigente, tenga las fechas que tenga', () => {
    expect(PricingService.ofertaVigente({ ...base, activo: false }, hoy)).toBe(false);
  });

  test('antes de empezar y después de terminar, no', () => {
    expect(PricingService.ofertaVigente({ ...base, fecha_inicio: '2026-09-16' }, hoy)).toBe(false);
    expect(PricingService.ofertaVigente({ ...base, fecha_fin: '2026-09-14' }, hoy)).toBe(false);
  });

  test('los extremos entran (una promo "hasta el 15" vale todo el 15)', () => {
    expect(PricingService.ofertaVigente({ ...base, fecha_inicio: hoy }, hoy)).toBe(true);
    expect(PricingService.ofertaVigente({ ...base, fecha_fin: hoy }, hoy)).toBe(true);
  });

  test('acepta fechas con hora, comparando solo el día', () => {
    expect(PricingService.ofertaVigente({ ...base, fecha_fin: '2026-09-15T00:00:00.000Z' }, hoy)).toBe(true);
  });

  test('una oferta vencida no se cobra ni mandando su oferta_id a mano', () => {
    // resolverPrecioItem compara contra la fecha real de hoy, así que la
    // ventana tiene que estar en el pasado de verdad para no depender de
    // cuándo se corra el test.
    const vencido = { ...PACK_NORMAL, fecha_inicio: '2020-01-01', fecha_fin: '2020-01-31' };
    const r = PricingService.resolverPrecioItem({
      entidad: PRODUCTO, esCombo: false, cantidad: 1, ofertaId: PACK_NORMAL.id,
      ofertasDelProducto: [vencido],
    });
    expect(r.oferta_aplicada).toBeNull();
    expect(r.precio_unitario).toBe(222222);
  });

  test('una oferta futura tampoco se aplica todavía', () => {
    const futura = { ...PACK_NORMAL, fecha_inicio: '2099-01-01' };
    const r = PricingService.resolverPrecioItem({
      entidad: PRODUCTO, esCombo: false, cantidad: 2, ofertasDelProducto: [futura],
    });
    expect(r.oferta_aplicada).toBeNull();
  });
});
