const { sequelize, Envio, Usuario } = require('../../models');
const PedidosNotificaciones = require('../notificaciones/pedidosNotificaciones.service');
const { registrarHistorial } = require('../../utils/historial');
const AuthTracking = require('../authTracking.service');
const { ACTORES } = require('../abastecimiento/estadoMachine');

const TIPO_PAGO_ABASTECIMIENTO = 'abastecimiento_gesicom';

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function montoAbastecimiento(envio) {
  return Math.max(0, Math.round(Number(envio?.abastecimiento_costo) || 0));
}

/**
 * Acredita un pago de abastecimiento confirmado por el webhook de PagoPar.
 *
 * Este es el único remanente del checkout viejo (ver historial de este
 * archivo): ya no se generan pagos nuevos por PagoPar para abastecimiento
 * (reemplazado por transferencia + comprobante, ver
 * services/abastecimiento/abastecimientoFlujo.service.js), pero pagos ya
 * iniciados antes del cambio siguen llegando por este webhook y hay que
 * poder cerrarlos. Salta directo a pago_validado (no pasa por pago_enviado)
 * porque PagoPar ya confirmó el pago fehacientemente.
 */
async function acreditarPagoAbastecimiento(envio, transaction, {
  origen = 'PagoPar',
  req = null,
  usuarioId = null,
  detalle = null,
  respuestaPasarela = null,
} = {}) {
  if (!envio) throw errorHttp('Pedido no encontrado.', 404);
  if (envio.abastecimiento_estado === 'no_requiere') {
    throw errorHttp('Este pedido no requiere abastecimiento Gesicom.');
  }

  let resultado = 'sin_cambios';

  await sequelize.transaction(async (t) => {
    const envioActual = await Envio.findByPk(envio.id, { transaction: t });
    if (!envioActual) throw errorHttp('Pedido no encontrado.', 404);

    if (transaction && transaction.status !== 'PAID') {
      transaction.status = 'PAID';
      const metadata = {
        ...(transaction.metadata || {}),
        tipo: TIPO_PAGO_ABASTECIMIENTO,
        acreditado_por: origen,
      };
      if (respuestaPasarela) metadata.respuesta_pasarela = respuestaPasarela;
      transaction.metadata = metadata;
      await transaction.save({ transaction: t });
    }

    if (!['pendiente_pago', 'pago_enviado'].includes(envioActual.abastecimiento_estado)) {
      resultado = 'ya_acreditado';
      return;
    }

    const estadoAnterior = envioActual.abastecimiento_estado;
    await envioActual.update({
      abastecimiento_estado: 'pago_validado',
      abastecimiento_pagado_at: new Date(),
    }, { transaction: t });

    const sufijo = detalle ? `: ${detalle}` : '';
    await registrarHistorial(
      envioActual.id,
      usuarioId,
      `Abastecimiento Gesicom acreditado por ${origen}${sufijo}. Pago validado.`,
      t,
      { estadoAnterior, estadoNuevo: 'pago_validado', actorTipo: ACTORES.SISTEMA },
    );
    resultado = 'acreditado';
  });

  if (resultado === 'acreditado') {
    PedidosNotificaciones.notificarAbastecimientoPagadoSinBloquear(envio.id);
    const usuario = Usuario?.findByPk ? await Usuario.findByPk(envio.usuario_id).catch(() => null) : null;
    await AuthTracking.registrarEventoConNotificacion({
      tipo: 'stock_payment_paid',
      req,
      usuario,
      email: usuario?.correo_electronico || null,
      metadata: {
        origen,
        detalle,
        envio_id: envio.id,
        numero_pedido: envio.numero_pedido || envio.id,
        payment_transaction_id: transaction?.id || null,
        payment_hash: transaction?.payment_hash || null,
        monto: montoAbastecimiento(envio),
        acreditado_por_usuario_id: usuarioId,
      },
    });
  }

  return resultado;
}

module.exports = {
  TIPO_PAGO_ABASTECIMIENTO,
  acreditarPagoAbastecimiento,
};
