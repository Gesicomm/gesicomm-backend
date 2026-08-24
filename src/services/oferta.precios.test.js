'use strict';

/**
 * Tests de la normalización de precios de una Oferta — la mitad de escritura
 * de la regla "configurar el order bump no puede pisar el precio normal".
 * La mitad de lectura (qué precio se cobra) vive en pricing.ofertas.test.js.
 *
 * Ejecutar: npx jest src/services/oferta.precios.test.js --verbose
 */

const OfertaService = require('./oferta.service');

describe('normalizarPrecios', () => {
  test('una oferta normal guarda solo el precio normal', () => {
    expect(OfertaService.normalizarPrecios({ estrategia: 'normal', precio_normal: 120000 }))
      .toEqual({ precio_normal: 120000, precio_order_bump: null, precio: 120000 });
  });

  test('una oferta de checkout guarda los dos precios por separado', () => {
    expect(OfertaService.normalizarPrecios({ estrategia: 'order_bump', precio_normal: 60000, precio_order_bump: 5000 }))
      .toEqual({ precio_normal: 60000, precio_order_bump: 5000, precio: 60000 });
  });

  test('un combo de checkout también admite promocional propio', () => {
    expect(OfertaService.normalizarPrecios({ estrategia: 'combo', precio_normal: 150000, precio_order_bump: 120000 }))
      .toEqual({ precio_normal: 150000, precio_order_bump: 120000, precio: 150000 });
  });

  test('editar el promocional NO toca el precio normal ya guardado', () => {
    const actual = { estrategia: 'order_bump', precio_normal: 222222, precio_order_bump: 5000 };
    expect(OfertaService.normalizarPrecios({ precio_order_bump: 9000 }, actual))
      .toEqual({ precio_normal: 222222, precio_order_bump: 9000, precio: 222222 });
  });

  test('editar el normal NO toca el promocional ya guardado', () => {
    const actual = { estrategia: 'order_bump', precio_normal: 222222, precio_order_bump: 5000 };
    expect(OfertaService.normalizarPrecios({ precio_normal: 250000 }, actual))
      .toEqual({ precio_normal: 250000, precio_order_bump: 5000, precio: 250000 });
  });

  test('promocional vacío se guarda como null (se cobra el normal), no como 0', () => {
    expect(OfertaService.normalizarPrecios({ estrategia: 'order_bump', precio_normal: 60000, precio_order_bump: '' }))
      .toEqual({ precio_normal: 60000, precio_order_bump: null, precio: 60000 });
  });

  test('pasar una oferta de checkout a estrategia normal borra el promocional', () => {
    const actual = { estrategia: 'order_bump', precio_normal: 60000, precio_order_bump: 5000 };
    expect(OfertaService.normalizarPrecios({ estrategia: 'normal' }, actual))
      .toEqual({ precio_normal: 60000, precio_order_bump: null, precio: 60000 });
  });

  test('un payload viejo con `precio` a secas sigue funcionando', () => {
    expect(OfertaService.normalizarPrecios({ estrategia: 'normal', precio: 99000 }))
      .toEqual({ precio_normal: 99000, precio_order_bump: null, precio: 99000 });
  });

  test('los precios negativos se recortan a 0', () => {
    expect(OfertaService.normalizarPrecios({ estrategia: 'order_bump', precio_normal: -5, precio_order_bump: -10 }))
      .toEqual({ precio_normal: 0, precio_order_bump: 0, precio: 0 });
  });
});

describe('resolverTipoContenido', () => {
  test('la estrategia combo fuerza contenido de combo', () => {
    expect(OfertaService.resolverTipoContenido('combo', 'pack')).toBe('combo');
  });

  test('el resto respeta lo pedido', () => {
    expect(OfertaService.resolverTipoContenido('normal', 'pack')).toBe('pack');
    expect(OfertaService.resolverTipoContenido('order_bump', 'combo')).toBe('combo');
  });

  test('sin tipo pedido conserva el que ya tenía la oferta', () => {
    expect(OfertaService.resolverTipoContenido('normal', undefined, { tipo_contenido: 'combo' })).toBe('combo');
  });

  test('sin nada cae a pack', () => {
    expect(OfertaService.resolverTipoContenido('normal', undefined)).toBe('pack');
  });
});

describe('validarPayload', () => {
  const base = { codigo: 'X', nombre: 'Y', precio_normal: 1000 };

  test('acepta la estrategia combo', () => {
    expect(() => OfertaService.validarPayload({ ...base, estrategia: 'combo' })).not.toThrow();
  });

  test('rechaza una estrategia inventada', () => {
    expect(() => OfertaService.validarPayload({ ...base, estrategia: 'nope' })).toThrow(/estrategia inválida/);
  });

  test('rechaza un promocional negativo', () => {
    expect(() => OfertaService.validarPayload({ ...base, precio_order_bump: -1 })).toThrow(/order bump no puede ser negativo/);
  });

  test('acepta promocional null', () => {
    expect(() => OfertaService.validarPayload({ ...base, precio_order_bump: null })).not.toThrow();
  });
});
