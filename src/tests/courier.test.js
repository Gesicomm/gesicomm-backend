/**
 * courierController — alta, listado y edición de couriers.
 *
 * Los modelos se simulan con un almacén en memoria que se comporta como
 * Sequelize en lo que el controller usa. La base real es la de PRODUCCIÓN
 * detrás de un túnel (ver src/config/database), así que la suite no puede
 * tocarla.
 *
 * Nota de la consolidación de tarifas (Fase 1): este controller ya NO
 * administra tarifas. Viven en `delivery_zona_tarifas` y se guardan por
 * `replaceZonasDelivery`, junto con el courier, desde el asistente del panel
 * Delivery. La tabla `courier_tarifas` quedó legacy: acá se verifica
 * justamente que un `tarifas` en el body se ignore y no genere escrituras.
 */

jest.mock('../models', () => {
  const { Op } = require('sequelize');
  const almacen = { couriers: [], zonas: [], siguienteId: 1 };

  // Instancia con .update(), que es lo que el controller llama. Igual que
  // Sequelize: un campo `undefined` no pisa el valor guardado, y el update
  // muta la propia instancia (por eso el controller puede devolverla sin
  // volver a leer de la base).
  const comoInstancia = (registro) => {
    if (!registro) return null;
    const instancia = {
      ...registro,
      update: async (cambios) => {
        for (const [clave, valor] of Object.entries(cambios)) {
          if (valor === undefined) continue;
          registro[clave] = valor;
          instancia[clave] = valor;
        }
        return instancia;
      },
    };
    return instancia;
  };

  // Soporta lo que usa el controller: igualdad simple, Op.in y Op.or.
  const coincide = (registro, where = {}) => {
    const orCond = where[Op.or];
    if (orCond && !orCond.some((alt) => coincide(registro, alt))) return false;

    return Object.entries(where).every(([clave, valor]) => {
      if (valor === undefined) return true;
      if (valor && typeof valor === 'object' && valor[Op.in]) return valor[Op.in].includes(registro[clave]);
      if (clave === 'id') return registro.id === Number(valor);
      return registro[clave] === valor;
    });
  };

  return {
    __almacen: almacen,

    // El guardado de tarifas corre en una transacción; acá alcanza con
    // ejecutar el callback.
    sequelize: { transaction: async (fn) => fn({}) },

    Courier: {
      create: async (datos) => {
        const registro = { id: almacen.siguienteId++, ...datos };
        almacen.couriers.push(registro);
        return comoInstancia(registro);
      },
      findAll: async ({ where } = {}) => almacen.couriers.filter((c) => coincide(c, where)),
      findByPk: async (id) => almacen.couriers.find((c) => c.id === Number(id)) || null,
      findOne: async ({ where } = {}) => comoInstancia(almacen.couriers.find((c) => coincide(c, where))),
      destroy: async ({ where } = {}) => {
        const antes = almacen.couriers.length;
        almacen.couriers = almacen.couriers.filter((c) => !coincide(c, where));
        return antes - almacen.couriers.length;
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
  };
});

const courierController = require('../controllers/courierController');
const { Courier, __almacen } = require('../models');

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
  __almacen.zonas = [];
  __almacen.siguienteId = 1;
});

describe('createCourier', () => {
  it('crea el courier con todos sus campos', async () => {
    const req = {
      usuario: { id: USUARIO },
      body: { nombre: 'TEST_JEST_COURIER', telefono: '0981123456', vehiculo: 'Moto', activo: true },
    };
    const res = respuesta();

    await courierController.createCourier(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.responseData).toMatchObject({
      usuario_id: USUARIO, nombre: 'TEST_JEST_COURIER', telefono: '0981123456', vehiculo: 'Moto', activo: true,
    });
    expect(__almacen.couriers).toHaveLength(1);
  });

  it('ignora un `tarifas` legacy en el body', async () => {
    // Las tarifas ya no se administran acá. Si el body todavía las trae
    // (cliente viejo), el courier se crea igual y no se escribe nada más.
    const res = respuesta();
    await courierController.createCourier({
      usuario: { id: USUARIO },
      body: { nombre: 'TEST_JEST_COURIER', tarifas: [{ ciudad_zona: 'Luque', costo: 10000 }] },
    }, res);

    expect(res.statusCode).toBe(201);
    expect(res.responseData.tarifas).toBeUndefined();
    expect(__almacen.zonas).toHaveLength(0);
  });
});

