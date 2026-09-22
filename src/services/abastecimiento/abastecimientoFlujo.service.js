'use strict';

const { Transaction, Op } = require('sequelize');
const { sequelize, Envio } = require('../../models');
const { registrarHistorial } = require('../../utils/historial');
const ComprobanteService = require('../comprobante.service');
const PedidosNotificaciones = require('../notificaciones/pedidosNotificaciones.service');
const parametros = require('../parametros.service');
const { ACTORES, validarTransicion, resolverSiguienteEstadoUnico, errorHttp } = require('./estadoMachine');

/** Texto humano por transición, para el detalle del historial. */
const TEXTOS = {
  pago_enviado: 'Comercio subió el comprobante de transferencia. Pago enviado, pendiente de validación.',
  pago_validado: 'Admin validó el pago de abastecimiento.',
  pago_rechazado: 'Admin rechazó el comprobante de pago.',
  proveedor_contactado: 'Admin contactó al proveedor.',
  enviado_por_proveedor: 'El proveedor despachó la mercadería.',
  en_transito_a_gesicomm: 'La mercadería está en tránsito hacia Gesicomm.',
  recibido_en_gesicomm: 'La mercadería llegó a Gesicomm.',
  preparando_envio_a_deposito_cliente: 'Gesicomm está preparando el envío al depósito del comercio.',
  despachado_a_deposito_cliente: 'Gesicomm despachó la mercadería hacia el depósito del comercio.',
  en_transito_a_deposito_cliente: 'La mercadería está en tránsito hacia el depósito del comercio.',
  recibido_en_deposito_cliente: 'El comercio confirmó la recepción en su depósito.',
  disponible_en_gesicomm: 'La mercadería quedó disponible en Gesicomm.',
};

function requiereAbastecimiento(envio) {
  if (!envio) throw errorHttp('Pedido no encontrado.', 404);
  if (envio.abastecimiento_estado === 'no_requiere') {
    throw errorHttp('Este pedido no requiere abastecimiento Gesicom.');
  }
}

/**
 * Núcleo de la máquina de estados: valida la transición y la aplica dentro
 * de una transacción, dejando registro estructurado en EnvioHistorial.
 */
async function aplicarTransicion({ envioId, actor, usuarioId, nuevoEstado, comentario = null, metadata = null, extraUpdate = {} }) {
  let envioActualizado = null;
  let historialId = null;

  await sequelize.transaction(async (t) => {
    const envio = await Envio.findByPk(envioId, { transaction: t, lock: Transaction.LOCK.UPDATE });
    requiereAbastecimiento(envio);

    validarTransicion(envio.abastecimiento_estado, actor, nuevoEstado, envio.tipo_logistica_abastecimiento);

    const estadoAnterior = envio.abastecimiento_estado;
    await envio.update({ abastecimiento_estado: nuevoEstado, ...extraUpdate }, { transaction: t });

    const detalle = comentario ? `${TEXTOS[nuevoEstado] || nuevoEstado}: ${comentario}` : (TEXTOS[nuevoEstado] || nuevoEstado);
    const fila = await registrarHistorial(envioId, usuarioId, detalle, t, {
      estadoAnterior,
      estadoNuevo: nuevoEstado,
      actorTipo: actor,
      metadata,
    });
    historialId = fila?.id || null;

    envioActualizado = envio;
  });

  return { envio: envioActualizado, historialId };
}

/** GET datos de transferencia — no cambia estado, solo lee configuración + monto. */
async function obtenerDatosTransferencia(envio) {
  requiereAbastecimiento(envio);
  const claves = [
    'ABASTECIMIENTO_BANCO_NOMBRE',
    'ABASTECIMIENTO_BANCO_TITULAR',
    'ABASTECIMIENTO_BANCO_CI_RUC',
    'ABASTECIMIENTO_BANCO_NUMERO_CUENTA',
    'ABASTECIMIENTO_ALIAS_TIPO',
    'ABASTECIMIENTO_ALIAS_VALOR',
  ];
  const valores = await parametros.obtenerVarios(claves);
  return {
    banco: valores.ABASTECIMIENTO_BANCO_NOMBRE,
    titular: valores.ABASTECIMIENTO_BANCO_TITULAR,
    ci_ruc: valores.ABASTECIMIENTO_BANCO_CI_RUC,
    numero_cuenta: valores.ABASTECIMIENTO_BANCO_NUMERO_CUENTA,
    alias_tipo: valores.ABASTECIMIENTO_ALIAS_TIPO,
    alias_valor: valores.ABASTECIMIENTO_ALIAS_VALOR,
    monto: Math.max(0, Math.round(Number(envio.abastecimiento_costo) || 0)),
  };
}

