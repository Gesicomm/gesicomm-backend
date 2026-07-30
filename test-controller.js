const { sequelize } = require('./src/models');
const comboController = require('./src/controllers/combo.controller');
const ComboService = require('./src/services/combo.service');

async function testController() {
  const t = await sequelize.transaction();
  try {
    const payload = {
      nombre: "pack de skin care",
      descripcion: null,
      precio_total: 269636,
      precio_minimo: 250000,
      principalProductId: 1,
      upsells: [
        {
          productId: 6,
          discountPercentage: 50
        }
      ]
    };

    // Create a mock combo to test on
    const comboInstance = await ComboService.crear(payload, 1, t);
    console.log("Combo creado. precio_minimo:", comboInstance.precio_minimo);

    // Now simulate an update request with a DIFFERENT precio_minimo
    const updatePayload = { ...payload, precio_minimo: 180000 };

    const req = {
      params: { id: comboInstance.id },
      body: updatePayload,
      usuario: { tenantId: 1 }
    };

    const res = {
      status: function(s) { this.statusCode = s; return this; },
      json: function(data) { this.data = data; return this; }
    };

    // call controller
    await comboController.actualizar(req, res);

    console.log("Response status:", res.statusCode);
    console.log("Response data precio_minimo:", res.data.precio_minimo);

    // Verify in db
    const { ProductoCombo } = require('./src/models');
    const inDb = await ProductoCombo.findByPk(comboInstance.id, { transaction: t });
    console.log("In DB precio_minimo:", inDb.precio_minimo);

    await t.rollback();
  } catch (err) {
    console.error("Error:", err);
    await t.rollback();
  } finally {
    await sequelize.close();
  }
}

testController();
