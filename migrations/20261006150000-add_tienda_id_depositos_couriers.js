'use strict';

/**
 * Mismo criterio que envios/costos_gastos: depósitos (incluye salones) y
 * couriers son recursos propios de UNA tienda, no compartidos entre las
 * tiendas de una cuenta multi-tienda (decisión explícita del usuario,
 * 2026-10-06: "deposito y salones tambien deben ser por tiendas", "los
 * courriers no son lo mismo por tiendas").
 *
 * Backfill: cuenta con una sola tienda -> esa tienda. Cuenta con 2+ ->
 * la más antigua (mismo criterio que las migraciones anteriores). Nullable
 * a propósito — ver comentario de 20261006130000-add_tienda_id_envios.js.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.depositos
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER NULL
          REFERENCES public.tiendas(id) ON DELETE SET NULL;
        ALTER TABLE public.couriers
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER NULL
          REFERENCES public.tiendas(id) ON DELETE SET NULL;

        WITH tienda_mas_antigua AS (
          SELECT DISTINCT ON (usuario_id) usuario_id, id AS tienda_id
          FROM public.tiendas
          ORDER BY usuario_id, created_at ASC, id ASC
        )
        UPDATE public.depositos d
        SET tienda_id = t.tienda_id
        FROM tienda_mas_antigua t
        WHERE d.usuario_id = t.usuario_id
          AND d.tienda_id IS NULL;

        WITH tienda_mas_antigua AS (
          SELECT DISTINCT ON (usuario_id) usuario_id, id AS tienda_id
          FROM public.tiendas
          ORDER BY usuario_id, created_at ASC, id ASC
        )
        UPDATE public.couriers c
        SET tienda_id = t.tienda_id
        FROM tienda_mas_antigua t
        WHERE c.usuario_id = t.usuario_id
          AND c.tienda_id IS NULL;

        CREATE INDEX IF NOT EXISTS idx_depositos_tienda_id ON public.depositos (tienda_id);
        CREATE INDEX IF NOT EXISTS idx_couriers_tienda_id ON public.couriers (tienda_id);
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_depositos_tienda_id;
      DROP INDEX IF EXISTS idx_couriers_tienda_id;
      ALTER TABLE public.depositos DROP COLUMN IF EXISTS tienda_id;
      ALTER TABLE public.couriers DROP COLUMN IF EXISTS tienda_id;
    `);
  },
};
