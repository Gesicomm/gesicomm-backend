'use strict';

/**
 * `envios.delivery_a_cargo`: quién paga el flete, dicho explícitamente.
 *
 * Hasta ahora había que deducirlo mirando el hueco entre `monto` y la suma
 * de los ítems, porque el sistema guarda esa plata de dos formas distintas
 * según por dónde entró el pedido:
 *
 *   - Carga manual (NuevoPedidoModal): `monto = subtotales + costo_envio`.
 *     El flete viaja DENTRO del monto.
 *   - Checkout de la landing (landing.service.js/crearCheckout):
 *     `monto = subtotales − cupón`, y el cliente paga `monto + costo_envio`
 *     aparte (ver pagoParService: `amount = monto + costo_envio`).
 *
 * Esa deducción anda para los casos limpios, pero es frágil: un ajuste
 * manual del monto al cerrar la venta se parece a un flete cobrado, y no
 * había forma de registrar "este delivery lo pagamos nosotros" sin que
 * quedara ambiguo. De ahí esta columna.
 *
 * ── Por qué NO hay backfill ─────────────────────────────────────────────
 *
 * La tentación era marcar el pasado con la misma regla que usaba la
 * deducción. Se midió antes de escribir esto y el resultado la descartó:
 *
 *     regla aplicada a las 188 filas → 143 'negocio' / 45 'cliente'
 *     (141 de esas 143 son del usuario 16: monto == subtotales exacto,
 *      fletes de 22–25k, todas 'Confirmado')
 *
 * Esos 141 pedidos no son casos donde el comercio absorbió el flete: son
 * una carga donde el monto nunca incluyó el envío. Marcarlos 'negocio'
 * habría metido Gs 3.456.000 de costo inventado en la rentabilidad apenas
 * esos pedidos pasaran a Entregado.
 *
 * Sobre los 14 pedidos ENTREGADOS la misma regla daba 13/1 — o sea que la
 * muestra chica decía una cosa y el universo entero decía la contraria. Un
 * backfill deducido es exactamente el problema que esta columna viene a
 * resolver, así que el pasado queda en NULL: "no se registró".
 *
 * NULL no rompe nada. El servicio de analytics lo lee como 'cliente', que
 * es la regla normal del negocio (el delivery lo paga el cliente salvo
 * excepción), y así ningún reporte histórico cambia de número. Las
 * excepciones viejas se marcan a mano, una por una, cuando se detecten.
 *
 * ── Por qué la columna es NULLABLE con DEFAULT ─────────────────────────
 *
 * Se agrega SIN default y recién después se le pone el default. En
 * PostgreSQL, `ADD COLUMN ... DEFAULT x` rellena las filas existentes con
 * `x`: hacerlo en un solo paso habría escrito 'cliente' sobre las 188
 * filas y borrado la distinción entre "es del cliente" y "nunca se
 * registró". En dos pasos, el pasado queda NULL y lo nuevo nace en
 * 'cliente'.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          ADD COLUMN IF NOT EXISTS delivery_a_cargo VARCHAR(10);

        ALTER TABLE public.envios
          ALTER COLUMN delivery_a_cargo SET DEFAULT 'cliente';

        COMMENT ON COLUMN public.envios.delivery_a_cargo IS
          'cliente = el flete se le cobra al cliente (plata de paso, no baja la utilidad). negocio = lo absorbe el comercio y es un costo de venta. NULL = pedido anterior a la columna, no se registró; los reportes lo leen como cliente.';
      `, { transaction });

      // El CHECK acepta NULL a propósito (en SQL, NULL contra un IN da
      // desconocido y el CHECK no falla) — es lo que deja convivir el
      // pasado sin registrar con los pedidos nuevos ya explícitos.
      //
      // Va con guarda porque `ADD CONSTRAINT` sin ella revienta si la
      // migración se corre dos veces, y deja la transacción abortada aunque
      // la columna ya estuviera bien.
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'envios_delivery_a_cargo_check'
          ) THEN
            ALTER TABLE public.envios
              ADD CONSTRAINT envios_delivery_a_cargo_check
              CHECK (delivery_a_cargo IN ('cliente', 'negocio'));
          END IF;
        END $$;
      `, { transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(`
        ALTER TABLE public.envios
          DROP CONSTRAINT IF EXISTS envios_delivery_a_cargo_check;

        ALTER TABLE public.envios
          DROP COLUMN IF EXISTS delivery_a_cargo;
      `, { transaction });
    });
  },
};
