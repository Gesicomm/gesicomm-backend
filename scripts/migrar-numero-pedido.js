const { sequelize } = require('../src/models');

async function migrarNumeroPedido() {
  await sequelize.query(`
    ALTER TABLE "envios"
    ADD COLUMN IF NOT EXISTS "numero_pedido" INTEGER
  `);

  await sequelize.query(`
    WITH numerados AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY usuario_id
          ORDER BY COALESCE(created_at, NOW()), id
        ) AS numero
      FROM "envios"
    )
    UPDATE "envios" e
    SET "numero_pedido" = n.numero
    FROM numerados n
    WHERE e.id = n.id
      AND e."numero_pedido" IS NULL
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS "pedido_counters" (
      "usuario_id" INTEGER PRIMARY KEY REFERENCES "usuarios"("id") ON DELETE CASCADE,
      "ultimo_numero_pedido" INTEGER NOT NULL DEFAULT 0,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await sequelize.query(`
    INSERT INTO "pedido_counters" ("usuario_id", "ultimo_numero_pedido", "created_at", "updated_at")
    SELECT "usuario_id", MAX("numero_pedido"), NOW(), NOW()
    FROM "envios"
    WHERE "numero_pedido" IS NOT NULL
    GROUP BY "usuario_id"
    ON CONFLICT ("usuario_id") DO UPDATE
    SET "ultimo_numero_pedido" = GREATEST(
          "pedido_counters"."ultimo_numero_pedido",
          EXCLUDED."ultimo_numero_pedido"
        ),
        "updated_at" = NOW()
  `);

  await sequelize.query(`
    ALTER TABLE "envios"
    ALTER COLUMN "numero_pedido" SET NOT NULL
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_envios_usuario_numero_pedido"
    ON "envios" ("usuario_id", "numero_pedido")
  `);

  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS "idx_envios_numero_pedido"
    ON "envios" ("numero_pedido")
  `);
}

module.exports = { migrarNumeroPedido };
