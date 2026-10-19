'use strict';

module.exports = {
  async up(qi) {
    await qi.sequelize.query(`ALTER TABLE raha_envios_stock
      DROP CONSTRAINT IF EXISTS raha_envios_stock_estado_check,
      ADD CONSTRAINT raha_envios_stock_estado_check CHECK
        (estado IN ('solicitada', 'observada', 'aceptada', 'preparado', 'enviado', 'recibido', 'rechazada', 'cancelada'))`);
  },
  async down(qi) {
    await qi.sequelize.transaction(async transaction => {
      const [[resultado]] = await qi.sequelize.query("SELECT COUNT(*)::int AS cantidad FROM raha_envios_stock WHERE estado IN ('preparado', 'enviado', 'recibido')", { transaction });
      if (resultado.cantidad) throw new Error('No se puede revertir: existen envíos con estados logísticos.');
      await qi.sequelize.query(`ALTER TABLE raha_envios_stock
        DROP CONSTRAINT IF EXISTS raha_envios_stock_estado_check,
        ADD CONSTRAINT raha_envios_stock_estado_check CHECK
          (estado IN ('solicitada', 'observada', 'aceptada', 'rechazada', 'cancelada'))`, { transaction });
    });
  },
};
