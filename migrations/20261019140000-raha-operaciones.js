'use strict';

module.exports = {
  async up(qi) {
    await qi.sequelize.transaction(async transaction => {
      await qi.sequelize.query(`
        CREATE TABLE IF NOT EXISTS raha_destinos (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(150) NOT NULL,
          ciudad VARCHAR(100) NOT NULL,
          direccion VARCHAR(255) NOT NULL,
          persona_contacto VARCHAR(150) NOT NULL DEFAULT '',
          telefono_contacto VARCHAR(50) NOT NULL DEFAULT '',
          activo BOOLEAN NOT NULL DEFAULT TRUE,
          creado_por INTEGER NOT NULL REFERENCES raha_portal_usuarios(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS raha_envios_stock (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
          deposito_origen_id INTEGER NOT NULL REFERENCES depositos(id),
          destino_raha_id INTEGER NOT NULL REFERENCES raha_destinos(id),
          solicitud_key UUID NOT NULL,
          solicitud_hash VARCHAR(64) NOT NULL,
          estado VARCHAR(30) NOT NULL DEFAULT 'solicitada'
            CHECK (estado IN ('solicitada', 'observada', 'aceptada', 'rechazada', 'cancelada')),
          items JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
          origen_snapshot JSONB NOT NULL,
          destino_snapshot JSONB NOT NULL,
          observacion VARCHAR(2000) NOT NULL DEFAULT '',
          historial JSONB NOT NULL DEFAULT '[]'::jsonb,
          version INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (usuario_id, tienda_id, solicitud_key)
        );
        CREATE INDEX IF NOT EXISTS raha_envios_stock_tienda ON raha_envios_stock (usuario_id, tienda_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS raha_envios_stock_estado ON raha_envios_stock (estado, created_at DESC);
        CREATE INDEX IF NOT EXISTS raha_envios_stock_origen ON raha_envios_stock (deposito_origen_id);
      `, { transaction });
    });
  },
  async down(qi) {
    await qi.sequelize.transaction(async transaction => {
      await qi.dropTable('raha_envios_stock', { transaction });
      await qi.dropTable('raha_destinos', { transaction });
    });
  },
};
