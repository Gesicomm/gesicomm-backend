/**
 * proveedorLogistico.service — los operadores de la red de Gesicomm.
 *
 * Lo que importa verificar acá es la frontera: que un proveedor no se cuelgue
 * del depósito privado de un comercio, que sus tarifas nunca lleven usuario ni
 * courier —porque si lo llevaran aparecerían en el checkout de ese usuario— y
 * que el borrado de cobertura esté acotado al par centro+proveedor, no al
 * proveedor solo.
 */

jest.mock('../models', () => {
  const almacen = { proveedores: [], depositos: [], vinculos: [], zonas: [], siguienteId: 1 };

  const coincide = (registro, where = {}) => Object.entries(where).every(([clave, valor]) => {
    if (valor === undefined) return true;
    if (clave === 'id') return registro.id === Number(valor);
    return registro[clave] === valor;
  });

  const instancia = (registro, coleccion) => {
    if (!registro) return null;
    const inst = {
      ...registro,
      update: async (cambios) => {
        Object.entries(cambios).forEach(([k, v]) => { registro[k] = v; inst[k] = v; });
        return inst;
      },
      destroy: async () => {
        if (!coleccion) return;
        const i = almacen[coleccion].indexOf(registro);
        if (i >= 0) almacen[coleccion].splice(i, 1);
      },
    };
    return inst;
  };

  return {
    __almacen: almacen,
    sequelize: { transaction: async (fn) => fn({}) },
    ProveedorLogistico: {
      CAPACIDADES: [
        'RETIRO_EN_PROVEEDOR', 'CROSS_DOCKING', 'ALMACENAMIENTO',
        'TRASLADO_ENTRE_CENTROS', 'ENTREGA_A_DEPOSITO_COMERCIO', 'ULTIMA_MILLA',
      ],
      TIPOS: ['TRANSPORTADORA', 'OPERADOR_ULTIMA_MILLA', 'FLOTA_PROPIA'],
      findAll: async ({ where } = {}) => almacen.proveedores.filter((p) => coincide(p, where)),
      findByPk: async (id) => instancia(almacen.proveedores.find((p) => p.id === Number(id)), 'proveedores'),
      create: async (datos) => {
        const fila = { id: almacen.siguienteId++, ...datos };
        almacen.proveedores.push(fila);
        return instancia(fila);
      },
    },
    Deposito: {
      findOne: async ({ where } = {}) => instancia(almacen.depositos.find((d) => coincide(d, where))),
      findAll: async ({ where } = {}) => almacen.depositos.filter((d) => coincide(d, where)),
    },
    CentroProveedorLogistico: {
      findOne: async ({ where } = {}) => instancia(almacen.vinculos.find((v) => coincide(v, where))),
      findAll: async ({ where } = {}) => almacen.vinculos.filter((v) => coincide(v, where)),
      destroy: async ({ where } = {}) => {
        const antes = almacen.vinculos.length;
        almacen.vinculos = almacen.vinculos.filter((v) => !coincide(v, where));
        return antes - almacen.vinculos.length;
      },
      findOrCreate: async ({ where, defaults }) => {
        const existente = almacen.vinculos.find((v) => coincide(v, where));
        if (existente) return [instancia(existente), false];
        const fila = { id: almacen.siguienteId++, ...where, ...defaults };
        almacen.vinculos.push(fila);
        return [instancia(fila), true];
      },
    },
    DeliveryZonaTarifa: {
      findAll: async ({ where } = {}) => almacen.zonas.filter((z) => coincide(z, where)),
      bulkCreate: async (filas) => {
        const creadas = filas.map((f) => ({ id: almacen.siguienteId++, ...f }));
        almacen.zonas.push(...creadas);
        return creadas;
      },
      destroy: async ({ where } = {}) => {
        const antes = almacen.zonas.length;
        almacen.zonas = almacen.zonas.filter((z) => !coincide(z, where));
        return antes - almacen.zonas.length;
      },
    },
    Ciudad: {},
    Departamento: {},
  };
});

