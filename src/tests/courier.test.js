/**
 * courierController — alta, listado y edición de couriers con sus tarifas.
 *
 * Antes esto abría una conexión real a Postgres, creaba couriers
 * "TEST_JEST_COURIER_*" y los borraba en cada beforeEach/afterEach. Esa
 * base es la de PRODUCCIÓN detrás de un túnel (ver src/config/database):
 * con el túnel abajo la suite fallaba entera, y con el túnel arriba
 * escribía y borraba filas reales.
 *
 * Ahora los modelos se simulan con un almacén en memoria que se comporta
 * como Sequelize en lo que el controller usa. Lo que se verifica sigue
 * siendo la lógica del controller —normalización de tarifas, el
 * "borrar y recrear" al editar, el 404 y el ámbito por usuario—, no si
 * Postgres persiste.
 */

jest.mock('../models', () => {
  const almacen = { couriers: [], tarifas: [], siguienteId: 1 };

  const tarifasDe = (courier_id) => almacen.tarifas.filter((t) => t.courier_id === courier_id);

  // Sequelize devuelve las tarifas incluidas cuando se pide `include`.
  const conTarifas = (c) => (c ? { ...c, tarifas: tarifasDe(c.id) } : null);

  // Instancia con .update(), que es lo que el controller llama. Igual que
  // Sequelize, un campo `undefined` no pisa el valor guardado.
  const comoInstancia = (registro) => (registro ? {
    ...registro,
    update: async (cambios) => {
      for (const [clave, valor] of Object.entries(cambios)) {
        if (valor !== undefined) registro[clave] = valor;
      }
      return registro;
    },
  } : null);

  const coincide = (registro, where = {}) => Object.entries(where).every(([clave, valor]) => {
    if (valor === undefined) return true;
    if (clave === 'id') return registro.id === Number(valor);
    return registro[clave] === valor;
  });

  return {
    __almacen: almacen,

    Courier: {
      create: async (datos) => {
        const registro = { id: almacen.siguienteId++, ...datos };
        almacen.couriers.push(registro);
        return comoInstancia(registro);
      },
      findAll: async ({ where } = {}) => almacen.couriers
        .filter((c) => coincide(c, where))
        .map(conTarifas),
      findByPk: async (id) => conTarifas(almacen.couriers.find((c) => c.id === Number(id))),
      findOne: async ({ where } = {}) => comoInstancia(almacen.couriers.find((c) => coincide(c, where))),
      destroy: async ({ where } = {}) => {
        const antes = almacen.couriers.length;
        almacen.couriers = almacen.couriers.filter((c) => !coincide(c, where));
        return antes - almacen.couriers.length;
      },
    },

    CourierTarifa: {
      create: async (datos) => {
        const registro = { id: almacen.siguienteId++, ...datos };
        almacen.tarifas.push(registro);
        return registro;
      },
      bulkCreate: async (filas) => {
        const creadas = filas.map((f) => ({ id: almacen.siguienteId++, ...f }));
        almacen.tarifas.push(...creadas);
        return creadas;
      },
      destroy: async ({ where } = {}) => {
        const antes = almacen.tarifas.length;
        almacen.tarifas = almacen.tarifas.filter((t) => !coincide(t, where));
        return antes - almacen.tarifas.length;
      },
    },

    DeliveryZonaTarifa: {
      findAll: async () => [],
      bulkCreate: async () => [],
      destroy: async () => 0,
    },
  };
});

const courierController = require('../controllers/courierController');
const { Courier, CourierTarifa, __almacen } = require('../models');

const USUARIO = 1;
const OTRO_USUARIO = 2;

/** Doble de `res` que registra el estado y el cuerpo, como el original. */
const respuesta = () => ({
  statusCode: 200,
  responseData: null,
  status(code) { this.statusCode = code; return this; },
  json(data) { this.responseData = data; return this; },
});

beforeEach(() => {
  __almacen.couriers = [];
  __almacen.tarifas = [];
  __almacen.siguienteId = 1;
});

