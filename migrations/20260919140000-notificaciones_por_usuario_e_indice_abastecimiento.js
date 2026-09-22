'use strict';

/**
 * Dos ajustes para poder avisarle al administrador cuando entra un
 * comprobante de abastecimiento:
 *
 * 1. La unique de `notificaciones` era (tipo, entidad_tipo, entidad_id), sin
 *    el usuario. Servía mientras cada evento tenía un único destinatario
 *    (el dueño del recordatorio), pero rompe el primer caso con varios:
 *    al notificar a N administradores del MISMO evento solo entraba la fila
 *    del primero y las demás se descartaban en silencio como si fueran
 *    duplicados. Agregar usuario_id a la unique no afloja la idempotencia
 *    existente —un recordatorio tiene siempre el mismo usuario_id, así que
 *    el par sigue colisionando igual— y habilita el fan-out.
 *
 * 2. Índice parcial sobre abastecimiento_estado: la bandeja de
 *    abastecimiento filtra y cuenta por ese campo en cada carga, y hoy eso
 *    es un seq scan sobre envios. El índice deja afuera 'no_requiere', que
 *    es la enorme mayoría de las filas y nunca se consulta.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS uq_notificaciones_tipo_entidad;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_usuario_tipo_entidad
        ON public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id);

      CREATE INDEX IF NOT EXISTS idx_envios_abastecimiento_estado
        ON public.envios (abastecimiento_estado)
        WHERE abastecimiento_estado <> 'no_requiere';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_envios_abastecimiento_estado;
      DROP INDEX IF EXISTS uq_notificaciones_usuario_tipo_entidad;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_notificaciones_tipo_entidad
        ON public.notificaciones (tipo, entidad_tipo, entidad_id);
    `);
  },
};