describe('el courier es siempre del comercio', () => {
  // Acá había un bloque entero sobre `alcance`: un courier podía marcarse
  // GESICOMM y quedaba utilizable por cualquier comercio. Esa era la forma
  // provisoria de representar la red logística y ya no existe — los
  // operadores de la red son proveedores logísticos, con su propia entidad.
  const ADMIN = { id: USUARIO, rol: 'administrador' };
  const COMERCIO = { id: USUARIO, rol: 'usuario' };

  it('nace asociado a quien lo crea', async () => {
    const res = respuesta();
    await courierController.createCourier({ usuario: COMERCIO, body: { nombre: 'X' } }, res);

    expect(res.statusCode).toBe(201);
    expect(res.responseData.usuario_id).toBe(USUARIO);
  });

  it('un alcance en el payload se ignora, venga de quien venga', async () => {
    // Ni siquiera un admin puede publicar un courier a toda la plataforma:
    // para eso existe el proveedor logístico.
    const res = respuesta();
    await courierController.createCourier(
      { usuario: ADMIN, body: { nombre: 'Fast Delivery', alcance: 'GESICOMM' } },
      res,
    );

    expect(res.statusCode).toBe(201);
    expect(res.responseData.alcance).toBeUndefined();
  });

  it('editar mandando alcance tampoco lo escribe', async () => {
    const courier = await Courier.create({ usuario_id: USUARIO, nombre: 'Mío' });

    await courierController.updateCourier(
      { usuario: COMERCIO, params: { id: courier.id }, body: { alcance: 'GESICOMM' } },
      respuesta(),
    );

    expect(__almacen.couriers.find((c) => c.id === courier.id).alcance).toBeUndefined();
  });
});

describe('listCouriers', () => {
  it('lista solo los couriers del usuario', async () => {
    const propio = await Courier.create({
      usuario_id: USUARIO, nombre: 'TEST_JEST_COURIER_LIST', telefono: '0981123456', vehiculo: 'Auto', activo: true,
    });
    await Courier.create({ usuario_id: OTRO_USUARIO, nombre: 'TEST_JEST_COURIER_AJENO' });

    const res = respuesta();
    await courierController.listCouriers({ usuario: { id: USUARIO } }, res);

    expect(res.responseData).toHaveLength(1);
    expect(res.responseData[0]).toMatchObject({ id: propio.id, nombre: 'TEST_JEST_COURIER_LIST' });
  });
});

describe('updateCourier', () => {
  const courierExistente = () => Courier.create({
    usuario_id: USUARIO, nombre: 'TEST_JEST_COURIER_OLD', telefono: '0981000000', vehiculo: 'Moto', activo: false,
  });

  it('actualiza todos los campos', async () => {
    const courier = await courierExistente();
    const res = respuesta();

    await courierController.updateCourier({
      usuario: { id: USUARIO },
      params: { id: courier.id },
      body: { nombre: 'TEST_JEST_COURIER_UPDATED', telefono: '0981999999', vehiculo: 'Camioneta', activo: true },
    }, res);

    expect(res.responseData).toMatchObject({
      nombre: 'TEST_JEST_COURIER_UPDATED', telefono: '0981999999', vehiculo: 'Camioneta', activo: true,
    });
  });

  it('editar solo un campo no toca los demás', async () => {
    const courier = await courierExistente();

    await courierController.updateCourier(
      { usuario: { id: USUARIO }, params: { id: courier.id }, body: { telefono: '0982111111' } },
      respuesta(),
    );

    const guardado = __almacen.couriers.find((c) => c.id === courier.id);
    expect(guardado).toMatchObject({ telefono: '0982111111', nombre: 'TEST_JEST_COURIER_OLD', vehiculo: 'Moto' });
  });

  it('ignora un `tarifas` legacy en el body', async () => {
    const courier = await courierExistente();

    await courierController.updateCourier(
      { usuario: { id: USUARIO }, params: { id: courier.id }, body: { tarifas: [] } },
      respuesta(),
    );

    expect(__almacen.zonas).toHaveLength(0);
  });

  it('devuelve 404 si el courier no existe', async () => {
    const res = respuesta();
    await courierController.updateCourier(
      { usuario: { id: USUARIO }, params: { id: 999999 }, body: { nombre: 'X' } },
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
      { usuario: { id: USUARIO }, params: { id: ajeno.id }, body: { nombre: 'Robado' } },
      res,
    );

    expect(res.statusCode).toBe(404);
    expect(__almacen.couriers.find((c) => c.id === ajeno.id).nombre).toBe('TEST_JEST_COURIER_AJENO');
  });
});

