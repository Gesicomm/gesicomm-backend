'use strict';

/**
 * `envios.pago_anticipado`: si el cliente ya pagó antes de recibir el
 * pedido, o paga contra entrega.
 *
 * Es un dato PROPIO, sin relación con `metodo_pago_id`: hasta ahora este
 * comportamiento vivía escondido dentro del catálogo de Métodos de Pago
 * (el flag `es_anticipado` de cada método), y solo se conocía cuando se
 * elegía un método puntual. El comercio necesita registrarlo aparte —
 * puede saber "este pedido se paga por adelantado" antes de decidir con
 * qué método exacto (transferencia, tarjeta) se hará ese pago — y lo
 * necesita persistido para poder reportarlo más adelante (cuántos pedidos
 * fueron contra entrega vs. anticipados), no solo usarlo al vuelo para
 * elegir tarifa de courier.
 *
 * ── Por qué NO hay backfill ─────────────────────────────────────────────
 *
 * Mismo criterio que `delivery_a_cargo` (ver migración
 * 20260908230000-add_delivery_a_cargo_envios.js): no existe ningún campo
 * histórico de donde deducir con confianza si un pedido viejo fue contra
 * entrega o anticipado. Antes de esta columna, el sistema ni siquiera
 * necesitaba saberlo como tal — solo derivaba `es_anticipado` del método
 * de pago para buscar tarifa, un uso completamente distinto (y efímero,
 * nunca se guardaba). Intentar reconstruir el pasado inventaría un dato
 * que no existe. El pasado queda en NULL: "no se registró".
 *
 * ── Por qué es NULLABLE con DEFAULT en dos pasos ────────────────────────
 *
 * Igual que `delivery_a_cargo`: se agrega la columna SIN default y recién
 * después se le pone el default. `ADD COLUMN ... DEFAULT x` en un solo
 * paso rellena las filas existentes con `x`, borrando la distinción entre
 * "es contra entrega" y "nunca se registró". En dos pasos, el pasado queda
 * NULL y lo nuevo nace en `false` (contra entrega — el caso normal).
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          ADD COLUMN IF NOT EXISTS pago_anticipado BOOLEAN;

        ALTER TABLE public.envios
          ALTER COLUMN pago_anticipado SET DEFAULT false;

        COMMENT ON COLUMN public.envios.pago_anticipado IS
          'true = el cliente ya pagó antes de recibir el pedido. false = paga contra entrega (el caso normal). NULL = pedido anterior a esta columna, no se registró.';
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          DROP COLUMN IF EXISTS pago_anticipado;
      `, { transaction });
    });
  },
};
