'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.sequelize.query(`
        INSERT INTO roles (nombre, "createdAt", "updatedAt") VALUES ('colaborador', NOW(), NOW())
        ON CONFLICT (nombre) DO NOTHING;
        CREATE TABLE IF NOT EXISTS tienda_miembros (
          id SERIAL PRIMARY KEY,
          tienda_id INTEGER NOT NULL REFERENCES tiendas(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','activo','revocado')),
          permisos JSONB NOT NULL DEFAULT '{}'::jsonb,
          token_hash VARCHAR(64) UNIQUE,
          token_expira TIMESTAMPTZ,
          invitado_por INTEGER NOT NULL REFERENCES usuarios(id),
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(tienda_id, usuario_id)
        );
        CREATE INDEX IF NOT EXISTS tienda_miembros_usuario_estado ON tienda_miembros(usuario_id, estado);
      `, { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('tienda_miembros');
    // El rol puede estar en uso: nunca eliminar usuarios ni sus roles al revertir.
  },
};
