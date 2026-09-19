'use strict';

/**
 * Modalidad logística del abastecimiento (RF Gestión de Depósitos, sección
 * 4-6): quién prepara/despacha (GESICOMM o PROPIA) y, si es PROPIA, el
 * depósito del comercio elegido como destino. Se define ANTES de confirmar
 * el pago (ver validación en abastecimientoPago.js).
 *
 * Se guarda también un snapshot de los datos del depósito destino
 * (deposito_destino_*) para que una edición posterior del depósito no
 * altere el histórico del pedido ya confirmado.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE envios
        ADD COLUMN IF NOT EXISTS tipo_logistica_abastecimiento VARCHAR(20)
          CHECK (tipo_logistica_abastecimiento IN ('GESICOMM', 'PROPIA')),
        ADD COLUMN IF NOT EXISTS deposito_destino_id INTEGER REFERENCES depositos(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS deposito_destino_nombre VARCHAR(150),
        ADD COLUMN IF NOT EXISTS destino_departamento VARCHAR(100),
        ADD COLUMN IF NOT EXISTS destino_ciudad VARCHAR(100),
        ADD COLUMN IF NOT EXISTS destino_direccion VARCHAR(255),
        ADD COLUMN IF NOT EXISTS destino_referencia VARCHAR(255),
        ADD COLUMN IF NOT EXISTS destino_persona_contacto VARCHAR(150),
        ADD COLUMN IF NOT EXISTS destino_telefono VARCHAR(50),
        ADD COLUMN IF NOT EXISTS destino_google_maps_url VARCHAR(500);
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_envios_deposito_destino ON envios (deposito_destino_id);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE envios
        DROP COLUMN IF EXISTS tipo_logistica_abastecimiento,
        DROP COLUMN IF EXISTS deposito_destino_id,
        DROP COLUMN IF EXISTS deposito_destino_nombre,
        DROP COLUMN IF EXISTS destino_departamento,
        DROP COLUMN IF EXISTS destino_ciudad,
        DROP COLUMN IF EXISTS destino_direccion,
        DROP COLUMN IF EXISTS destino_referencia,
        DROP COLUMN IF EXISTS destino_persona_contacto,
        DROP COLUMN IF EXISTS destino_telefono,
        DROP COLUMN IF EXISTS destino_google_maps_url;
    `);
  },
};