describe('replaceZonasDelivery', () => {
  it('rechaza el guardado entero si viene un courier ajeno', async () => {
    // Antes la regla se guardaba sin courier. Ahora eso no existe: una tarifa
    // sin courier da un precio que nadie está asignado a cumplir, y la
    // invariante de la tabla lo prohíbe. Mejor fallar que guardar a medias.
    const propio = await Courier.create({ usuario_id: USUARIO, nombre: 'PROPIO' });
    const ajeno = await Courier.create({ usuario_id: OTRO_USUARIO, nombre: 'AJENO' });

    const res = respuesta();
    await courierController.replaceZonasDelivery({
      usuario: { id: USUARIO },
      body: {
        zonas: [
          { courier_id: propio.id, ciudad: 'Luque', costo: 20000 },
          { courier_id: ajeno.id, ciudad: 'Encarnación', costo: 40000 },
        ],
      },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(__almacen.zonas).toHaveLength(0);
  });

  it('rechaza una regla sin courier', async () => {
    const res = respuesta();
    await courierController.replaceZonasDelivery({
      usuario: { id: USUARIO },
      body: { zonas: [{ ciudad: 'Luque', costo: 20000 }] },
    }, res);

    expect(res.statusCode).toBe(400);
    expect(__almacen.zonas).toHaveLength(0);
  });

  it('descarta las reglas sin ciudad', async () => {
    const courier = await Courier.create({ usuario_id: USUARIO, nombre: 'PROPIO' });

    await courierController.replaceZonasDelivery({
      usuario: { id: USUARIO },
      body: {
        zonas: [
          { courier_id: courier.id, ciudad: '   ', costo: 10000 },
          { courier_id: courier.id, ciudad: 'Luque', costo: 20000 },
        ],
      },
    }, respuesta());

    expect(__almacen.zonas).toHaveLength(1);
    expect(__almacen.zonas[0].ciudad).toBe('Luque');
  });

  it('normaliza los valores vacíos de una regla', async () => {
    const courier = await Courier.create({ usuario_id: USUARIO, nombre: 'PROPIO' });

    await courierController.replaceZonasDelivery({
      usuario: { id: USUARIO },
      body: { zonas: [{ courier_id: courier.id, ciudad: '  Luque  ', rango_min: '', rango_max: '', costo: '' }] },
    }, respuesta());

    expect(__almacen.zonas[0]).toMatchObject({
      ciudad: 'Luque', rango_min: 0, rango_max: null, costo: 0, tipo_pago: 'Ambos', activo: true,
    });
  });
});

describe('replaceZonasDelivery — alcance del reemplazo', () => {
  // Sin alcance el endpoint borra TODO y reescribe: ese es el comportamiento
  // histórico y sigue siendo válido cuando el cliente manda el set completo.
  // Con alcance sólo puede tocar los couriers que declaró, que es lo que evita
  // que un guardado parcial se lleve puestas las tarifas de otro.
  const zonasDe = (courierId) => __almacen.zonas.filter((z) => z.courier_id === courierId);

  const conDosCouriers = async () => {
    const a = await Courier.create({ usuario_id: USUARIO, nombre: 'A' });
    const b = await Courier.create({ usuario_id: USUARIO, nombre: 'B' });
    __almacen.zonas = [
      { id: 100, usuario_id: USUARIO, courier_id: a.id, ciudad: 'Luque', costo: 10000 },
      { id: 101, usuario_id: USUARIO, courier_id: b.id, ciudad: 'Encarnación', costo: 40000 },
    ];
    return { a, b };
  };

  it('con alcance no toca las tarifas de otro courier', async () => {
    const { a, b } = await conDosCouriers();

    await courierController.replaceZonasDelivery({
      usuario: { id: USUARIO },
      body: { zonas: [{ courier_id: a.id, ciudad: 'Luque', costo: 22000 }], courierIds: [a.id] },
    }, respuesta());

    expect(zonasDe(a.id)).toHaveLength(1);
    expect(zonasDe(a.id)[0].costo).toBe(22000);
    // Las de B y la genérica siguen intactas.
    expect(zonasDe(b.id)).toHaveLength(1);
    expect(zonasDe(b.id)[0].ciudad).toBe('Encarnación');
  });

  it('con alcance y sin reglas borra sólo las de ese courier', async () => {
    const { a, b } = await conDosCouriers();

    await courierController.replaceZonasDelivery(
      { usuario: { id: USUARIO }, body: { zonas: [], courierIds: [a.id] } },
      respuesta(),
    );

    expect(zonasDe(a.id)).toHaveLength(0);
    expect(zonasDe(b.id)).toHaveLength(1);
  });

  it('rechaza reglas de un courier fuera del alcance declarado', async () => {
    const { a, b } = await conDosCouriers();

    const res = respuesta();
    await courierController.replaceZonasDelivery({
      usuario: { id: USUARIO },
      body: { zonas: [{ courier_id: b.id, ciudad: 'Otra', costo: 1 }], courierIds: [a.id] },
    }, res);

    expect(res.statusCode).toBe(400);
    // No se tocó nada.
    expect(__almacen.zonas).toHaveLength(2);
  });

  it('sin alcance mantiene el reemplazo total de siempre', async () => {
    const { a } = await conDosCouriers();

    await courierController.replaceZonasDelivery({
      usuario: { id: USUARIO },
      body: { zonas: [{ courier_id: a.id, ciudad: 'Luque', costo: 22000 }] },
    }, respuesta());

    expect(__almacen.zonas).toHaveLength(1);
    expect(__almacen.zonas[0].ciudad).toBe('Luque');
  });
});
