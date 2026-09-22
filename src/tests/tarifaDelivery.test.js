/**
 * tarifaDelivery.service — expansión de cobertura y prioridad.
 *
 * Lo que se fija acá es la regla de negocio que decide cuánto paga un
 * comprador:
 *
 *   1. Ciudad exacta
 *   2. Resto del departamento
 *   3. Resto del país
 *   4. Sin cobertura
 *
 * Una tarifa específica gana SIEMPRE sobre un fallback, incluso si el
 * fallback es más barato. Sin esa precedencia el motor elegiría el precio
 * menor y un comercio no podría cobrar distinto en una ciudad puntual.
 */

jest.mock('../models', () => {
  const almacen = { zonas: [], ciudades: [] };
  return {
    __almacen: almacen,
    Courier: {},
    DeliveryZonaTarifa: { findAll: async () => almacen.zonas },
    Departamento: {},
    Ciudad: {
      findAll: async () => almacen.ciudades,
    },
  };
});

const Tarifas = require('../services/tarifaDelivery.service');
const { __almacen } = require('../models');

const CENTRAL = { id: 1, nombre: 'Central', pais_id: 1 };
const ITAPUA = { id: 2, nombre: 'Itapúa', pais_id: 1 };

const ciudad = (id, nombre, depto) => ({
  id, nombre, departamento_id: depto.id, departamento: depto, activo: true,
});

const LUQUE = ciudad(10, 'Luque', CENTRAL);
const ITAUGUA = ciudad(11, 'Itauguá', CENTRAL);
const ENCARNACION = ciudad(20, 'Encarnación', ITAPUA);

const regla = (extra) => ({
  ciudad: null, departamento: null, tipo_pago: 'Ambos', rango_min: 0, rango_max: null,
  costo: 0, tiempo_entrega_hs: null, tiempo_entrega_min_hs: null, tiempo_entrega_max_hs: null,
  ciudad_id: null, departamento_id: null, pais_id: null, tipo_cobertura: null,
  courier: { id: 1, nombre: 'Courier', activo: true },
  ...extra,
});

beforeEach(() => {
  __almacen.zonas = [];
  __almacen.ciudades = [LUQUE, ITAUGUA, ENCARNACION];
});

const porCiudad = (opciones, nombre) => opciones.find((o) => o.ciudad === nombre);

describe('prioridad de cobertura', () => {
  beforeEach(() => {
    __almacen.zonas = [
      regla({ tipo_cobertura: 'CIUDAD', ciudad_id: LUQUE.id, ciudad: 'Luque', departamento: 'Central', costo: 15000 }),
      regla({ tipo_cobertura: 'RESTO_DEPARTAMENTO', departamento_id: CENTRAL.id, costo: 25000 }),
      regla({ tipo_cobertura: 'RESTO_PAIS', pais_id: 1, costo: 30000 }),
    ];
  });

  it('la ciudad con tarifa propia usa la suya, no el fallback', async () => {
    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(porCiudad(o, 'Luque')).toMatchObject({ costo: 15000, tipo_cobertura: 'CIUDAD' });
  });

  it('una ciudad del departamento sin tarifa propia cae al resto del departamento', async () => {
    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(porCiudad(o, 'Itauguá')).toMatchObject({ costo: 25000, tipo_cobertura: 'RESTO_DEPARTAMENTO' });
  });

  it('una ciudad de otro departamento cae al resto del país', async () => {
    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(porCiudad(o, 'Encarnación')).toMatchObject({ costo: 30000, tipo_cobertura: 'RESTO_PAIS' });
  });

  it('la tarifa específica gana aunque el fallback sea MÁS BARATO', async () => {
    // El desempate entre reglas del mismo nivel es por precio; entre niveles
    // distintos manda la precedencia. Si no, bastaría un resto de país barato
    // para pisar todas las tarifas puntuales del comercio.
    __almacen.zonas = [
      regla({ tipo_cobertura: 'CIUDAD', ciudad_id: LUQUE.id, ciudad: 'Luque', costo: 40000 }),
      regla({ tipo_cobertura: 'RESTO_PAIS', pais_id: 1, costo: 10000 }),
    ];

    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(porCiudad(o, 'Luque')).toMatchObject({ costo: 40000, tipo_cobertura: 'CIUDAD' });
    expect(porCiudad(o, 'Encarnación')).toMatchObject({ costo: 10000 });
  });

  it('cada ciudad aparece una sola vez aunque la alcancen varias reglas', async () => {
    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(o.filter((x) => x.ciudad === 'Luque')).toHaveLength(1);
    expect(o).toHaveLength(3); // Luque, Itauguá, Encarnación
  });
});

describe('alcance de la expansión', () => {
  it('resto de departamento sólo alcanza ciudades de ESE departamento', async () => {
    __almacen.zonas = [
      regla({ tipo_cobertura: 'RESTO_DEPARTAMENTO', departamento_id: CENTRAL.id, costo: 25000 }),
    ];

    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(o.map((x) => x.ciudad).sort()).toEqual(['Itauguá', 'Luque']);
    expect(porCiudad(o, 'Encarnación')).toBeUndefined();
  });

  it('un comercio sin fallbacks no expande nada: se comporta como antes', async () => {
    __almacen.zonas = [
      regla({ tipo_cobertura: 'CIUDAD', ciudad_id: LUQUE.id, ciudad: 'Luque', departamento: 'Central', costo: 15000 }),
    ];

    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ ciudad: 'Luque', costo: 15000 });
  });

  it('las coberturas legacy sin clasificar no se expanden ni se infieren', async () => {
    // "fernando" y "Central" siguen siendo texto: producen su propio destino
    // y no generan ciudades nuevas por inferencia.
    __almacen.zonas = [
      regla({ ciudad: 'fernando', costo: 27000 }),
      regla({ ciudad: 'Central', costo: 24000 }),
    ];

    const o = await Tarifas.resolverOpcionesDelivery(1);

    expect(o.map((x) => x.ciudad).sort()).toEqual(['Central', 'fernando']);
    expect(o.every((x) => x.ciudad_id === null)).toBe(true);
  });
});
