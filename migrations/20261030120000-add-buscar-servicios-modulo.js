'use strict';

module.exports = {
  async up(qi) {
    await qi.sequelize.query(`
      INSERT INTO public.gsql_modulos
        (modulo_key, contexto, seccion, etiqueta, path, icono, menu_key, roles_permitidos, orden)
      SELECT 'buscar-servicios', 'ecommerce', 'MARKETING', 'Buscar proveedores',
        '/mi-tienda/buscar-servicios', 'Search', 'buscar-servicios',
        '["usuario","administrador"]'::jsonb,
        COALESCE((SELECT MAX(orden) + 1 FROM public.gsql_modulos WHERE contexto = 'ecommerce' AND seccion = 'MARKETING'), 100)
      ON CONFLICT (modulo_key) DO NOTHING;
      UPDATE public.gsql_modulos SET etiqueta = 'Buscar proveedores' WHERE modulo_key = 'buscar-servicios';
      CREATE INDEX IF NOT EXISTS idx_mensajes_servicios_aprobados
        ON public.mensajes_contacto (revisado_en DESC, id DESC)
        WHERE area = 'comercial' AND revision_proveedor = 'aceptada';
    `);
  },
  async down(qi) {
    await qi.sequelize.query("DELETE FROM public.gsql_modulos WHERE modulo_key = 'buscar-servicios'");
    await qi.sequelize.query('DROP INDEX IF EXISTS public.idx_mensajes_servicios_aprobados');
  },
};
