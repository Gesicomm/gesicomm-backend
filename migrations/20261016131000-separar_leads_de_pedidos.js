'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        ALTER TABLE envios ADD COLUMN IF NOT EXISTS es_lead BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE envios ALTER COLUMN numero_pedido DROP NOT NULL;
        UPDATE envios e SET es_lead = true
        WHERE UPPER(COALESCE(e.origen, '')) LIKE '%WHATSAPP%'
          AND e.estado IN ('Pendiente', 'EnSeguimiento', 'Cancelado')
          AND COALESCE(e.pago_anticipado, false) = false
          AND (e.lead_tipo_manual = 'organico'
            OR (e.lead_tipo_manual IS NULL AND NOT EXISTS (SELECT 1 FROM meta_campana_leads l WHERE l.envio_id = e.id))
            OR NOT EXISTS (SELECT 1 FROM envio_items i WHERE i.envio_id = e.id));
      `, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const [leads] = await queryInterface.sequelize.query('SELECT id FROM envios WHERE es_lead = true OR numero_pedido IS NULL LIMIT 1', { transaction });
      if (leads.length) throw new Error('Convertí o archivá los leads antes de retirar la distinción entre leads y pedidos.');
      await queryInterface.sequelize.query('ALTER TABLE envios DROP COLUMN es_lead; ALTER TABLE envios ALTER COLUMN numero_pedido SET NOT NULL;', { transaction });
    });
  },
};
