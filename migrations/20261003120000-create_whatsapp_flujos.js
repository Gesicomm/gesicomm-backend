'use strict';

/**
 * Convierte las plantillas de WhatsApp sueltas en FLUJOS de fases ordenadas
 * (RF Seguimiento de pedidos por WhatsApp).
 *
 * Tres conceptos separados:
 *  - whatsapp_flujos        → el proceso ("Confirmación de pedido").
 *  - whatsapp_flujo_fases   → los mensajes del proceso, ordenados.
 *  - seguimiento_contactos  → el evento de cada envío. YA EXISTE: tiene
 *    envio_id, usuario_id, telefono, mensaje_generado y created_at. Acá solo
 *    se le agregan flujo_id, fase_id y estado, en vez de crear una tabla
 *    nueva de envíos que partiría el historial del pedido en dos (la
 *    timeline de historialSeguimiento ya lee esta tabla).
 *
 * La fase NO se consume: reenviar la Fase 1 es simplemente otra fila en
 * seguimiento_contactos con el mismo fase_id. Por eso no existe ninguna
 * columna "fase_actual" en el pedido — última fase, último envío y cantidad
 * de intentos se derivan del historial.
 *
 * `estado` arranca en ABIERTO_EN_WHATSAPP y no en ENVIADO: con un deep link
 * wa.me no hay forma de saber si el operador apretó enviar. Las filas
 * viejas toman ese mismo valor por default y es correcto — el mecanismo
 * siempre fue wa.me, nunca hubo confirmación real de entrega.
 *
 * Backfill: cada plantilla que ya existía pasa a ser un flujo de una sola
 * fase con su mismo nombre, y los contactos que la usaron quedan apuntando
 * a esa fase. whatsapp_plantillas no se borra ni se vacía.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS public.whatsapp_flujos (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
        nombre VARCHAR(120) NOT NULL,
        descripcion TEXT NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        plantilla_origen_id INTEGER NULL
          REFERENCES public.whatsapp_plantillas(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_whatsapp_flujos_usuario
        ON public.whatsapp_flujos (usuario_id);

      -- Marca de qué plantilla vieja salió cada flujo migrado. Existe solo
      -- para que el backfill sea idempotente y auditable; los flujos que el
      -- usuario crea a mano la dejan en NULL.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_flujos_plantilla_origen
        ON public.whatsapp_flujos (plantilla_origen_id)
        WHERE plantilla_origen_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS public.whatsapp_flujo_fases (
        id SERIAL PRIMARY KEY,
        flujo_id INTEGER NOT NULL REFERENCES public.whatsapp_flujos(id) ON DELETE CASCADE,
        nombre VARCHAR(120) NOT NULL,
        mensaje TEXT NOT NULL,
        orden INTEGER NOT NULL DEFAULT 1,
        espera_sugerida_minutos INTEGER NOT NULL DEFAULT 0,
        etiqueta_id INTEGER NULL REFERENCES public.seguimiento_etiquetas(id) ON DELETE SET NULL,
        activo BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_whatsapp_flujo_fases_flujo
        ON public.whatsapp_flujo_fases (flujo_id, orden);

      ALTER TABLE public.seguimiento_contactos
        ADD COLUMN IF NOT EXISTS flujo_id INTEGER NULL
          REFERENCES public.whatsapp_flujos(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS fase_id INTEGER NULL
          REFERENCES public.whatsapp_flujo_fases(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS estado VARCHAR(30) NOT NULL
          DEFAULT 'ABIERTO_EN_WHATSAPP';

      CREATE INDEX IF NOT EXISTS idx_seguimiento_contactos_fase
        ON public.seguimiento_contactos (envio_id, fase_id);
    `);

    // Backfill: una plantilla suelta = un flujo de 1 fase, y los contactos
    // que la usaron pasan a apuntar a esa fase. Solo toca plantillas que
    // todavía no fueron migradas, así re-correr la migración no duplica.
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE
        fila RECORD;
        nuevo_flujo_id INTEGER;
        nueva_fase_id INTEGER;
      BEGIN
        FOR fila IN
          SELECT p.id, p.usuario_id, p.nombre, p.mensaje, p.activo,
                 p.etiqueta_id, p.created_at
          FROM public.whatsapp_plantillas p
          WHERE NOT EXISTS (
            SELECT 1 FROM public.whatsapp_flujos f
            WHERE f.plantilla_origen_id = p.id
          )
          ORDER BY p.id
        LOOP
          INSERT INTO public.whatsapp_flujos
            (usuario_id, nombre, descripcion, activo, plantilla_origen_id,
             created_at, updated_at)
          VALUES
            (fila.usuario_id, fila.nombre, NULL, fila.activo, fila.id,
             fila.created_at, NOW())
          RETURNING id INTO nuevo_flujo_id;

          INSERT INTO public.whatsapp_flujo_fases
            (flujo_id, nombre, mensaje, orden, espera_sugerida_minutos,
             etiqueta_id, activo, created_at, updated_at)
          VALUES
            (nuevo_flujo_id, 'Fase 1', fila.mensaje, 1, 0,
             fila.etiqueta_id, true, fila.created_at, NOW())
          RETURNING id INTO nueva_fase_id;

          UPDATE public.seguimiento_contactos
          SET flujo_id = nuevo_flujo_id, fase_id = nueva_fase_id
          WHERE plantilla_id = fila.id AND fase_id IS NULL;
        END LOOP;
      END $$;
    `);
  },

  async down(queryInterface) {
    // Las plantillas originales nunca se tocaron, así que revertir es solo
    // soltar lo agregado. El historial de contactos queda intacto: pierde
    // flujo_id/fase_id pero conserva plantilla_id y mensaje_generado.
    await queryInterface.sequelize.query(`
      ALTER TABLE public.seguimiento_contactos
        DROP COLUMN IF EXISTS flujo_id,
        DROP COLUMN IF EXISTS fase_id,
        DROP COLUMN IF EXISTS estado;

      DROP TABLE IF EXISTS public.whatsapp_flujo_fases;
      DROP TABLE IF EXISTS public.whatsapp_flujos;
    `);
  },
};
