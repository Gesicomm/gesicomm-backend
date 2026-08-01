const courierController = require('../controllers/courierController');
const { Courier, CourierTarifa } = require('../models');
const { Op } = require('sequelize');

describe('Courier Controller Unit Tests', () => {

  const cleanTestCouriers = async () => {
    try {
      // Find couriers created during tests and delete them (cascades to tarifas)
      await Courier.destroy({
        where: {
          nombre: {
            [Op.like]: 'TEST_JEST_COURIER_%'
          }
        }
      });
    } catch (err) {
      console.error("Clean test couriers failed:", err);
    }
  };

  beforeEach(async () => {
    await cleanTestCouriers();
  });

  afterEach(async () => {
    await cleanTestCouriers();
  });

  test('should create a new courier with multiple fields and tariffs successfully', async () => {
    const req = {
      usuario: { id: 1 },
      body: {
        nombre: "TEST_JEST_COURIER_A",
        telefono: "0981999888",
        vehiculo: "Moto",
        activo: true,
        tarifas: [
          {
            ciudad_zona: "Asunción",
            tipo_pago: "Anticipado",
            rango_min: 0,
            rango_max: 5,
            costo: 12000,
            tiempo_entrega_hs: "24hs"
          },
          {
            ciudad_zona: "San Lorenzo",
            tipo_pago: "Al Recibir",
            rango_min: 1,
            rango_max: 20,
            costo: 18000,
            tiempo_entrega_hs: "En el día"
          }
        ]
      }
    };

    const res = {
      statusCode: null,
      responseData: null,
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.responseData = data;
        return this;
      }
    };

    await courierController.createCourier(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.responseData).toBeDefined();
    expect(res.responseData.nombre).toBe("TEST_JEST_COURIER_A");
    expect(res.responseData.telefono).toBe("0981999888");
    expect(res.responseData.vehiculo).toBe("Moto");
    expect(res.responseData.activo).toBe(true);
    expect(res.responseData.tarifas).toHaveLength(2);
    expect(res.responseData.tarifas[0].ciudad_zona).toBe("Asunción");
    expect(res.responseData.tarifas[0].costo).toBe(12000);
  });

  test('should list couriers for a specific user', async () => {
    // Create a temporary courier
    const courier = await Courier.create({
      usuario_id: 1,
      nombre: "TEST_JEST_COURIER_LIST",
      telefono: "0981123456",
      vehiculo: "Auto",
      activo: true
    });

    const req = {
      usuario: { id: 1 }
    };

    const res = {
      statusCode: 200,
      responseData: null,
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.responseData = data;
        return this;
      }
    };

    await courierController.listCouriers(req, res);

    expect(res.responseData).toBeDefined();
    const found = res.responseData.find(c => c.id === courier.id);
    expect(found).toBeDefined();
    expect(found.nombre).toBe("TEST_JEST_COURIER_LIST");
  });

  test('should update every possible field of a courier and its tariffs successfully', async () => {
    // 1. Create initial courier
    const courier = await Courier.create({
      usuario_id: 1,
      nombre: "TEST_JEST_COURIER_OLD",
      telefono: "0981000000",
      vehiculo: "Moto",
      activo: false
    });

    await CourierTarifa.create({
      courier_id: courier.id,
      ciudad_zona: "Luque",
      tipo_pago: "Ambos",
      rango_min: 0,
      rango_max: 10,
      costo: 10000,
      tiempo_entrega_hs: "48hs"
    });

    // 2. Modify every possible field: nombre, telefono, vehiculo, activo, and edit/add/delete tariffs
    const req = {
      usuario: { id: 1 },
      params: { id: courier.id },
      body: {
        nombre: "TEST_JEST_COURIER_UPDATED",
        telefono: "0981999999",
        vehiculo: "Camioneta",
        activo: true,
        tarifas: [
          // Edit the existing tariff and modify its fields
          {
            ciudad_zona: "Luque Centrico",
            tipo_pago: "Al Recibir",
            rango_min: 5,
            rango_max: 15,
            costo: 15000,
            tiempo_entrega_hs: "12hs"
          },
          // Add a new tariff
          {
            ciudad_zona: "Lambaré",
            tipo_pago: "Anticipado",
            rango_min: 0,
            rango_max: 100,
            costo: 25000,
            tiempo_entrega_hs: "24hs"
          }
        ]
      }
    };

    const res = {
      statusCode: 200,
      responseData: null,
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.responseData = data;
        return this;
      }
    };

    await courierController.updateCourier(req, res);

    expect(res.responseData).toBeDefined();
    expect(res.responseData.nombre).toBe("TEST_JEST_COURIER_UPDATED");
    expect(res.responseData.telefono).toBe("0981999999");
    expect(res.responseData.vehiculo).toBe("Camioneta");
    expect(res.responseData.activo).toBe(true);
    expect(res.responseData.tarifas).toHaveLength(2);

    // Verify first tariff updated fields
    const luqueTariff = res.responseData.tarifas.find(t => t.ciudad_zona === "Luque Centrico");
    expect(luqueTariff).toBeDefined();
    expect(luqueTariff.tipo_pago).toBe("Al Recibir");
    expect(luqueTariff.rango_min).toBe(5);
    expect(luqueTariff.rango_max).toBe(15);
    expect(luqueTariff.costo).toBe(15000);
    expect(luqueTariff.tiempo_entrega_hs).toBe("12hs");

    // Verify second tariff added fields
    const lambareTariff = res.responseData.tarifas.find(t => t.ciudad_zona === "Lambaré");
    expect(lambareTariff).toBeDefined();
    expect(lambareTariff.costo).toBe(25000);
    expect(lambareTariff.rango_max).toBe(100);
  });

  test('should return 404 when trying to update a non-existent courier', async () => {
    const req = {
      usuario: { id: 1 },
      params: { id: 999999 },
      body: {
        nombre: "TEST_JEST_COURIER_NON_EXISTENT",
        tarifas: []
      }
    };

    const res = {
      statusCode: null,
      responseData: null,
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.responseData = data;
        return this;
      }
    };

    await courierController.updateCourier(req, res);
    expect(res.statusCode).toBe(404);
  });
});
