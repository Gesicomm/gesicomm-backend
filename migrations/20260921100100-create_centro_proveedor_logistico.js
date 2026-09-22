'use strict';

/**
 * `centro_proveedor_logistico`: qué proveedores operan desde qué centro.
 *
 * Mismo patrón que `deposito_courier`, que se queda intacto sirviendo al
 * comercio. La diferencia importante: esta tabla responde "quién trabaja
 * desde acá", NO "cuánto cobra". Las tarifas viven en
 * `delivery_zona_tarifas` con su propio `centro_id`, porque un mismo
 * proveedor puede cobrar distinto según desde qué centro sale.
 *
 * El centro tiene que ser un depósito con `alcance = GESICOMM`. No se puede
 * expresar como FK, así que lo valida el servicio al vincular.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.centro_proveedor_logistico (
        id                     SERIAL PRIMARY KEY,
        centro_id              INTEGER NOT NULL
                               REFERENCES public.depositos(id) ON DELETE CASCADE,
        proveedor_logistico_id INTEGER NOT NULL
                               REFERENCES public.proveedores_logisticos(id) ON DELETE CASCADE,
        prioridad              INTEGER NOT NULL DEFAULT 0,
        activo                 BOOLEAN NOT NULL DEFAULT TRUE,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Un proveedor se vincula una sola vez a cada centro: sin esto, dos
      -- altas seguidas dejan dos filas y la prioridad deja de ser una.
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_centro_proveedor
        ON public.centro_proveedor_logistico (centro_id, proveedor_logistico_id);

      CREATE INDEX IF NOT EXISTS idx_centro_proveedor_centro
        ON public.centro_proveedor_logistico (centro_id);

      COMMENT ON TABLE public.centro_proveedor_logistico IS
        'Qué proveedores logísticos operan desde cada centro de fulfillment. Las tarifas NO cuelgan de acá: viven en delivery_zona_tarifas con centro_id.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS public.centro_proveedor_logistico;
    `);
  },
};
