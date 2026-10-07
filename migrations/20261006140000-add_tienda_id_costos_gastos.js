'use strict';

/**
 * Mismo criterio que 20261006130000-add_tienda_id_envios.js, aplicado a
 * Control financiero (costos_gastos): "Costos fijos"/"Gastos"/"Ingresos"
 * manuales compartían todo entre las tiendas de una cuenta multi-tienda.
 *
 * Backfill: cuenta con una sola tienda -> esa tienda, sin ambigüedad.
 * Cuenta con 2+ tiendas -> la más antigua (mismo criterio que envios, para
 * que un mismo pedido/gasto viejo de una cuenta no quede repartido con
 * criterios distintos entre las dos tablas). Nullable a propósito.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.costos_gastos
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER NULL
          REFERENCES public.tiendas(id) ON DELETE SET NULL;

        WITH tienda_mas_antigua AS (
          SELECT DISTINCT ON (usuario_id) usuario_id, id AS tienda_id
          FROM public.tiendas
          ORDER BY usuario_id, created_at ASC, id ASC
        )
        UPDATE public.costos_gastos c
        SET tienda_id = t.tienda_id
        FROM tienda_mas_antigua t
        WHERE c.usuario_id = t.usuario_id
          AND c.tienda_id IS NULL;

        CREATE INDEX IF NOT EXISTS idx_costos_gastos_tienda_id ON public.costos_gastos (tienda_id);
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_costos_gastos_tienda_id;
      ALTER TABLE public.costos_gastos DROP COLUMN IF EXISTS tienda_id;
    `);
  },
};
