const { sequelize, Envio, PaymentTransaction, Tienda, Usuario } = require('../../models');
const PagoParService = require('./pagoParService');
const SuscripcionService = require('../suscripcion.service');
const PedidosNotificaciones = require('../notificaciones/pedidosNotificaciones.service');
const { registrarHistorial } = require('../../utils/historial');
const AuthTracking = require('../authTracking.service');

const TIPO_PAGO_ABASTECIMIENTO = 'abastecimiento_gesicom';

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function montoAbastecimiento(envio) {
  return Math.max(0, Math.round(Number(envio?.abastecimiento_costo) || 0));
}

function nombreCliente(envio) {
  return [envio?.nombre_cliente, envio?.apellido_cliente].filter(Boolean).join(' ')
    || envio?.cliente
    || 'Cliente Gesicom';
}

async function iniciarCheckoutAbastecimiento(envio) {
  if (!envio) throw errorHttp('Pedido no encontrado.', 404);
  if (envio.abastecimiento_estado !== 'pendiente_pago') {
    throw errorHttp('Este pedido no tiene un abastecimiento pendiente de pago.');
  }
  if (!envio.tipo_logistica_abastecimiento) {
    throw errorHttp('Definí quién prepara y despacha el abastecimiento (Gesicomm o depósito propio) antes de pagar.');
  }

  const amount = montoAbastecimiento(envio);
  if (amount <= 0) {
    throw errorHttp('El costo de abastecimiento no es válido.');
  }

  const gateway = await SuscripcionService.gatewayDeSistema();

  // Quien paga el abastecimiento es EL COMERCIO, no el comprador final. Por
  // eso el documento sale de la Tienda y no de Envio.ruc (que es del cliente
  // que hizo el pedido). El comercio del sistema exige `comprador.documento`
  // y rechaza con "El documento debe estar presente." si va vacio.
  const tienda = await Tienda.findOne({ where: { usuario_id: envio.usuario_id } });
  if (!tienda?.documento) {
    throw errorHttp(
      'Cargá tu número de cédula en Mi tienda → Identidad antes de pagar el abastecimiento: PagoPar lo exige para emitir el cobro.',
    );
  }

  const referencia = `ABAST-${envio.id}-${Date.now()}`;
  const numeroPedido = envio.numero_pedido || envio.id;
  const pedidoFicticio = {
    id: referencia,
    monto: amount,
    costo_envio: 0,
    cliente: tienda.nombre || nombreCliente(envio),
    telefono: envio.telefono || '',
    direccion: envio.direccion || '',
    ciudad: envio.ciudad || '',
    // documento = cedula (obligatorio), ruc = fiscal (vacio si no tiene).
    documento: tienda.documento,
    ruc: tienda.ruc || '',
    descripcion_resumen: `Abastecimiento Gesicom pedido #${numeroPedido}`,
    items: [{
      nombre_producto: `Abastecimiento Gesicom pedido #${numeroPedido}`,
      cantidad: 1,
      subtotal: amount,
    }],
  };

  const resultado = await PagoParService.createTransaction(gateway, pedidoFicticio, null);

  await PaymentTransaction.create({
    envio_id: envio.id,
    provider: 'pagopar',
    payment_reference: referencia,
    payment_hash: resultado.hash_pedido,
    status: 'PENDING',
    amount,
    metadata: {
      tipo: TIPO_PAGO_ABASTECIMIENTO,
      envio_id: envio.id,
    },
  });

  return {
    payment_url: resultado.payment_url,
    hash_pedido: resultado.hash_pedido,
    referencia,
    amount,
  };
}

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
  if (envio.abastecimiento_estado === 'pendiente_pago' && !envio.tipo_logistica_abastecimiento) {
    throw errorHttp('Definí quién prepara y despacha el abastecimiento (Gesicomm o depósito propio) antes de acreditar el pago.');
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

    if (envioActual.abastecimiento_estado !== 'pendiente_pago') {
      resultado = 'ya_acreditado';
      return;
    }

    await envioActual.update({
      abastecimiento_estado: 'en_proceso',
      abastecimiento_pagado_at: new Date(),
    }, { transaction: t });

    const sufijo = detalle ? `: ${detalle}` : '';
    await registrarHistorial(
      envioActual.id,
      usuarioId,
      `Abastecimiento Gesicom acreditado por ${origen}${sufijo}. En proceso.`,
      t,
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

async function marcarAbastecimientoRecibido(envio, {
  usuarioId = null,
  detalle = null,
} = {}) {
  if (!envio) throw errorHttp('Pedido no encontrado.', 404);
  if (envio.abastecimiento_estado === 'no_requiere') {
    throw errorHttp('Este pedido no requiere abastecimiento Gesicom.');
  }
  if (envio.abastecimiento_estado === 'pendiente_pago') {
    throw errorHttp('No se puede recibir mercadería antes de acreditar el pago.');
  }

  let resultado = 'sin_cambios';
  await sequelize.transaction(async (t) => {
    const envioActual = await Envio.findByPk(envio.id, { transaction: t });
    if (!envioActual) throw errorHttp('Pedido no encontrado.', 404);
    if (envioActual.abastecimiento_estado === 'recibido') {
      resultado = 'ya_recibido';
      return;
    }

    await envioActual.update({
      abastecimiento_estado: 'recibido',
      abastecimiento_recibido_at: new Date(),
    }, { transaction: t });

    const sufijo = detalle ? `: ${detalle}` : '';
    await registrarHistorial(envioActual.id, usuarioId, `Abastecimiento Gesicom recibido en deposito${sufijo}.`, t);
    resultado = 'recibido';
  });

  return resultado;
}

module.exports = {
  TIPO_PAGO_ABASTECIMIENTO,
  iniciarCheckoutAbastecimiento,
  acreditarPagoAbastecimiento,
  marcarAbastecimientoRecibido,
};
