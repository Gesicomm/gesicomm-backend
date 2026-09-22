'use strict';

/**
 * `delivery_zona_tarifas` pasa a albergar dos familias de reglas, con una
 * invariante que las mantiene separadas.
 *
 * El centro entra en la IDENTIDAD de la tarifa de red, no sólo en el vínculo
 * proveedor↔centro. Sin `centro_id` un proveedor tendría un único precio por
 * ciudad para toda la red, y esto no se podría representar:
 *
 *   Transportadora XYZ
 *     desde Centro Luque            → Encarnación  ₲30.000
 *     desde Centro Ciudad del Este  → Encarnación  ₲18.000
 *
 * Las reglas de red van con `usuario_id = NULL` a propósito. Si llevaran el
 * id del admin que las creó, `resolverOpcionesDelivery(usuarioId)` se las
 * serviría al checkout de ese admin cuando vende como comercio — la misma
 * regresión de cobertura que ya nos pasó una vez. Con NULL, el filtro por
 * usuario las excluye solo.
 *
 * La invariante nombra las CUATRO columnas. Separar sólo usuario_id de
 * proveedor_logistico_id dejaría pasar una fila sin ningún operador, o una
 * con courier y proveedor a la vez.
 *
 * Verificado antes de correr esto: 11 reglas, todas con usuario y courier,
 * ninguna sin courier. La invariante se aplica sin excepciones ni backfill.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE public.delivery_zona_tarifas
        ADD COLUMN IF NOT EXISTS proveedor_logistico_id INTEGER
          REFERENCES public.proveedores_logisticos(id) ON DELETE CASCADE,
        ADD COLUMN IF NOT EXISTS centro_id INTEGER
          REFERENCES public.depositos(id) ON DELETE CASCADE;

      ALTER TABLE public.delivery_zona_tarifas
        ALTER COLUMN usuario_id DROP NOT NULL;

      ALTER TABLE public.delivery_zona_tarifas
        DROP CONSTRAINT IF EXISTS delivery_zona_tarifas_dueno_check;
      ALTER TABLE public.delivery_zona_tarifas
        ADD CONSTRAINT delivery_zona_tarifas_dueno_check CHECK (
          (usuario_id IS NOT NULL AND courier_id IS NOT NULL
           AND proveedor_logistico_id IS NULL AND centro_id IS NULL)
          OR
          (usuario_id IS NULL AND courier_id IS NULL
           AND proveedor_logistico_id IS NOT NULL AND centro_id IS NOT NULL)
        );

      COMMENT ON CONSTRAINT delivery_zona_tarifas_dueno_check
        ON public.delivery_zona_tarifas IS
        'Una regla es del comercio (usuario + courier) o de la red (proveedor + centro). Nunca mezcla, nunca ninguna de las dos.';

      CREATE INDEX IF NOT EXISTS idx_delivery_zona_tarifas_red
        ON public.delivery_zona_tarifas (centro_id, proveedor_logistico_id)
        WHERE proveedor_logistico_id IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_delivery_zona_tarifas_red;
      ALTER TABLE public.delivery_zona_tarifas
        DROP CONSTRAINT IF EXISTS delivery_zona_tarifas_dueno_check;
      ALTER TABLE public.delivery_zona_tarifas
        DROP COLUMN IF EXISTS centro_id,
        DROP COLUMN IF EXISTS proveedor_logistico_id;
      -- usuario_id vuelve a NOT NULL sólo si no quedaron reglas de red.
      ALTER TABLE public.delivery_zona_tarifas
        ALTER COLUMN usuario_id SET NOT NULL;
    `);
  },
};
