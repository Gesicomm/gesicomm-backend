const { sequelize } = require('../src/models');

/**
 * Suma la FK de canal de venta a `envios`. La tabla `canales_venta` la crea
 * sequelize.sync() (modelo CanalVenta) antes de que esto corra — ver el
 * orden en server.js.
 *
 * Idempotente y sin backfill a propósito: NO toca el `origen` ni asigna
 * canal a los pedidos que ya existen. La conversión de los valores viejos
 * (WEB / LANDING / WHATSAPP / META_ADS) al catálogo nuevo es una decisión
 * de negocio, no algo que deba pasar solo al reiniciar el server.
 */
async function migrarCanalesVenta() {
  const queries = [
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "canal_venta_id" INTEGER',
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_name = 'envios_canal_venta_id_fkey'
       ) THEN
         ALTER TABLE "envios"
           ADD CONSTRAINT "envios_canal_venta_id_fkey"
           FOREIGN KEY ("canal_venta_id") REFERENCES "canales_venta" ("id")
           ON DELETE SET NULL;
       END IF;
     END $$;`,
    'CREATE INDEX IF NOT EXISTS "envios_canal_venta_id_idx" ON "envios" ("canal_venta_id")',
  ];

  for (const q of queries) {
    await sequelize.query(q);
  }
}

/**
 * Convierte el `origen` de texto libre de los pedidos viejos al canal del
 * catálogo. Corre DESPUÉS de CanalVentaService.seedDefaults() (necesita los
 * canales creados) — ver el orden en server.js.
 *
 * Idempotente por el `canal_venta_id IS NULL`: un pedido ya migrado, o uno
 * nuevo que nació con canal elegido, no se vuelve a tocar. Tampoco se
 * modifica `origen`: queda como snapshot de lo que se registró en su
 * momento, así la conversión es auditable y reversible.
 */
async function backfillCanalesVenta() {
  const [, meta] = await sequelize.query(`
    UPDATE "envios" e
    SET "canal_venta_id" = c."id"
    FROM "canales_venta" c
    WHERE e."canal_venta_id" IS NULL
      AND c."inquilino_id" IS NULL
      AND c."slug" = CASE upper(e."origen")
        WHEN 'LANDING'  THEN 'web'
        WHEN 'WEB'      THEN 'organico'
        WHEN 'WHATSAPP' THEN 'whatsapp'
        WHEN 'META_ADS' THEN 'meta-ads'
        ELSE NULL
      END
  `);
  return meta ? meta.rowCount : 0;
}

module.exports = { migrarCanalesVenta, backfillCanalesVenta };
