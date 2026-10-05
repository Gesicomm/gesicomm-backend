'use strict';

const modulosIniciales = [
  ['mi-tienda', 'ecommerce', 'VENTAS', 'Mi tienda', '/mi-tienda', null, 'Store', 'mi-tienda', ['usuario', 'administrador'], null, null, null, 10],
  ['mi-tienda-depositos', 'ecommerce', 'VENTAS', 'Depósitos', '/mi-tienda/depositos', null, 'MapPin', 'mi-tienda-depositos', ['usuario', 'administrador'], null, null, null, 20],
  ['mi-catalogo', 'ecommerce', 'VENTAS', 'Productos', '/mi-catalogo', null, 'Grid', 'mi-catalogo', ['usuario', 'administrador'], null, null, null, 30],
  ['landing', 'ecommerce', 'MARKETING', 'Páginas de venta', '/landing', null, 'Sparkles', 'landing', ['usuario', 'administrador'], null, null, null, 40],
  ['mis-anuncios', 'ecommerce', 'MARKETING', 'Publicidad', '/mis-anuncios', null, 'Megaphone', 'mis-anuncios', ['usuario', 'administrador'], null, null, null, 50],
  ['mis-pedidos', 'ecommerce', 'OPERACIONES', 'Pedidos', '/mis-pedidos', null, 'ShoppingCart', 'mis-pedidos', [], null, null, 'seguimientos_vencidos', 60],
  ['inventario', 'ecommerce', 'OPERACIONES', 'Inventario / Ingresos', '/inventario', null, 'PackageCheck', 'inventario', ['usuario', 'administrador'], null, null, null, 70],
  ['mis-abastecimientos', 'ecommerce', 'OPERACIONES', 'Mis Abastecimientos', '/mis-abastecimientos', null, 'Truck', 'mis-abastecimientos', ['usuario', 'administrador'], null, null, null, 80],
  ['pedidos-configuracion', 'ecommerce', 'OPERACIONES', 'Flujos y plantillas', '/pedidos/configuracion', null, 'Settings', 'pedidos-configuracion', ['usuario', 'administrador'], null, null, null, 90],
  ['mi-dashboard', 'ecommerce', 'ANÁLISIS', 'Dashboard', '/mi-dashboard', null, 'LayoutDashboard', 'mi-dashboard', ['usuario', 'administrador'], null, null, null, 100],
  ['finanzas-costos-gastos', 'ecommerce', 'ANÁLISIS', 'Control financiero', '/finanzas/costos-gastos', null, 'Receipt', 'finanzas-costos-gastos', ['usuario', 'administrador'], null, null, null, 110],
  ['finanzas-proveedores', 'ecommerce', 'ANÁLISIS', 'Proveedores', '/finanzas/proveedores', null, 'Truck', 'finanzas-proveedores', ['administrador'], null, null, null, 120],
  ['academia', 'ecommerce', 'APRENDIZAJE', 'Academia & Cursos', '/academia', null, 'GraduationCap', 'academia', ['usuario', 'administrador'], null, 'PRO', null, 130],
  ['afiliados', 'ecommerce', 'AFILIADOS', 'Quiero ser afiliado', '/afiliados', null, 'BadgeDollarSign', 'afiliados', ['usuario', 'administrador'], 'founders', null, null, 140],
  ['automatizacion', 'marca_personal', 'MARCA PERSONAL', 'Automation Hub', '/automatizacion', null, 'Bot', 'automatizacion', ['usuario', 'administrador'], null, null, null, 10],
];

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.gsql_modulos (
        id SERIAL PRIMARY KEY,
        modulo_key VARCHAR(100) NOT NULL UNIQUE,
        contexto VARCHAR(50) NOT NULL DEFAULT 'ecommerce',
        seccion VARCHAR(80) NOT NULL,
        etiqueta VARCHAR(120) NOT NULL,
        path VARCHAR(200) NOT NULL,
        prefix VARCHAR(200) NULL,
        icono VARCHAR(50) NOT NULL DEFAULT 'Circle',
        menu_key VARCHAR(100) NOT NULL,
        roles_permitidos JSONB NOT NULL DEFAULT '[]'::jsonb,
        requiere_plan VARCHAR(50) NULL,
        badge VARCHAR(40) NULL,
        danger_badge_key VARCHAR(80) NULL,
        visible BOOLEAN NOT NULL DEFAULT true,
        orden INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gsql_modulos_sidebar
        ON public.gsql_modulos (visible, contexto, orden, id);
    `);

    for (const item of modulosIniciales) {
      await queryInterface.sequelize.query(
        `
          INSERT INTO public.gsql_modulos
            (modulo_key, contexto, seccion, etiqueta, path, prefix, icono, menu_key,
             roles_permitidos, requiere_plan, badge, danger_badge_key, orden)
          VALUES
            (:modulo_key, :contexto, :seccion, :etiqueta, :path, :prefix, :icono, :menu_key,
             CAST(:roles_permitidos AS jsonb), :requiere_plan, :badge, :danger_badge_key, :orden)
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
            orden = EXCLUDED.orden,
            updated_at = NOW()
        `,
        {
          replacements: {
            modulo_key: item[0],
            contexto: item[1],
            seccion: item[2],
            etiqueta: item[3],
            path: item[4],
            prefix: item[5],
            icono: item[6],
            menu_key: item[7],
            roles_permitidos: JSON.stringify(item[8]),
            requiere_plan: item[9],
            badge: item[10],
            danger_badge_key: item[11],
            orden: item[12],
          },
        }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.gsql_modulos;');
  },
};
