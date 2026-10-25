'use strict';

// Módulo Clientes en el menú del comercio: sección VENTAS, después de
// Productos (orden 30) y antes de Mi E-commerce (MARKETING, 40). No mueve
// ningún ítem existente. Ícono "Users" (agregado a ICONOS_SIDEBAR del
// frontend en el mismo cambio; sin él caería al círculo por defecto).
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO public.gsql_modulos
        (modulo_key, contexto, seccion, etiqueta, path, prefix, icono, menu_key,
         roles_permitidos, requiere_plan, badge, danger_badge_key, orden)
      VALUES
        ('clientes', 'ecommerce', 'VENTAS', 'Clientes',
         '/clientes', NULL, 'Users', 'clientes',
         '["usuario","administrador"]'::jsonb, NULL, NULL, NULL, 35)
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
      DELETE FROM public.gsql_modulos WHERE modulo_key = 'clientes';
    `);
  },
};
