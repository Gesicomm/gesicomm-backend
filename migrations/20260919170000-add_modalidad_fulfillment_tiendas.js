'use strict';

/**
 * Fase 3 del motor de fulfillment: cómo entrega el comercio lo que vende.
 *
 * Es una decisión DISTINTA de `envios.tipo_logistica_abastecimiento`, y por
 * eso vive en otro campo:
 *
 *   tipo_logistica_abastecimiento → ¿dónde recibo el stock que compro?
 *   modalidad_fulfillment          → cuando venda, ¿quién prepara y entrega?
 *
 * Casarlas sería cómodo hoy y caro mañana: un comercio puede recibir stock en
 * Gesicomm y despacharlo desde su propio depósito, o al revés.
 *
 * El default es PROPIA porque es exactamente lo que hacen hoy todos los
 * comercios (sus couriers, sus zonas): la migración no cambia el
 * comportamiento de nadie.
 *
 * `deposito_fulfillment_id` es el depósito desde el que se despacha cuando la
 * modalidad es PROPIA. Se elige explícitamente en vez de adivinar el primero;
 * más adelante podrá resolverse por stock o cercanía.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.tiendas
        ADD COLUMN IF NOT EXISTS modalidad_fulfillment VARCHAR(20) NOT NULL DEFAULT 'PROPIA',
        ADD COLUMN IF NOT EXISTS deposito_fulfillment_id INTEGER
          REFERENCES public.depositos(id) ON DELETE SET NULL;

      ALTER TABLE public.tiendas
        DROP CONSTRAINT IF EXISTS tiendas_modalidad_fulfillment_check;

      ALTER TABLE public.tiendas
        ADD CONSTRAINT tiendas_modalidad_fulfillment_check
        CHECK (modalidad_fulfillment IN ('GESICOMM', 'PROPIA'));

      COMMENT ON COLUMN public.tiendas.modalidad_fulfillment IS
        'Quién prepara y entrega los pedidos de venta. No confundir con envios.tipo_logistica_abastecimiento, que decide dónde se recibe el stock comprado.';

      COMMENT ON COLUMN public.tiendas.deposito_fulfillment_id IS
        'Depósito desde el que se despacha con modalidad PROPIA. NULL = todavía sin elegir.';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.tiendas DROP CONSTRAINT IF EXISTS tiendas_modalidad_fulfillment_check;
      ALTER TABLE public.tiendas
        DROP COLUMN IF EXISTS deposito_fulfillment_id,
        DROP COLUMN IF EXISTS modalidad_fulfillment;
    `);
  },
};