const Svc = require('../services/proveedorLogistico.service');
const { __almacen } = require('../models');

const CENTRO = 3;
const CENTRO_2 = 4;
const DEPOSITO_PRIVADO = 10;

beforeEach(() => {
  jest.clearAllMocks();
  __almacen.proveedores = [{ id: 1, nombre: 'Transportadora XYZ', activo: true, tipo: 'TRANSPORTADORA', capacidades: [] }];
  __almacen.depositos = [
    { id: CENTRO, nombre: 'Centro Luque', alcance: 'GESICOMM', activo: true },
    { id: CENTRO_2, nombre: 'Centro CDE', alcance: 'GESICOMM', activo: true },
    { id: DEPOSITO_PRIVADO, nombre: 'Depósito del comercio', alcance: 'PROPIO', activo: true, usuario_id: 7 },
  ];
  __almacen.vinculos = [];
  __almacen.zonas = [];
  __almacen.siguienteId = 100;
});

describe('capacidades', () => {
  it('deduplica: el CHECK de Postgres es de subconjunto y acepta repetidos', () => {
    expect(Svc.normalizarCapacidades(['CROSS_DOCKING', 'CROSS_DOCKING', 'ULTIMA_MILLA']))
      .toEqual(['CROSS_DOCKING', 'ULTIMA_MILLA']);
  });

  it('rechaza una capacidad inventada', () => {
    expect(() => Svc.normalizarCapacidades(['TELETRANSPORTE'])).toThrow(/desconocida/i);
  });

  it('acepta minúsculas y espacios, que es lo que manda un formulario', () => {
    expect(Svc.normalizarCapacidades([' cross_docking '])).toEqual(['CROSS_DOCKING']);
  });
});

describe('vincularACentro', () => {
  it('rechaza un depósito privado de un comercio', async () => {
    // Si esto pasara, un proveedor de la red quedaría colgando de
    // infraestructura que no es de Gesicomm.
    await expect(Svc.vincularACentro(DEPOSITO_PRIVADO, 1)).rejects.toMatchObject({ status: 404 });
    expect(__almacen.vinculos).toHaveLength(0);
  });

  it('rechaza un centro inexistente', async () => {
    await expect(Svc.vincularACentro(999, 1)).rejects.toMatchObject({ status: 404 });
  });

  it('es idempotente: vincular dos veces deja un solo vínculo', async () => {
    await Svc.vincularACentro(CENTRO, 1);
    await Svc.vincularACentro(CENTRO, 1);

    expect(__almacen.vinculos).toHaveLength(1);
  });

  it('reactiva un vínculo dado de baja en vez de duplicarlo', async () => {
    await Svc.vincularACentro(CENTRO, 1);
    await Svc.desvincularDeCentro(CENTRO, 1);
    expect(__almacen.vinculos[0].activo).toBe(false);

    await Svc.vincularACentro(CENTRO, 1);

    expect(__almacen.vinculos).toHaveLength(1);
    expect(__almacen.vinculos[0].activo).toBe(true);
  });
});

