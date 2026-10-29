'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`ALTER TABLE mensajes_contacto
        ADD COLUMN IF NOT EXISTS datos_proveedor JSONB,
        ADD COLUMN IF NOT EXISTS revision_proveedor VARCHAR(12) NOT NULL DEFAULT 'pendiente'
          CHECK (revision_proveedor IN ('pendiente', 'aceptada', 'rechazada')),
        ADD COLUMN IF NOT EXISTS nota_revision TEXT,
        ADD COLUMN IF NOT EXISTS revisado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS revisado_en TIMESTAMPTZ`, { transaction });
    });
  },
  async down() {
    throw new Error('La reversión conserva las decisiones administrativas y las solicitudes recibidas.');
  },
};
