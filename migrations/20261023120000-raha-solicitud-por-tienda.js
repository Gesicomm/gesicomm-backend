'use strict';
// La solicitud de conexión con Raha pasa a ser por tienda: cada tienda presenta
// su propio RUC y documentos. Se quita el único por usuario y se pone por tienda.
// Si dos solicitudes compartieran tienda, el índice único falla y la migración se
// revierte entera (no hay que adivinar cuál conservar).
const UNICOS_USUARIO = `SELECT c.conname FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'raha_solicitudes'::regclass AND c.contype = 'u'
    AND array_length(c.conkey, 1) = 1 AND a.attname = 'usuario_id'`;
module.exports = {
  async up(qi) {
    await qi.sequelize.transaction(async transaction => {
      const [unicos] = await qi.sequelize.query(UNICOS_USUARIO, { transaction });
      for (const { conname } of unicos) {
        await qi.sequelize.query(`ALTER TABLE raha_solicitudes DROP CONSTRAINT "${conname}"`, { transaction });
      }
      await qi.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS raha_solicitudes_tienda_id_unico ON raha_solicitudes (tienda_id)', { transaction });
      await qi.sequelize.query('CREATE INDEX IF NOT EXISTS raha_solicitudes_usuario_id ON raha_solicitudes (usuario_id)', { transaction });
    });
  },
  async down(qi) {
    // Solo vuelve atrás si cada usuario tiene una sola solicitud.
    await qi.sequelize.transaction(async transaction => {
      await qi.sequelize.query('DROP INDEX IF EXISTS raha_solicitudes_tienda_id_unico', { transaction });
      await qi.sequelize.query('DROP INDEX IF EXISTS raha_solicitudes_usuario_id', { transaction });
      await qi.sequelize.query('ALTER TABLE raha_solicitudes ADD CONSTRAINT raha_solicitudes_usuario_id_key UNIQUE (usuario_id)', { transaction });
    });
  },
};