describe('createCourier', () => {
  it('crea el courier con todos sus campos y tarifas', async () => {
    const req = {
      usuario: { id: USUARIO },
      body: {
        nombre: 'TEST_JEST_COURIER_A',
        telefono: '0981999888',
        vehiculo: 'Moto',
        activo: true,
        tarifas: [
          {
            ciudad_zona: 'Asunción', departamento: 'Capital', tipo_pago: 'Anticipado',
            rango_min: 0, rango_max: 5, costo: 12000, tiempo_entrega_hs: '24hs',
          },
          {
            ciudad_zona: 'San Lorenzo', departamento: 'Central', tipo_pago: 'Al Recibir',
            rango_min: 1, rango_max: 20, costo: 18000, tiempo_entrega_hs: 'En el día',
          },
        ],
      },
    };
    const res = respuesta();

    await courierController.createCourier(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.responseData).toMatchObject({
      nombre: 'TEST_JEST_COURIER_A',
      telefono: '0981999888',
      vehiculo: 'Moto',
      activo: true,
      usuario_id: USUARIO,
    });
    expect(res.responseData.tarifas).toHaveLength(2);
    expect(res.responseData.tarifas[0]).toMatchObject({
      ciudad_zona: 'Asunción', departamento: 'Capital', costo: 12000,
    });
  });

  it('normaliza los valores vacíos de una tarifa', async () => {
    const req = {
      usuario: { id: USUARIO },
      body: {
        nombre: 'TEST_JEST_COURIER_VACIOS',
        tarifas: [{ ciudad_zona: '  Luque  ', rango_min: '', rango_max: '', costo: '' }],
      },
    };
    await courierController.createCourier(req, respuesta());

    // Un string vacío no puede terminar como NaN en la base.
    expect(__almacen.tarifas[0]).toMatchObject({
      ciudad_zona: 'Luque', tipo_pago: 'Ambos', rango_min: 0, rango_max: null, costo: 0,
      departamento: null, tiempo_entrega_hs: null,
    });
  });

  it('descarta las tarifas sin ciudad', async () => {
    // Una fila vacía del formulario no debería crear una tarifa fantasma.
    const req = {
      usuario: { id: USUARIO },
      body: {
        nombre: 'TEST_JEST_COURIER_FILTRO',
        tarifas: [{ ciudad_zona: 'Capiatá', costo: 9000 }, { ciudad_zona: '   ', costo: 5000 }, {}],
      },
    };
    await courierController.createCourier(req, respuesta());

    expect(__almacen.tarifas).toHaveLength(1);
    expect(__almacen.tarifas[0].ciudad_zona).toBe('Capiatá');
  });
});

describe('listCouriers', () => {
  it('lista solo los couriers del usuario, con sus tarifas', async () => {
    const propio = await Courier.create({
      usuario_id: USUARIO, nombre: 'TEST_JEST_COURIER_LIST', telefono: '0981123456', vehiculo: 'Auto', activo: true,
    });
    await CourierTarifa.create({ courier_id: propio.id, ciudad_zona: 'Luque', costo: 10000 });
    await Courier.create({ usuario_id: OTRO_USUARIO, nombre: 'TEST_JEST_COURIER_AJENO' });

    const res = respuesta();
    await courierController.listCouriers({ usuario: { id: USUARIO } }, res);

    expect(res.responseData).toHaveLength(1);
    expect(res.responseData[0]).toMatchObject({ id: propio.id, nombre: 'TEST_JEST_COURIER_LIST' });
    expect(res.responseData[0].tarifas).toHaveLength(1);
  });
});

