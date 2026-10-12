'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO public.gsql_modulos
        (modulo_key, contexto, seccion, etiqueta, path, prefix, icono, menu_key,
         roles_permitidos, requiere_plan, badge, danger_badge_key, orden)
      VALUES
        ('importada-de-china', 'ecommerce', 'OPERACIONES', 'Importada de China',
         '/importada-de-china', NULL, 'PackageSearch', 'importada-de-china',
         '["usuario","administrador"]'::jsonb, NULL, NULL, NULL, 90)
      ON CONFLICT (modulo_key) DO UPDATE SET
        contexto = EXCLUDED.contexto,
        seccion = EXCLUDED.seccion,
        etiqueta = EXCLUDED.etiqueta,
        path = EXCLUDED.path,
        prefix = EXCLUDED.prefix,
        icono = EXCLUDED.icono,
        menu_key = EXCLUDED.menu_key,
        roles_permitidos = EXCLUDED.roles_permitidos,
        requiere_plan = EXCLUDED.requiere_plan,
        badge = EXCLUDED.badge,
        danger_badge_key = EXCLUDED.danger_badge_key,
        visible = true,
        orden = EXCLUDED.orden,
        updated_at = NOW();

      UPDATE public.gsql_modulos
      SET orden = 100, updated_at = NOW()
      WHERE modulo_key = 'pedidos-configuracion' AND orden < 100;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM public.gsql_modulos WHERE modulo_key = 'importada-de-china';
      UPDATE public.gsql_modulos
      SET orden = 90, updated_at = NOW()
      WHERE modulo_key = 'pedidos-configuracion';
    `);
  },
};
