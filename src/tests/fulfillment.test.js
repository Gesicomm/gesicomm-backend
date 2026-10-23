/**
 * fulfillment.service — cómo entrega el comercio lo que vende.
 *
 * Lo que importa verificar es que la configuración de entregas no mezcle
 * conceptos: la modalidad no exige elegir un depósito global. El origen
 * del stock y el courier se deciden en el flujo de pedidos.
 */

jest.mock('../models', () => {
  const almacen = { tiendas: [], depositos: [], proveedores: [] };

  const coincide = (registro, where = {}) => Object.entries(where).every(([clave, valor]) => {
    if (valor === undefined) return true;
    if (clave === 'id') return registro.id === Number(valor);
    return registro[clave] === valor;
  });

  const comoInstancia = (registro) => {
    if (!registro) return null;
    const instancia = {
      ...registro,
      update: async (cambios) => {
        Object.entries(cambios).forEach(([k, v]) => { registro[k] = v; instancia[k] = v; });
        return instancia;
      },
    };
    return instancia;
  };

  return {
    __almacen: almacen,
    Tienda: { findOne: async ({ where } = {}) => comoInstancia(almacen.tiendas.find((t) => coincide(t, where))) },
    Deposito: {
      findOne: async ({ where } = {}) => almacen.depositos.find((d) => coincide(d, where)) || null,
      findAll: async ({ where } = {}) => almacen.depositos.filter((d) => coincide(d, where)),
    },
    ProveedorLogistico: {
      findAll: async ({ where } = {}) => almacen.proveedores.filter((p) => coincide(p, where)),
    },
  };
});

jest.mock('../services/depositoCourier.service', () => ({
  couriersHabilitados: jest.fn(async () => []),
  couriersHabilitadosPorDeposito: jest.fn(async () => new Map()),
}));

jest.mock('../services/tarifaDelivery.service', () => ({
  resolverOpcionesDelivery: jest.fn(async () => []),
  resolverOpcionesPorCouriers: jest.fn(async () => []),
  resolverOpcionesDeRed: jest.fn(async () => []),
}));

jest.mock('../services/proveedorLogistico.service', () => ({
  centrosActivos: jest.fn(async () => []),
  proveedoresComercialesGesicomm: jest.fn(async () => []),
}));

const Fulfillment = require('../services/fulfillment.service');
const DepositoCourierService = require('../services/depositoCourier.service');
const TarifaDelivery = require('../services/tarifaDelivery.service');
const ProveedorLogisticoService = require('../services/proveedorLogistico.service');
const { __almacen } = require('../models');

const COMERCIO = 1;

beforeEach(() => {
  // Sin esto los contadores de llamadas se arrastran de un test al otro y
  // las aserciones de "no se llamó" pasan a ser falsos negativos.
  jest.clearAllMocks();
  __almacen.tiendas = [{ id: 1, usuario_id: COMERCIO, nombre: 'Tienda', modalidad_fulfillment: 'PROPIA', deposito_fulfillment_id: null }];
  __almacen.depositos = [
    { id: 10, usuario_id: COMERCIO, tienda_id: 1, nombre: 'Luque', ciudad: 'Luque', activo: true },
    { id: 11, usuario_id: COMERCIO, tienda_id: 1, nombre: 'Sin couriers', ciudad: 'Asunción', activo: true },
    { id: 20, usuario_id: 2, tienda_id: 9, nombre: 'Ajeno', ciudad: 'Encarnación', activo: true },
    // Misma cuenta, OTRA tienda: no es un depósito de la tienda 1.
    { id: 30, usuario_id: COMERCIO, tienda_id: 2, nombre: 'De mi otra tienda', ciudad: 'Asunción', activo: true },
  ];
  __almacen.proveedores = [];
  // Sólo el depósito 10 tiene couriers; el 11 existe pero está vacío.
  const couriersDe = (id) => (Number(id) === 10 ? [{ id: 5, nombre: 'Mi courier', alcance: 'PROPIO' }] : []);
  DepositoCourierService.couriersHabilitados.mockImplementation(async (id) => couriersDe(id));
  DepositoCourierService.couriersHabilitadosPorDeposito.mockImplementation(
    async (ids) => new Map((ids || []).map((id) => [Number(id), couriersDe(id)])),
  );
  TarifaDelivery.resolverOpcionesDelivery.mockResolvedValue([]);
  TarifaDelivery.resolverOpcionesPorCouriers.mockResolvedValue([]);
  TarifaDelivery.resolverOpcionesDeRed.mockResolvedValue([]);
  ProveedorLogisticoService.centrosActivos.mockResolvedValue([{ id: 3, nombre: 'Centro Luque' }]);
  ProveedorLogisticoService.proveedoresComercialesGesicomm.mockImplementation(async () => __almacen.proveedores);
});

