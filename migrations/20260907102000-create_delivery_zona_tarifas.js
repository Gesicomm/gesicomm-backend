'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS delivery_zona_tarifas (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        courier_id INTEGER NULL REFERENCES couriers(id) ON DELETE SET NULL,
        departamento VARCHAR(100),
        ciudad VARCHAR(150) NOT NULL,
        tipo_pago VARCHAR(50) DEFAULT 'Ambos',
        rango_min INTEGER NOT NULL DEFAULT 0,
        rango_max INTEGER NULL,
        costo INTEGER NOT NULL DEFAULT 0,
        tiempo_entrega_hs VARCHAR(50),
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_delivery_zona_tarifas_usuario_zona
      ON delivery_zona_tarifas (usuario_id, departamento, ciudad);
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_delivery_zona_tarifas_courier
      ON delivery_zona_tarifas (courier_id);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS delivery_zona_tarifas;');
  }
};
