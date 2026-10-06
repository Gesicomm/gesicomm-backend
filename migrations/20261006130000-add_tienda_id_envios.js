'use strict';

/**
 * Cada pedido (Envio) empieza a saber de qué Tienda vino, para que una
 * cuenta con 2+ tiendas (ver 20261006120000-tiendas_multiples_por_usuario)
 * pueda filtrar pedidos/métricas por tienda activa en vez de ver todo
 * mezclado.
 *
 * Backfill de pedidos existentes:
 *   - Cuenta con una sola tienda: esa tienda, sin ambigüedad.
 *   - Cuenta con 2+ tiendas: la más antigua (MIN(created_at), empate por
 *     MIN(id)) — decisión explícita del usuario, sabiendo que puede no ser
 *     exacta para pedidos viejos repartidos entre varias tiendas.
 *   - Cuenta sin tienda (no debería existir, pero por si acaso): queda NULL.
 *
 * Nullable a propósito: un pedido sin tienda_id se trata como "sin tienda
 * asignada" en los listados, no se adivina más allá de la regla de arriba.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          ADD COLUMN IF NOT EXISTS tienda_id INTEGER NULL
          REFERENCES public.tiendas(id) ON DELETE SET NULL;

        WITH tienda_mas_antigua AS (
          SELECT DISTINCT ON (usuario_id) usuario_id, id AS tienda_id
          FROM public.tiendas
          ORDER BY usuario_id, created_at ASC, id ASC
        )
        UPDATE public.envios e
        SET tienda_id = t.tienda_id
        FROM tienda_mas_antigua t
        WHERE e.usuario_id = t.usuario_id
          AND e.tienda_id IS NULL;

        CREATE INDEX IF NOT EXISTS idx_envios_tienda_id ON public.envios (tienda_id);
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_envios_tienda_id;
      ALTER TABLE public.envios DROP COLUMN IF EXISTS tienda_id;
    `);
  },
};
