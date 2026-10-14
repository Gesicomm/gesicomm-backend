'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      -- "Boxes" no está en la versión de lucide-react del frontend: caía al
      -- ícono por defecto (círculo vacío). Truck ya está probado en otros
      -- ítems del menú.
      UPDATE public.gsql_modulos
      SET icono = 'Truck', updated_at = NOW()
      WHERE modulo_key = 'gestion-logistica';

      INSERT INTO public.gsql_modulos
        (modulo_key, contexto, seccion, etiqueta, path, prefix, icono, menu_key,
         roles_permitidos, requiere_plan, badge, danger_badge_key, orden)
      VALUES
        ('dashboard-operativo', 'ecommerce', 'OPERACIONES', 'Dashboard Operativo',
         '/dashboard-operativo', NULL, 'TrendingUp', 'dashboard-operativo',
         '[]'::jsonb, NULL, NULL, NULL, 68)
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
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM public.gsql_modulos WHERE modulo_key = 'dashboard-operativo';

      UPDATE public.gsql_modulos
      SET icono = 'Boxes', updated_at = NOW()
      WHERE modulo_key = 'gestion-logistica';
    `);
  },
};
