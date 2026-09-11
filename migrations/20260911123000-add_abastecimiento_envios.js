'use strict';

/**
 * Estado de abastecimiento Gesicom por pedido.
 *
 * Vive separado de `estado` porque no describe el avance logistico hacia el
 * cliente, sino el tramo interno: pagar costo -> Gesicom abastece -> la tienda
 * recibe -> ya puede preparar/despachar.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          ADD COLUMN IF NOT EXISTS abastecimiento_estado VARCHAR(30) NOT NULL DEFAULT 'no_requiere',
          ADD COLUMN IF NOT EXISTS abastecimiento_costo INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS abastecimiento_pagado_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS abastecimiento_recibido_at TIMESTAMPTZ;

        ALTER TABLE public.envios
          DROP CONSTRAINT IF EXISTS envios_abastecimiento_estado_check;

        ALTER TABLE public.envios
          ADD CONSTRAINT envios_abastecimiento_estado_check
          CHECK (abastecimiento_estado IN ('no_requiere', 'pendiente_pago', 'en_proceso', 'recibido'));

        COMMENT ON COLUMN public.envios.abastecimiento_estado IS
          'no_requiere=producto propio/listo, pendiente_pago=debe pagar costo Gesicom, en_proceso=pagado y Gesicom abastece, recibido=llego al deposito/listo para preparar.';

        COMMENT ON COLUMN public.envios.abastecimiento_costo IS
          'Costo total estimado que la tienda debe pagar a Gesicom para abastecer los productos de catalogo del pedido.';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          DROP CONSTRAINT IF EXISTS envios_abastecimiento_estado_check,
          DROP COLUMN IF EXISTS abastecimiento_recibido_at,
          DROP COLUMN IF EXISTS abastecimiento_pagado_at,
          DROP COLUMN IF EXISTS abastecimiento_costo,
          DROP COLUMN IF EXISTS abastecimiento_estado;
      `, { transaction });
    });
  },
};
