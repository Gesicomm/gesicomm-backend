'use strict';

/**
 * El recordatorio de seguimiento pasa a saber QUÉ fase del flujo hay que
 * mandar cuando llegue su hora.
 *
 * Hasta acá eso solo quedaba escrito en `nota` como texto libre ("Enviar
 * "Recordatorio" (Fase 2) si el cliente no responde"), así que no había
 * forma de contar "mensajes pendientes en Fase 2" sin interpretar una
 * oración. La pestaña Resumen de Pedidos agrupa por estas dos columnas.
 *
 * Esto NO es un puntero de "fase actual" del pedido (que sigue sin existir,
 * a propósito): es la intención de UN recordatorio. La fase se puede seguir
 * reenviando en cualquier orden.
 *
 * Nullable y sin backfill: los recordatorios viejos y los que se agendan a
 * mano sin elegir fase quedan en NULL, y para esos la fase se deriva del
 * historial de contactos (pendientesSeguimiento.service.js).
 *
 * SET NULL y no CASCADE, igual que en seguimiento_contactos: borrar una fase
 * no puede llevarse puesto el recordatorio de un pedido.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.seguimiento_recordatorios
        ADD COLUMN IF NOT EXISTS flujo_id INTEGER NULL
          REFERENCES public.whatsapp_flujos(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS fase_id INTEGER NULL
          REFERENCES public.whatsapp_flujo_fases(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_seguimiento_recordatorios_fase
        ON public.seguimiento_recordatorios (fase_id)
        WHERE estado IN ('PENDIENTE', 'VENCIDO');
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS public.idx_seguimiento_recordatorios_fase;
      ALTER TABLE public.seguimiento_recordatorios
        DROP COLUMN IF EXISTS fase_id,
        DROP COLUMN IF EXISTS flujo_id;
    `);
  },
};
