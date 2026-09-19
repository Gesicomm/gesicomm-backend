'use strict';

/**
 * Depósitos propios de cada comercio (RF Gestión de Depósitos). Un comercio
 * puede tener una cantidad ilimitada; el destino de abastecimiento se elige
 * entre los depósitos activos del usuario_id autenticado (ver Envio:
 * tipo_logistica_abastecimiento / deposito_destino_id).
 *
 * Sin catálogo de país/departamento/ciudad: se usa texto libre, igual que
 * Courier/DeliveryZonaTarifa en este mismo proyecto.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS depositos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        nombre VARCHAR(150) NOT NULL,
        departamento VARCHAR(100),
        ciudad VARCHAR(100) NOT NULL,
        direccion VARCHAR(255) NOT NULL,
        referencia VARCHAR(255),
        persona_contacto VARCHAR(150),
        telefono_contacto VARCHAR(50),
        google_maps_url VARCHAR(500),
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_depositos_usuario ON depositos (usuario_id);
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_depositos_usuario_activo ON depositos (usuario_id, activo);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS depositos;');
  },
};
