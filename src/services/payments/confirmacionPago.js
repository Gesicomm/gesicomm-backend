const { sequelize } = require('../../models');
const envioController = require('../../controllers/envioController');
const { registrarHistorial } = require('../../utils/historial');
const PedidosNotificaciones = require('../notificaciones/pedidosNotificaciones.service');

const { descontarStockYSnapshot } = envioController;
const calcularAbastecimientoDesdeItems = envioController.calcularAbastecimientoDesdeItems || (async () => ({
  requiere: false,
  costo: 0,
  estado: 'no_requiere',
}));

/**
 * Marca una transacción como pagada y confirma el pedido, descontando stock.
 *
 * Vive acá y no adentro del webhook porque hay DOS caminos que llegan a lo
 * mismo: el callback de PagoPar (paso #2 del flujo) y la consulta manual de
 * estado (paso #3, cuando el callback se perdió). Tenerlo duplicado era
 * pedir que las dos ramas se desincronizaran.
 *
 * Todo dentro de una transacción: si el descuento de stock falla, la
 * transacción no queda en PAID y el pedido no queda confirmado a medias.
 *
 * Es idempotente por dos vías: `transaction.status === 'PAID'` corta antes
 * de entrar, y `envio.stock_descontado` evita descontar dos veces.
 *
 * @returns {'ya_pagado'|'confirmado'|'pago_registrado'}
 *   - ya_pagado: la transacción ya estaba en PAID, no se hizo nada.
 *   - confirmado: se marcó PAID y el pedido pasó de Pendiente a Confirmado.
 *   - pago_registrado: se marcó PAID pero el pedido no estaba Pendiente
 *     (ya lo habían movido a mano), así que no se tocó su estado.
 */
async function confirmarPedidoPagado(envio, transaction, { origen = 'PagoPar' } = {}) {
  if (transaction.status === 'PAID') return 'ya_pagado';

  let resultado = 'pago_registrado';
  let notificarPagoAbastecimiento = false;

  await sequelize.transaction(async (t) => {
    transaction.status = 'PAID';
    await transaction.save({ transaction: t });

    if (envio.estado !== 'Pendiente') return;

    if (!envio.stock_descontado) {
      const abastecimiento = await calcularAbastecimientoDesdeItems(envio.items || [], envio.usuario_id, t);
      envio.abastecimiento_estado = abastecimiento.estado;
      envio.abastecimiento_costo = abastecimiento.costo;
      envio.abastecimiento_pagado_at = null;
      envio.abastecimiento_recibido_at = null;
      notificarPagoAbastecimiento = abastecimiento.requiere;
      await descontarStockYSnapshot(envio.items || [], t, envio.usuario_id);
      envio.stock_descontado = true;
    }

    envio.estado = 'Confirmado';
    envio.estado_comercial = 'Confirmado';
    envio.estado_logistico = 'Confirmado';
    await envio.save({ transaction: t });

    await registrarHistorial(
      envio.id,
      null,
      `Pago recibido por ${origen}. Estado actualizado a Confirmado.`,
      t,
    );
    resultado = 'confirmado';
  });

  if (notificarPagoAbastecimiento) {
    PedidosNotificaciones.notificarAbastecimientoPendienteSinBloquear(envio.id);
  }

  return resultado;
}

module.exports = { confirmarPedidoPagado };
