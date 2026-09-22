'use strict';

/**
 * Amplía el estado de abastecimiento Gesicom de 4 valores gruesos
 * (no_requiere/pendiente_pago/en_proceso/recibido) al pipeline completo de
 * seguimiento: pago por transferencia con comprobante (con posibilidad de
 * rechazo y reenvío) y luego el tramo operativo proveedor→Gesicomm→destino
 * final, que se bifurca según tipo_logistica_abastecimiento (GESICOMM vs
 * PROPIA). Ver services/abastecimiento/estadoMachine.js para las
 * transiciones válidas por actor.
 *
 * Mapeo de filas existentes: pendiente_pago se mantiene, en_proceso (pagado
 * y Gesicom abasteciendo) pasa a pago_validado, recibido pasa a
 * recibido_en_gesicomm. Los pedidos GESICOMM que ya estaban en "recibido"
 * quedan un paso atrás de disponible_en_gesicomm; el admin los avanza a
 * mano una sola vez.
 */

const NUEVOS_ESTADOS = [
  'no_requiere',
  'pendiente_pago',
  'pago_enviado',
  'pago_rechazado',
  'pago_validado',
  'proveedor_contactado',
  'enviado_por_proveedor',
  'en_transito_a_gesicomm',
  'recibido_en_gesicomm',
  'preparando_envio_a_deposito_cliente',
  'despachado_a_deposito_cliente',
  'en_transito_a_deposito_cliente',
  'recibido_en_deposito_cliente',
  'disponible_en_gesicomm',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          ADD COLUMN IF NOT EXISTS abastecimiento_comprobante_url VARCHAR(500),
          ADD COLUMN IF NOT EXISTS abastecimiento_comprobante_storage_key VARCHAR(255),
          ADD COLUMN IF NOT EXISTS abastecimiento_pago_enviado_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS abastecimiento_pago_rechazo_motivo VARCHAR(500);

        ALTER TABLE public.envios
          DROP CONSTRAINT IF EXISTS envios_abastecimiento_estado_check;

        UPDATE public.envios SET abastecimiento_estado = 'pago_validado' WHERE abastecimiento_estado = 'en_proceso';
        UPDATE public.envios SET abastecimiento_estado = 'recibido_en_gesicomm' WHERE abastecimiento_estado = 'recibido';

        ALTER TABLE public.envios
          ADD CONSTRAINT envios_abastecimiento_estado_check
          CHECK (abastecimiento_estado IN (${NUEVOS_ESTADOS.map((e) => `'${e}'`).join(', ')}));

        COMMENT ON COLUMN public.envios.abastecimiento_estado IS
          'Pipeline de seguimiento de abastecimiento Gesicom: ${NUEVOS_ESTADOS.join(', ')}.';
      `, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE public.envio_historial
          ADD COLUMN IF NOT EXISTS estado_anterior VARCHAR(40),
          ADD COLUMN IF NOT EXISTS estado_nuevo VARCHAR(40),
          ADD COLUMN IF NOT EXISTS actor_tipo VARCHAR(20),
          ADD COLUMN IF NOT EXISTS metadata JSONB;

        COMMENT ON COLUMN public.envio_historial.estado_nuevo IS
          'Solo se completa en transiciones de abastecimiento_estado; permite reconstruir el timeline sin tabla aparte.';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envio_historial
          DROP COLUMN IF EXISTS metadata,
          DROP COLUMN IF EXISTS actor_tipo,
          DROP COLUMN IF EXISTS estado_nuevo,
          DROP COLUMN IF EXISTS estado_anterior;
      `, { transaction });

      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          DROP CONSTRAINT IF EXISTS envios_abastecimiento_estado_check;

        UPDATE public.envios SET abastecimiento_estado = 'en_proceso' WHERE abastecimiento_estado = 'pago_validado';
        UPDATE public.envios SET abastecimiento_estado = 'recibido' WHERE abastecimiento_estado IN ('recibido_en_gesicomm', 'preparando_envio_a_deposito_cliente', 'despachado_a_deposito_cliente', 'en_transito_a_deposito_cliente', 'recibido_en_deposito_cliente', 'disponible_en_gesicomm');
        UPDATE public.envios SET abastecimiento_estado = 'pendiente_pago' WHERE abastecimiento_estado IN ('pago_enviado', 'pago_rechazado');

        ALTER TABLE public.envios
          ADD CONSTRAINT envios_abastecimiento_estado_check
          CHECK (abastecimiento_estado IN ('no_requiere', 'pendiente_pago', 'en_proceso', 'recibido'));

        ALTER TABLE public.envios
          DROP COLUMN IF EXISTS abastecimiento_pago_rechazo_motivo,
          DROP COLUMN IF EXISTS abastecimiento_pago_enviado_at,
          DROP COLUMN IF EXISTS abastecimiento_comprobante_storage_key,
          DROP COLUMN IF EXISTS abastecimiento_comprobante_url;
      `, { transaction });
    });
  },
};