describe('reemplazarCobertura', () => {
  const regla = (ciudad, costo) => ({ ciudad, costo, rango_min: 1, rango_max: 10 });

  it('escribe las reglas sin usuario ni courier', async () => {
    // Es lo que las mantiene fuera del checkout de cualquier comercio,
    // incluido el del admin que las creó.
    await Svc.reemplazarCobertura(CENTRO, 1, [regla('Luque', 15000)]);

    expect(__almacen.zonas).toHaveLength(1);
    expect(__almacen.zonas[0]).toMatchObject({
      usuario_id: null,
      courier_id: null,
      proveedor_logistico_id: 1,
      centro_id: CENTRO,
      ciudad: 'Luque',
      costo: 15000,
    });
  });

  it('el borrado se acota al par centro+proveedor', async () => {
    // El mismo proveedor cobra distinto desde cada centro. Borrar por
    // proveedor se llevaría puestas las tarifas del otro centro, que es justo
    // la distinción que el modelo existe para preservar.
    await Svc.reemplazarCobertura(CENTRO, 1, [regla('Encarnación', 30000)]);
    await Svc.reemplazarCobertura(CENTRO_2, 1, [regla('Encarnación', 18000)]);

    await Svc.reemplazarCobertura(CENTRO, 1, [regla('Encarnación', 32000)]);

    const desdeLuque = __almacen.zonas.filter((z) => z.centro_id === CENTRO);
    const desdeCde = __almacen.zonas.filter((z) => z.centro_id === CENTRO_2);
    expect(desdeLuque).toHaveLength(1);
    expect(desdeLuque[0].costo).toBe(32000);
    expect(desdeCde).toHaveLength(1);
    expect(desdeCde[0].costo).toBe(18000);
  });

  it('una regla sin ciudad no se guarda a medias: falla el guardado', async () => {
    await expect(Svc.reemplazarCobertura(CENTRO, 1, [regla('', 1000)]))
      .rejects.toMatchObject({ status: 400 });
    expect(__almacen.zonas).toHaveLength(0);
  });

  it('no deja cargar cobertura contra un depósito privado', async () => {
    await expect(Svc.reemplazarCobertura(DEPOSITO_PRIVADO, 1, [regla('Luque', 15000)]))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('crear', () => {
  it('exige nombre', async () => {
    await expect(Svc.crear({ nombre: '  ' })).rejects.toMatchObject({ status: 400 });
  });

  it('rechaza un tipo inventado', async () => {
    await expect(Svc.crear({ nombre: 'X', tipo: 'DRON' })).rejects.toMatchObject({ status: 400 });
  });

  it('nace sin dueño: un proveedor de la red no es de ningún comercio', async () => {
    const proveedor = await Svc.crear({ nombre: 'Nueva', capacidades: ['ULTIMA_MILLA'] });

    expect(proveedor.usuario_id).toBeUndefined();
    expect(proveedor.capacidades).toEqual(['ULTIMA_MILLA']);
  });
});

describe('eliminar', () => {
  const regla = (ciudad, costo) => ({ ciudad, costo, rango_min: 1, rango_max: 10 });

  it('sin cobertura se borra directo', async () => {
    await Svc.eliminar(1);

    expect(__almacen.proveedores).toHaveLength(0);
  });

  it('con cobertura se niega y dice cuántas tarifas se perderían', async () => {
    // Borrar arrastra las tarifas por cascada. Ese número tiene que salir
    // ANTES, no descubrirse cuando la red dejó de cotizar esas ciudades.
    await Svc.reemplazarCobertura(CENTRO, 1, [regla('Luque', 15000), regla('Areguá', 18000)]);

    await expect(Svc.eliminar(1)).rejects.toMatchObject({
      status: 409,
      reglas: { total: 2, centros: 1 },
    });
    expect(__almacen.proveedores).toHaveLength(1);
    expect(__almacen.zonas).toHaveLength(2);
  });

  it('forzando se lleva también sus tarifas y sus vínculos', async () => {
    await Svc.vincularACentro(CENTRO, 1);
    await Svc.reemplazarCobertura(CENTRO, 1, [regla('Luque', 15000)]);

    const resultado = await Svc.eliminar(1, { forzar: true });

    expect(resultado).toMatchObject({ eliminado: true, reglas_borradas: 1 });
    expect(__almacen.proveedores).toHaveLength(0);
    expect(__almacen.zonas).toHaveLength(0);
    expect(__almacen.vinculos).toHaveLength(0);
  });

  it('desactivar no borra nada: es la salida para sacarlo de circulación', async () => {
    await Svc.reemplazarCobertura(CENTRO, 1, [regla('Luque', 15000)]);

    await Svc.actualizar(1, { activo: false });

    expect(__almacen.proveedores[0].activo).toBe(false);
    expect(__almacen.zonas).toHaveLength(1);
  });
});