const tienda = () => __almacen.tiendas[0];

describe('obtenerConfiguracion', () => {
  it('marca la modalidad propia como disponible si hay al menos un depósito activo', async () => {
    const cfg = await Fulfillment.obtenerConfiguracion(COMERCIO);

    expect(cfg.propia.disponible).toBe(true);
    expect(cfg.propia.total_depositos).toBe(2);
    expect(cfg.propia.depositos).toEqual([]);
  });

  it('cuenta solo los depósitos de la tienda, no los de otras tiendas de la cuenta', async () => {
    const cfg = await Fulfillment.obtenerConfiguracion(COMERCIO, 1);

    expect(cfg.propia.total_depositos).toBe(2);
  });

  it('sin proveedores de la red, esa modalidad no está disponible', async () => {
    const cfg = await Fulfillment.obtenerConfiguracion(COMERCIO);

    expect(cfg.gesicomm.disponible).toBe(false);
    expect(cfg.gesicomm.costo_desde).toBeNull();
  });

  it('informa el costo más barato de la red cuando hay cobertura', async () => {
    __almacen.proveedores = [{ id: 7, nombre: 'Transportadora XYZ', activo: true, tipo: 'TRANSPORTADORA' }];
    TarifaDelivery.resolverOpcionesDeRed.mockResolvedValue([
      { proveedor_id: 7, ciudad: 'Luque', costo: 20000 },
      { proveedor_id: 7, ciudad: 'Encarnación', costo: 40000 },
      { proveedor_id: 99, ciudad: 'Otra', costo: 1000 }, // de otro proveedor: no cuenta
    ]);

    const cfg = await Fulfillment.obtenerConfiguracion(COMERCIO);

    expect(cfg.gesicomm.disponible).toBe(true);
    expect(cfg.gesicomm.costo_desde).toBe(20000);
  });

  it('no le dice al comercio qué proveedores usa la red', async () => {
    // Quién hace la última milla es operación interna de Gesicomm, no parte
    // de lo que el comercio contrata.
    __almacen.proveedores = [{ id: 7, nombre: 'Transportadora XYZ', activo: true }];
    TarifaDelivery.resolverOpcionesDeRed.mockResolvedValue([{ proveedor_id: 7, ciudad: 'Luque', costo: 20000 }]);

    const cfg = await Fulfillment.obtenerConfiguracion(COMERCIO);

    expect(cfg.gesicomm.proveedores).toBeUndefined();
    expect(cfg.gesicomm.couriers).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain('Transportadora XYZ');
  });
});

