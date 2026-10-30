'use strict';

module.exports = {
  async up(qi) {
    await qi.sequelize.query(`
      INSERT INTO public.roles (nombre, "createdAt", "updatedAt")
      VALUES ('proveedor', NOW(), NOW()) ON CONFLICT (nombre) DO NOTHING;

      CREATE TABLE IF NOT EXISTS public.usuario_roles_adicionales (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        rol_id INTEGER NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (usuario_id, rol_id)
      );

      CREATE TABLE IF NOT EXISTS public.proveedor_servicios (
        id SERIAL PRIMARY KEY,
        solicitud_id INTEGER NOT NULL REFERENCES public.mensajes_contacto(id) ON DELETE CASCADE,
        categoria VARCHAR(50) NOT NULL,
        titulo VARCHAR(120) NOT NULL DEFAULT 'Nuevo servicio',
        resumen VARCHAR(500) NOT NULL DEFAULT '',
        detalle_html TEXT NOT NULL DEFAULT '',
        beneficios JSONB NOT NULL DEFAULT '[]'::jsonb,
        video_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        imagenes JSONB NOT NULL DEFAULT '[]'::jsonb,
        estado VARCHAR(12) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','publicado')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_proveedor_servicios_solicitud ON public.proveedor_servicios (solicitud_id, estado, id);
      CREATE INDEX IF NOT EXISTS idx_proveedor_servicios_publicos ON public.proveedor_servicios (estado, updated_at DESC, id DESC);

      INSERT INTO public.proveedor_servicios (solicitud_id, categoria, titulo, resumen, estado)
      SELECT m.id, COALESCE(m.datos_proveedor->>'categoria', 'partner_certificado'),
        LEFT(m.datos_proveedor->>'oferta', 120), LEFT(m.datos_proveedor->>'descripcion', 500), 'publicado'
      FROM public.mensajes_contacto m
      WHERE m.area = 'comercial' AND m.revision_proveedor = 'aceptada'
        AND m.asunto LIKE 'Gesicom · Postulación de proveedor · %'
        AND NULLIF(m.datos_proveedor->>'foto_url', '') IS NOT NULL
        AND NULLIF(m.datos_proveedor->>'oferta', '') IS NOT NULL
        AND NULLIF(m.datos_proveedor->>'descripcion', '') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.proveedor_servicios s WHERE s.solicitud_id = m.id);
    `);
  },
  async down() {
    throw new Error('Los servicios y roles de proveedor no se eliminan para conservar las publicaciones.');
  },
};