describe('updateCourier', () => {
  const conTarifaInicial = async () => {
    const courier = await Courier.create({
      usuario_id: USUARIO, nombre: 'TEST_JEST_COURIER_OLD', telefono: '0981000000', vehiculo: 'Moto', activo: false,
    });
    await CourierTarifa.create({
      courier_id: courier.id, ciudad_zona: 'Luque', departamento: 'Central', tipo_pago: 'Ambos',
      rango_min: 0, rango_max: 10, costo: 10000, tiempo_entrega_hs: '48hs',
    });
    return courier;
  };

  it('actualiza todos los campos y reemplaza las tarifas', async () => {
    const courier = await conTarifaInicial();

    const req = {
      usuario: { id: USUARIO },
      params: { id: courier.id },
      body: {
        nombre: 'TEST_JEST_COURIER_UPDATED',
        telefono: '0981999999',
        vehiculo: 'Camioneta',
        activo: true,
        tarifas: [
          {
            ciudad_zona: 'Luque Centrico', departamento: 'Central', tipo_pago: 'Al Recibir',
            rango_min: 5, rango_max: 15, costo: 15000, tiempo_entrega_hs: '12hs',
          },
          {
            ciudad_zona: 'Lambaré', departamento: 'Central', tipo_pago: 'Anticipado',
            rango_min: 0, rango_max: 100, costo: 25000, tiempo_entrega_hs: '24hs',
          },
        ],
      },
    };
    const res = respuesta();

    await courierController.updateCourier(req, res);

    expect(res.responseData).toMatchObject({
      nombre: 'TEST_JEST_COURIER_UPDATED',
      telefono: '0981999999',
      vehiculo: 'Camioneta',
      activo: true,
    });
    expect(res.responseData.tarifas).toHaveLength(2);

    const luque = res.responseData.tarifas.find((t) => t.ciudad_zona === 'Luque Centrico');
    expect(luque).toMatchObject({
      departamento: 'Central', tipo_pago: 'Al Recibir',
      rango_min: 5, rango_max: 15, costo: 15000, tiempo_entrega_hs: '12hs',
    });

    const lambare = res.responseData.tarifas.find((t) => t.ciudad_zona === 'Lambaré');
    expect(lambare).toMatchObject({ costo: 25000, rango_max: 100 });

    // La tarifa vieja se borró: el controller reemplaza, no acumula.
    expect(__almacen.tarifas.some((t) => t.ciudad_zona === 'Luque')).toBe(false);
  });

  it('sin la clave `tarifas` deja las existentes intactas', async () => {
    // Editar solo el teléfono no puede borrarle las tarifas al courier.
    const courier = await conTarifaInicial();

    await courierController.updateCourier(
      { usuario: { id: USUARIO }, params: { id: courier.id }, body: { telefono: '0982111111' } },
      respuesta(),
    );

    expect(__almacen.tarifas).toHaveLength(1);
    expect(__almacen.tarifas[0].ciudad_zona).toBe('Luque');
  });

  it('con `tarifas: []` las borra todas', async () => {
    const courier = await conTarifaInicial();

    await courierController.updateCourier(
      { usuario: { id: USUARIO }, params: { id: courier.id }, body: { tarifas: [] } },
      respuesta(),
    );

    expect(__almacen.tarifas).toHaveLength(0);
  });

  it('devuelve 404 si el courier no existe', async () => {
    const res = respuesta();
    await courierController.updateCourier(
      { usuario: { id: USUARIO }, params: { id: 999999 }, body: { nombre: 'X', tarifas: [] } },
      res,
    );

    expect(res.statusCode).toBe(404);
  });

  it('devuelve 404 si el courier es de otro usuario', async () => {
    // El ámbito por usuario_id es lo único que separa una cuenta de otra:
    // sin esto se podría editar el courier de un tercero por id.
    const ajeno = await Courier.create({ usuario_id: OTRO_USUARIO, nombre: 'TEST_JEST_COURIER_AJENO' });

    const res = respuesta();
    await courierController.updateCourier(
      { usuario: { id: USUARIO }, params: { id: ajeno.id }, body: { nombre: 'Robado', tarifas: [] } },
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(__almacen.couriers.find((c) => c.id === ajeno.id).nombre).toBe('TEST_JEST_COURIER_AJENO');
  });
});