/**
 * Sube el comprobante y, en el mismo acto, transiciona pendiente_pago→
 * pago_enviado (o pago_rechazado→pago_enviado en un reenvío). No existe un
 * paso separado de "confirmar envío": subir el comprobante ES la acción del
 * usuario.
 */
async function subirComprobantePago({ envio, usuarioId, fileData }) {
  requiereAbastecimiento(envio);
  if (!['pendiente_pago', 'pago_rechazado'].includes(envio.abastecimiento_estado)) {
    throw errorHttp('El comprobante solo puede subirse mientras el pago está pendiente o fue rechazado.');
  }

  const resultado = await ComprobanteService.procesarComprobanteParaR2(fileData, envio.id, 'abastecimiento-comprobantes');

  const { envio: envioActualizado, historialId } = await aplicarTransicion({
    envioId: envio.id,
    actor: ACTORES.USUARIO,
    usuarioId,
    nuevoEstado: 'pago_enviado',
    metadata: { storage_key: resultado.storage_key, url: resultado.url },
    extraUpdate: {
      abastecimiento_comprobante_url: resultado.url,
      abastecimiento_comprobante_storage_key: resultado.storage_key,
      abastecimiento_pago_enviado_at: new Date(),
      abastecimiento_pago_rechazo_motivo: null,
    },
  });

  PedidosNotificaciones.notificarComprobanteAbastecimientoSubidoSinBloquear(envio.id, historialId);
  return envioActualizado;
}

async function validarPago({ envio, usuarioId }) {
  const { envio: envioActualizado } = await aplicarTransicion({
    envioId: envio.id,
    actor: ACTORES.ADMIN,
    usuarioId,
    nuevoEstado: 'pago_validado',
    extraUpdate: { abastecimiento_pagado_at: new Date() },
  });
  return envioActualizado;
}

async function rechazarPago({ envio, usuarioId, motivo }) {
  if (!motivo || !motivo.trim()) throw errorHttp('El motivo de rechazo es obligatorio.');

  const { envio: envioActualizado, historialId } = await aplicarTransicion({
    envioId: envio.id,
    actor: ACTORES.ADMIN,
    usuarioId,
    nuevoEstado: 'pago_rechazado',
    comentario: motivo,
    extraUpdate: { abastecimiento_pago_rechazo_motivo: motivo },
  });

  PedidosNotificaciones.notificarPagoAbastecimientoRechazadoSinBloquear(envio.id, motivo, historialId);
  return envioActualizado;
}

/** Endpoint "avanzar": el backend resuelve el único siguiente estado, el frontend no elige nada. */
async function avanzar({ envio, usuarioId }) {
  requiereAbastecimiento(envio);
  const nuevoEstado = resolverSiguienteEstadoUnico(envio.abastecimiento_estado, ACTORES.ADMIN, envio.tipo_logistica_abastecimiento);

  const extraUpdate = {};
  if (nuevoEstado === 'recibido_en_gesicomm') extraUpdate.abastecimiento_recibido_at = new Date();

  const { envio: envioActualizado } = await aplicarTransicion({
    envioId: envio.id,
    actor: ACTORES.ADMIN,
    usuarioId,
    nuevoEstado,
    extraUpdate,
  });
  return envioActualizado;
}

async function confirmarRecepcionDeposito({ envio, usuarioId }) {
  const { envio: envioActualizado } = await aplicarTransicion({
    envioId: envio.id,
    actor: ACTORES.USUARIO,
    usuarioId,
    nuevoEstado: 'recibido_en_deposito_cliente',
  });
  return envioActualizado;
}

async function obtenerTimeline(envioId) {
  const { EnvioHistorial, Usuario } = require('../../models');
  const filas = await EnvioHistorial.findAll({
    where: { envio_id: envioId, estado_nuevo: { [Op.ne]: null } },
    order: [['created_at', 'ASC']],
    include: [{ model: Usuario, attributes: ['id', 'nombre'], required: false }],
  });

  return filas.map((f) => ({
    estado_anterior: f.estado_anterior,
    estado_nuevo: f.estado_nuevo,
    actor_tipo: f.actor_tipo,
    usuario: f.Usuario ? { id: f.Usuario.id, nombre: f.Usuario.nombre } : null,
    fecha: f.created_at,
    comentario: f.detalle,
    metadata: f.metadata,
  }));
}

module.exports = {
  obtenerDatosTransferencia,
  subirComprobantePago,
  validarPago,
  rechazarPago,
  avanzar,
  confirmarRecepcionDeposito,
  obtenerTimeline,
};
