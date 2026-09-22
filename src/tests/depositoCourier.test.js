/**
 * depositoCourier.service — qué couriers puede despachar cada depósito.
 *
 * Lo que se verifica es la regla de ownership, que es lo único que separa la
 * configuración de un comercio de la de otro: el depósito tiene que ser
 * suyo, y el courier tiene que ser suyo o de Gesicomm. El backend no puede
 * confiar en los ids que manda el frontend.
 *
 * Los modelos se simulan en memoria: la base real es la de PRODUCCIÓN detrás
 * de un túnel (ver src/config/database).
 */

jest.mock('../models', () => {
  const almacen = { depositos: [], couriers: [], vinculos: [], siguienteId: 1 };

  const coincide = (registro, where = {}) => Object.entries(where).every(([clave, valor]) => {
    if (valor === undefined) return true;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      // Único operador que usa el servicio: Op.or, con su símbolo.
      return true;
    }
    if (clave === 'id') return registro.id === Number(valor);
    return registro[clave] === valor;
  });

  return {
    __almacen: almacen,
    sequelize: {
      transaction: async (fn) => fn({}),
      fn: () => 'COUNT',
      col: () => 'id',
    },
    Deposito: {
      findOne: async ({ where } = {}) => almacen.depositos.find((d) => coincide(d, where)) || null,
    },
    Courier: {
      // El servicio filtra por { activo, usuario_id }: sólo los del comercio.
      // Los operadores de la red son proveedores logísticos y no entran acá.
      findAll: async ({ where } = {}) => almacen.couriers.filter((c) => coincide(c, where)),
    },
    DepositoCourier: {
      findAll: async ({ where } = {}) => almacen.vinculos.filter((v) => coincide(v, where)),
      bulkCreate: async (filas) => {
        const creadas = filas.map((f) => ({ id: almacen.siguienteId++, ...f }));
        almacen.vinculos.push(...creadas);
        return creadas;
      },
      destroy: async ({ where } = {}) => {
        const antes = almacen.vinculos.length;
        almacen.vinculos = almacen.vinculos.filter((v) => !coincide(v, where));
        return antes - almacen.vinculos.length;
      },
    },
    DeliveryZonaTarifa: {
      findAll: async () => [],
    },
  };
});

const Svc = require('../services/depositoCourier.service');
const { __almacen } = require('../models');

const COMERCIO = 1;
const OTRO_COMERCIO = 2;
const ADMIN = 99;

beforeEach(() => {
  __almacen.depositos = [
    { id: 10, usuario_id: COMERCIO, nombre: 'Luque', ciudad: 'Luque', activo: true },
    { id: 20, usuario_id: OTRO_COMERCIO, nombre: 'Ajeno', ciudad: 'Asunción', activo: true },
  ];
  __almacen.couriers = [
    { id: 1, usuario_id: COMERCIO, nombre: 'Mi courier', activo: true },
    { id: 2, usuario_id: OTRO_COMERCIO, nombre: 'Courier ajeno', activo: true },
    { id: 3, usuario_id: ADMIN, nombre: 'Courier del admin', activo: true },
    { id: 4, usuario_id: COMERCIO, nombre: 'Mi courier inactivo', activo: false },
    { id: 5, usuario_id: COMERCIO, nombre: 'Mi segundo courier', activo: true },
  ];
  __almacen.vinculos = [];
  __almacen.siguienteId = 1;
});

describe('couriersDisponibles', () => {
  it('ofrece exclusivamente los couriers del comercio', async () => {
    // Antes esta lista mezclaba los propios con los de Gesicomm, como si
    // fueran lo mismo. Los operadores de la red son proveedores logísticos,
    // se administran desde Fulfillment y no se vinculan al depósito de nadie.
    const ids = (await Svc.couriersDisponibles(COMERCIO)).map((c) => c.id);

    expect(ids).toContain(1); // propio
    expect(ids).not.toContain(2); // de otro comercio
    expect(ids).not.toContain(3); // del admin: sigue siendo de otro comercio
    expect(ids).not.toContain(4); // propio pero inactivo
  });
});

describe('depositoDelUsuario', () => {
  it('rechaza con 404 el depósito de otro comercio', async () => {
    await expect(Svc.depositoDelUsuario(20, COMERCIO)).rejects.toMatchObject({ status: 404 });
  });
});

describe('reemplazar', () => {
  it('vincula los couriers permitidos y les asigna prioridad por orden', async () => {
    await Svc.reemplazar(10, COMERCIO, [5, 1]);

    expect(__almacen.vinculos).toHaveLength(2);
    expect(__almacen.vinculos.find((v) => v.courier_id === 5)).toMatchObject({ prioridad: 0, activo: true });
    expect(__almacen.vinculos.find((v) => v.courier_id === 1)).toMatchObject({ prioridad: 1 });
  });

  it('rechaza con 403 el courier de otro comercio', async () => {
    await expect(Svc.reemplazar(10, COMERCIO, [2])).rejects.toMatchObject({ status: 403 });
    expect(__almacen.vinculos).toHaveLength(0);
  });

  it('rechaza con 403 un courier inactivo', async () => {
    await expect(Svc.reemplazar(10, COMERCIO, [4])).rejects.toMatchObject({ status: 403 });
  });

  it('no deja vincular nada contra un depósito ajeno', async () => {
    await expect(Svc.reemplazar(20, COMERCIO, [1])).rejects.toMatchObject({ status: 404 });
    expect(__almacen.vinculos).toHaveLength(0);
  });

  it('el borrado está acotado al depósito: no toca los vínculos de otro', async () => {
    __almacen.vinculos = [{ id: 99, deposito_id: 20, courier_id: 2, prioridad: 0, activo: true }];

    await Svc.reemplazar(10, COMERCIO, [1]);

    expect(__almacen.vinculos.find((v) => v.deposito_id === 20)).toBeTruthy();
    expect(__almacen.vinculos.filter((v) => v.deposito_id === 10)).toHaveLength(1);
  });

  it('con lista vacía deja el depósito sin couriers', async () => {
    await Svc.reemplazar(10, COMERCIO, [1]);
    await Svc.reemplazar(10, COMERCIO, []);

    expect(__almacen.vinculos.filter((v) => v.deposito_id === 10)).toHaveLength(0);
  });

  it('ignora ids repetidos y basura', async () => {
    await Svc.reemplazar(10, COMERCIO, [1, 1, 0, -3, null, 'x']);

    expect(__almacen.vinculos).toHaveLength(1);
    expect(__almacen.vinculos[0].courier_id).toBe(1);
  });
});
