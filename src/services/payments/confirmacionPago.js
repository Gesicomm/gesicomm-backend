const { sequelize, PaymentTransaction, Envio, Usuario } = require('../../models');
const envioController = require('../../controllers/envioController');
const { registrarHistorial } = require('../../utils/historial');
const AuthTracking = require('../authTracking.service');
const MetaCapiService = require('../metaCapi.service');

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
 * IDEMPOTENCIA BAJO CONCURRENCIA — el detalle que importa:
 *
 * Hay tres caminos que pueden ejecutarse a la vez sobre el mismo pedido: el
 * callback de PagoPar (que ADEMAS reintenta), la pantalla de retorno del
 * comprador (que reconcilia al abrirse) y la consulta manual del comercio.
 * El caso frecuente es el callback y el retorno juntos, porque PagoPar
 * dispara el aviso y redirige el navegador en el mismo instante.
 *
 * Antes el chequeo `transaction.status === 'PAID'` miraba el objeto EN
 * MEMORIA que el caller habia cargado antes de entrar: dos avisos simultaneos
 * lo pasaban los dos y el stock se descontaba DOS VECES. Ahora la fila se
 * relee DENTRO de la transaccion con SELECT ... FOR UPDATE, asi el segundo
 * espera al primero y encuentra el estado ya actualizado.
 *
 * @returns {'ya_pagado'|'confirmado'|'pago_registrado'}
 *   - ya_pagado: la transacción ya estaba en PAID, no se hizo nada.
 *   - confirmado: se marcó PAID y el pedido pasó de Pendiente a Confirmado.
 *   - pago_registrado: se marcó PAID pero el pedido no estaba Pendiente
 *     (ya lo habían movido a mano), así que no se tocó su estado.
 */
async function confirmarPedidoPagado(envio, transaction, { origen = 'PagoPar', req = null } = {}) {
  // Chequeo barato para el caso comun (evita abrir transaccion al pedo); el
  // que realmente decide es el de adentro, con la fila bloqueada.
  if (transaction.status === 'PAID') return 'ya_pagado';

  let resultado = 'pago_registrado';

  await sequelize.transaction(async (t) => {
    // Relectura con bloqueo: dos avisos simultaneos se serializan aca.
    const trxFila = await PaymentTransaction.findByPk(transaction.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!trxFila || trxFila.status === 'PAID') {
      resultado = 'ya_pagado';
      return;
    }

    trxFila.status = 'PAID';
    await trxFila.save({ transaction: t });
    transaction.status = 'PAID'; // el caller sigue usando su copia

    // El Envio se bloquea SIN include: en Postgres un FOR UPDATE sobre el
    // lado nullable de un LEFT JOIN falla. Los items no cambian, asi que se
    // usan los que ya venian cargados.
    const envioFila = await Envio.findByPk(envio.id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!envioFila || envioFila.estado !== 'Pendiente') return;

    if (!envioFila.stock_descontado) {
      const abastecimiento = await calcularAbastecimientoDesdeItems(envio.items || [], envioFila.usuario_id, t);
      envioFila.abastecimiento_estado = abastecimiento.estado;
      envioFila.abastecimiento_costo = abastecimiento.costo;
      envioFila.abastecimiento_pagado_at = null;
      envioFila.abastecimiento_recibido_at = null;
      await descontarStockYSnapshot(envio.items || [], t, envioFila.usuario_id, { tiendaId: envioFila.tienda_id });
      envioFila.stock_descontado = true;
    }

    envioFila.estado = 'Confirmado';
    envioFila.estado_comercial = 'Confirmado';
    envioFila.estado_logistico = 'Confirmado';
    await envioFila.save({ transaction: t });
    await require('../speedbox/service').queueConfirmedOrder(envioFila, t);

    // Reflejar en el objeto del caller, que sigue leyendolo despues.
    Object.assign(envio, {
      estado: 'Confirmado',
      estado_comercial: 'Confirmado',
      estado_logistico: 'Confirmado',
      stock_descontado: envioFila.stock_descontado,
    });

    await registrarHistorial(
      envio.id,
      null,
      `Pago recibido por ${origen}. Estado actualizado a Confirmado.`,
      t,
    );
    resultado = 'confirmado';
  });

  // Purchase para Meta: con PagoPar es ACÁ, cuando el pago es real (ver
  // LandingService.crearCheckout). Solo en la primera confirmación — el
  // bloqueo de arriba garantiza que 'ya_pagado' no llegue acá dos veces.
  // No se espera: el webhook de PagoPar no puede tardar por la Graph API.
  if (resultado === 'confirmado' || resultado === 'pago_registrado') {
    MetaCapiService.enviarCompra(envio, {
      numItems: (envio.items || []).reduce((s, i) => s + (Number(i.cantidad) || 0), 0) || null,
    });
  }

  if (resultado === 'confirmado' || resultado === 'pago_registrado') {
    const usuario = Usuario?.findByPk ? await Usuario.findByPk(envio.usuario_id).catch(() => null) : null;
    await AuthTracking.registrarEventoConNotificacion({
      tipo: 'store_order_payment_paid',
      req,
      usuario,
      email: usuario?.correo_electronico || null,
      metadata: {
        origen,
        envio_id: envio.id,
        numero_pedido: envio.numero_pedido || envio.id,
        payment_transaction_id: transaction.id,
        payment_hash: transaction.payment_hash,
        monto: Number(transaction.amount || envio.monto || 0),
        estado_resultado: resultado,
        cliente: envio.cliente || [envio.nombre_cliente, envio.apellido_cliente].filter(Boolean).join(' ') || null,
      },
    });
  }

  return resultado;
}

module.exports = { confirmarPedidoPagado };