describe('guardarConfiguracion', () => {
  it('rechaza una modalidad inventada', async () => {
    await expect(Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'OTRA' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it.each([undefined, null])('propia guarda sin depósito global (%s) y limpia la referencia anterior', async (depositoId) => {
    tienda().modalidad_fulfillment = 'GESICOMM';
    tienda().deposito_fulfillment_id = 10;
    await Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA', depositoId });
    expect(tienda().modalidad_fulfillment).toBe('PROPIA');
    expect(tienda().deposito_fulfillment_id).toBeNull();
  });

  it('sin depósitos activos propios no permite activar envíos propios', async () => {
    __almacen.depositos = __almacen.depositos.filter((d) => d.tienda_id !== 1);
    await expect(Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('propia exige un depósito del comercio', async () => {
    await expect(Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA', depositoId: 20 }))
      .rejects.toMatchObject({ status: 400 });
    expect(tienda().deposito_fulfillment_id).toBeNull();
  });

  it('propia rechaza el depósito de otra tienda de la misma cuenta', async () => {
    await expect(Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA', depositoId: 30 }, 1))
      .rejects.toMatchObject({ status: 400 });
    expect(tienda().deposito_fulfillment_id).toBeNull();
  });

  it('propia permite un depósito aunque no tenga couriers habilitados', async () => {
    await Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA', depositoId: 11 });

    expect(tienda().modalidad_fulfillment).toBe('PROPIA');
    expect(tienda().deposito_fulfillment_id).toBe(11);
  });

  it('propia guarda el depósito elegido', async () => {
    await Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA', depositoId: 10 });

    expect(tienda().modalidad_fulfillment).toBe('PROPIA');
    expect(tienda().deposito_fulfillment_id).toBe(10);
  });

  it('gesicomm se rechaza mientras no haya cobertura', async () => {
    await expect(Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'GESICOMM' }))
      .rejects.toMatchObject({ status: 400 });
    expect(tienda().modalidad_fulfillment).toBe('PROPIA');
  });

  it('al pasar a gesicomm elimina la referencia de depósito anterior', async () => {
    __almacen.proveedores = [{ id: 7, nombre: 'Transportadora XYZ', activo: true }];
    TarifaDelivery.resolverOpcionesDeRed.mockResolvedValue([{ proveedor_id: 7, ciudad: 'Luque', costo: 20000 }]);

    await Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA', depositoId: 10 });
    await Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'GESICOMM' });

    expect(tienda().modalidad_fulfillment).toBe('GESICOMM');
    expect(tienda().deposito_fulfillment_id).toBeNull();
  });
});

describe('operadoresParaEntrega', () => {
  it('con modalidad propia usa los couriers de sus depósitos', async () => {
    await Fulfillment.guardarConfiguracion(COMERCIO, { modalidad: 'PROPIA', depositoId: 10 });

    const operadores = await Fulfillment.operadoresParaEntrega(COMERCIO);

    expect(operadores.map((c) => c.nombre)).toEqual(['Mi courier']);
  });

  it('con modalidad propia y sin depósito elegido incluye los couriers de sus depósitos', async () => {
    const operadores = await Fulfillment.operadoresParaEntrega(COMERCIO);

    expect(operadores.map((c) => c.nombre)).toEqual(['Mi courier']);
    expect(DepositoCourierService.couriersHabilitadosPorDeposito).toHaveBeenCalledWith([10, 11]);
  });

  it('con modalidad gesicomm usa proveedores de la red, no couriers', async () => {
    __almacen.proveedores = [{ id: 7, nombre: 'Transportadora XYZ', activo: true }];
    tienda().modalidad_fulfillment = 'GESICOMM';

    const operadores = await Fulfillment.operadoresParaEntrega(COMERCIO);

    expect(operadores.map((c) => c.nombre)).toEqual(['Transportadora XYZ']);
  });
});

describe('resolverOpcionesDeEntrega', () => {
  // Lo que ve el checkout. El riesgo grande acá no es cobrar de más, es
  // quedarse sin ninguna opción de envío: eso deja al comercio sin vender.
  it('con modalidad gesicomm cotiza con los centros de la red, no con couriers', async () => {
    __almacen.proveedores = [{ id: 7, nombre: 'RAHA', activo: true }];
    tienda().modalidad_fulfillment = 'GESICOMM';

    await Fulfillment.resolverOpcionesDeEntrega(COMERCIO, { paymentMethod: 'efectivo' });

    expect(TarifaDelivery.resolverOpcionesDeRed).toHaveBeenCalledWith(
      { centroIds: [3], proveedorIds: [7] },
      expect.anything(),
    );
    expect(TarifaDelivery.resolverOpcionesPorCouriers).not.toHaveBeenCalled();
    expect(TarifaDelivery.resolverOpcionesDelivery).not.toHaveBeenCalled();
  });

  it('con modalidad propia ignora la referencia antigua y ofrece toda su cobertura', async () => {
    tienda().deposito_fulfillment_id = 10;

    await Fulfillment.resolverOpcionesDeEntrega(COMERCIO);

    expect(TarifaDelivery.resolverOpcionesDelivery).toHaveBeenCalledWith(COMERCIO, expect.anything());
    expect(TarifaDelivery.resolverOpcionesPorCouriers).not.toHaveBeenCalled();
  });

  it('sin depósito configurado cae a la cobertura completa del comercio', async () => {
    // Fallback que protege a quien todavía no configuró nada: sin esto se
    // quedaría sin ninguna opción de envío en el checkout.
    await Fulfillment.resolverOpcionesDeEntrega(COMERCIO);

    expect(TarifaDelivery.resolverOpcionesDelivery).toHaveBeenCalledWith(COMERCIO, expect.anything());
    expect(TarifaDelivery.resolverOpcionesPorCouriers).not.toHaveBeenCalled();
  });

  it('si el depósito configurado se quedó sin couriers, también cae al fallback', async () => {
    tienda().deposito_fulfillment_id = 11; // ese depósito no tiene couriers

    await Fulfillment.resolverOpcionesDeEntrega(COMERCIO);

    expect(TarifaDelivery.resolverOpcionesDelivery).toHaveBeenCalledWith(COMERCIO, expect.anything());
  });

  it('un usuario sin tienda sigue cotizando con su propia cobertura', async () => {
    __almacen.tiendas = [];

    await Fulfillment.resolverOpcionesDeEntrega(COMERCIO);

    expect(TarifaDelivery.resolverOpcionesDelivery).toHaveBeenCalledWith(COMERCIO, expect.anything());
  });
});
