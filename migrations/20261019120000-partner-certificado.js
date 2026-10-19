'use strict';

module.exports = {
  async up(qi) {
    await qi.sequelize.transaction(async transaction => {
      await qi.sequelize.query(`
        CREATE TABLE IF NOT EXISTS partner_solicitudes (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id),
          nombre VARCHAR(150) NOT NULL,
          email VARCHAR(255) NOT NULL,
          telefono VARCHAR(50) NOT NULL,
          estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
          terminos_version VARCHAR(30) NOT NULL,
          terminos_aceptados_en TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        INSERT INTO public.gsql_modulos
          (modulo_key, contexto, seccion, etiqueta, path, icono, menu_key, roles_permitidos, orden)
        SELECT 'partner-certificado', 'ecommerce', 'AFILIADOS', 'Partner Certificado',
          '/partner-certificado', 'BadgeCheck', 'partner-certificado',
          '["usuario","administrador"]'::jsonb, COALESCE((SELECT orden + 1 FROM public.gsql_modulos WHERE modulo_key = 'afiliados'), 151)
        ON CONFLICT (modulo_key) DO NOTHING;
      `, { transaction });
    });
  },
  async down(qi) {
    await qi.sequelize.transaction(async transaction => {
      await qi.sequelize.query("DELETE FROM public.gsql_modulos WHERE modulo_key = 'partner-certificado'", { transaction });
      await qi.dropTable('partner_solicitudes', { transaction });
    });
  },
};
