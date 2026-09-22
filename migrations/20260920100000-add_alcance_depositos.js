'use strict';

/**
 * `alcance` en depósitos: distingue la infraestructura de la red de Gesicomm
 * del depósito privado de un comercio. Mismo patrón que `couriers.alcance`.
 *
 * `usuario_id` responde "¿quién es el dueño?"; `alcance` responde "¿para qué
 * red logística existe?". Son preguntas distintas, y mezclarlas rompe: hoy
 * hay 5 usuarios administradores y al menos uno de ellos opera además como
 * comercio con sus propias tarifas, así que "pertenece a un admin" no
 * identifica infraestructura de Gesicomm.
 *
 * Sin backfill a propósito: todos arrancan PROPIO y un administrador designa
 * los centros desde la UI, con validaciones. Nada se deduce del rol.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.depositos
        ADD COLUMN IF NOT EXISTS alcance VARCHAR(20) NOT NULL DEFAULT 'PROPIO';

      ALTER TABLE public.depositos
        DROP CONSTRAINT IF EXISTS depositos_alcance_check;

      ALTER TABLE public.depositos
        ADD CONSTRAINT depositos_alcance_check CHECK (alcance IN ('GESICOMM', 'PROPIO'));

      COMMENT ON COLUMN public.depositos.alcance IS
        'PROPIO = depósito privado del comercio. GESICOMM = centro de fulfillment de la red, designado por un administrador.';

      CREATE INDEX IF NOT EXISTS idx_depositos_alcance
        ON public.depositos (alcance) WHERE alcance = 'GESICOMM';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_depositos_alcance;
      ALTER TABLE public.depositos DROP CONSTRAINT IF EXISTS depositos_alcance_check;
      ALTER TABLE public.depositos DROP COLUMN IF EXISTS alcance;
    `);
  },
};
