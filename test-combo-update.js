const { sequelize, ProductoCombo } = require('./src/models');
const ComboService = require('./src/services/combo.service');

async function test() {
  const t = await sequelize.transaction();
  try {
    // 1. Get a combo
    const combo = await ProductoCombo.findOne({ transaction: t });
    if (!combo) {
      console.log('No combos found.');
      await t.rollback();
      return;
    }

    console.log('Combo found:', combo.id, combo.nombre, 'Precio minimo actual:', combo.precio_minimo);

    const payload = {
      nombre: combo.nombre,
      precio_total: combo.precio_total,
      precio_minimo: 180000,
      upsells: []
    };

    const updatedCombo = await ComboService.actualizar(combo.id, payload, combo.inquilino_id, t);
    console.log('Combo updated, returned precio_minimo:', updatedCombo.precio_minimo);

    // Fetch again
    const comboAfter = await ProductoCombo.findByPk(combo.id, { transaction: t });
    console.log('Combo after update in DB, precio_minimo:', comboAfter.precio_minimo);

    await t.rollback();
  } catch (err) {
    console.error('Error:', err);
    await t.rollback();
  } finally {
    await sequelize.close();
  }
}

test();
