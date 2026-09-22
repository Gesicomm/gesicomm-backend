'use strict';

const { Envio, EnvioItem, Usuario, Tienda, Notificacion, Rol } = require('../../models');
const { UniqueConstraintError } = require('sequelize');
const EmailTransport = require('./emailTransport.service');
const parametros = require('../parametros.service');
const { logger } = require('../../utils/logger');

function formatGs(valor) {
  const n = Math.max(0, Math.round(Number(valor) || 0));
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function urlPedidos() {
  const base = process.env.FRONTEND_URL || 'https://gesicomm.com';
  return `${base.replace(/\/$/, '')}/mis-pedidos`;
}

/** usuario_id de los administradores del mismo inquilino que el comercio. */
async function idsDeAdministradores(inquilinoId) {
  const admins = await Usuario.findAll({
    where: inquilinoId ? { inquilino_id: inquilinoId } : {},
    attributes: ['id'],
    include: [{ model: Rol, attributes: [], where: { nombre: 'administrador' }, required: true }],
    raw: true,
  });
  return admins.map((a) => a.id);
}

/**
 * Crea la misma notificación in-app para varios destinatarios. La unique
 * (usuario_id, tipo, entidad_tipo, entidad_id) hace de idempotencia: si el
 * aviso ya existe para ese usuario no se duplica, y un choque no corta el
 * fan-out al resto.
 */
async function notificarEnApp(usuarioIds, datos) {
  for (const usuarioId of usuarioIds) {
    try {
      await Notificacion.create({ ...datos, usuario_id: usuarioId });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) {
        logger.error({ mensaje: '[PedidosNotificaciones] No se pudo crear la notificación in-app.', usuarioId, error: error.message });
      }
    }
  }
}

function resumenItems(items = []) {
  return items.map((item) => {
    const cantidad = Number(item.cantidad) || 1;
    return `<li><strong>${escapeHtml(item.nombre_producto || 'Producto')}</strong> x${cantidad} - ${formatGs(item.subtotal)}</li>`;
  }).join('');
}

async function notificarAbastecimientoPagado(envioId) {
  const envio = await Envio.findByPk(envioId, {
    include: [
      { model: EnvioItem, as: 'items' },
      { model: Usuario },
    ],
  });

  if (!envio) return { enviado: false, razon: 'Pedido no encontrado' };
  if (envio.abastecimiento_estado !== 'pago_validado') {
    return { enviado: false, razon: 'El abastecimiento no está pagado/validado' };
  }
  if (envio.abastecimiento_notificado_at) {
    return { enviado: false, razon: 'Notificación ya enviada' };
  }

  const destinatario = await parametros.obtener('ABASTECIMIENTO_NOTIFICACION_EMAIL')
    || process.env.BREVO_ADMIN_EMAIL
    || process.env.BREVO_FROM_EMAIL;
  if (!destinatario) return { enviado: false, razon: 'Email de notificación de abastecimiento sin configurar' };

  const tienda = await Tienda.findOne({ where: { usuario_id: envio.usuario_id }, attributes: ['nombre'] });
  const costo = formatGs(envio.abastecimiento_costo);
  const pedidoUrl = urlPedidos();
  const numeroPedido = envio.numero_pedido || envio.id;
  const cliente = [envio.nombre_cliente, envio.apellido_cliente].filter(Boolean).join(' ') || envio.cliente || 'Cliente';
  const tiendaNombre = tienda?.nombre || 'Tu tienda';
  const usuarioPedido = envio.Usuario?.nombre || envio.Usuario?.correo_electronico || `Usuario #${envio.usuario_id}`;

  const subject = `Abastecimiento pagado: procesar pedido #${numeroPedido}`;
  const text = [
    `El pedido #${numeroPedido} ya tiene abastecimiento pagado/acreditado.`,
    `Tienda: ${tiendaNombre}`,
    `Usuario: ${usuarioPedido}`,
    `Número de pedido Gesicom: #${numeroPedido}`,
    `ID interno Gesicom: ${envio.id}`,
    `Cliente: ${cliente}`,
    `Costo de abastecimiento: ${costo}`,
    'Acción requerida: iniciar/procesar el abastecimiento del pedido.',
    `Ver pedidos: ${pedidoUrl}`,
    `Dentro de Gesicom, usá el filtro de administrador "ID interno" con ${envio.id}.`,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px">
      <div style="border:1px solid #fecaca;background:#fff1f2;border-radius:10px;padding:18px 20px;margin-bottom:16px">
        <p style="margin:0 0 6px;color:#991b1b;font-weight:800;text-transform:uppercase;font-size:12px;letter-spacing:.06em">Abastecimiento pagado</p>
        <h1 style="font-size:22px;margin:0 0 8px;color:#111827">Procesar abastecimiento del pedido #${numeroPedido}</h1>
        <p style="margin:0;color:#7f1d1d">El pago/acreditación por <strong>${costo}</strong> ya fue registrado. El pedido puede entrar a abastecimiento.</p>
      </div>

      <p><strong>Tienda:</strong> ${escapeHtml(tiendaNombre)}</p>
      <p><strong>Usuario:</strong> ${escapeHtml(usuarioPedido)}</p>
      <p><strong>Número de pedido Gesicom:</strong> #${numeroPedido}</p>
      <p><strong>ID interno Gesicom:</strong> ${envio.id}</p>
      <p><strong>Cliente:</strong> ${escapeHtml(cliente)}</p>
      <p><strong>Productos:</strong></p>
      <ul>${resumenItems(envio.items || [])}</ul>

      <p style="margin:22px 0">
        <a href="${pedidoUrl}" style="background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">
          Abrir pedidos en Gesicom
        </a>
      </p>

      <p style="color:#374151;font-size:14px">
        Dentro de Gesicom, usá el filtro de administrador <strong>ID interno</strong> con <strong>${envio.id}</strong> para ubicar el registro exacto sin exponer filtros en la URL.
      </p>

      <p style="color:#6b7280;font-size:13px">Este aviso se envía recién cuando el pago de abastecimiento queda acreditado por PagoPar o manualmente por un administrador.</p>
    </div>
  `;

  logger.info({ mensaje: '[PedidosNotificaciones] Notificando abastecimiento pagado.', envioId, destinatario });
  const resultado = await EmailTransport.enviarEmailUnaVez({
    eventKey: `pedido:${envio.id}:abastecimiento_pagado`,
    tipo: 'pedido_abastecimiento_pagado',
    to: destinatario,
    subject,
    text,
    html,
    envioId: envio.id,
    usuarioId: envio.usuario_id,
    metadata: {
      abastecimiento_costo: Number(envio.abastecimiento_costo) || 0,
      estado: envio.estado,
      tienda: tiendaNombre,
    },
  });

  if (resultado.enviado) {
    await envio.update({ abastecimiento_notificado_at: new Date() });
  }

  return resultado;
}

function notificarAbastecimientoPagadoSinBloquear(envioId) {
  setImmediate(() => {
    notificarAbastecimientoPagado(envioId).catch((error) => {
      logger.error({
        mensaje: '[PedidosNotificaciones] Error notificando abastecimiento pagado.',
        envioId,
        error: error.message,
      });
    });
  });
}

/**
 * Avisa por email cuando el comercio sube el comprobante de transferencia
 * (abastecimiento_estado pasa a pago_enviado): un administrador tiene que
 * entrar a validarlo o rechazarlo, no queda ninguna acción automática.
 */
async function notificarComprobanteAbastecimientoSubido(envioId, historialId = null) {
  const envio = await Envio.findByPk(envioId, { include: [{ model: Usuario }] });
  if (!envio) return { enviado: false, razon: 'Pedido no encontrado' };
  if (envio.abastecimiento_estado !== 'pago_enviado') {
    return { enviado: false, razon: 'El abastecimiento no tiene un comprobante pendiente de validación' };
  }

  const tienda = await Tienda.findOne({ where: { usuario_id: envio.usuario_id }, attributes: ['nombre'] });
  const numeroPedido = envio.numero_pedido || envio.id;
  const tiendaNombre = tienda?.nombre || 'Tu tienda';
  const pedidoUrl = urlPedidos();

  // Aviso in-app a los administradores (la campanita del panel). Es el canal
  // principal: es una fila en la base, no depende de Redis ni del SMTP. El
  // email de abajo es refuerzo y puede fallar sin dejar al admin a ciegas,
  // porque además la pestaña "A validar" de /abastecimiento sale de una
  // consulta a abastecimiento_estado y siempre muestra lo que falta validar.
  const adminIds = await idsDeAdministradores(envio.Usuario?.inquilino_id);
  await notificarEnApp(adminIds, {
    tipo: 'ABASTECIMIENTO_COMPROBANTE_SUBIDO',
    entidad_tipo: 'envio_historial',
    entidad_id: historialId || envio.id,
    envio_id: envio.id,
    titulo: 'Nuevo pago de abastecimiento a validar',
    mensaje: `${tiendaNombre} envió el comprobante del pedido #${numeroPedido} por ${formatGs(envio.abastecimiento_costo)}.`,
  });

  const destinatario = await parametros.obtener('ABASTECIMIENTO_NOTIFICACION_EMAIL')
    || process.env.BREVO_ADMIN_EMAIL
    || process.env.BREVO_FROM_EMAIL;
  if (!destinatario) return { enviado: false, razon: 'Email de notificación de abastecimiento sin configurar' };

  const subject = `Comprobante de abastecimiento a validar: pedido #${numeroPedido}`;
  const text = [
    `${tiendaNombre} subió el comprobante de transferencia del abastecimiento del pedido #${numeroPedido}.`,
    `Costo: ${formatGs(envio.abastecimiento_costo)}`,
    `Comprobante: ${envio.abastecimiento_comprobante_url || '(sin URL)'}`,
    'Acción requerida: validar o rechazar el pago dentro de Gesicom.',
    `Ver pedidos: ${pedidoUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px">
      <p style="margin:0 0 6px;color:#92400e;font-weight:800;text-transform:uppercase;font-size:12px;letter-spacing:.06em">Comprobante recibido</p>
      <h1 style="font-size:22px;margin:0 0 8px;color:#111827">Validar pago de abastecimiento del pedido #${numeroPedido}</h1>
      <p><strong>Tienda:</strong> ${escapeHtml(tiendaNombre)}</p>
      <p><strong>Costo:</strong> ${formatGs(envio.abastecimiento_costo)}</p>
      ${envio.abastecimiento_comprobante_url ? `<p><a href="${envio.abastecimiento_comprobante_url}">Ver comprobante</a></p>` : ''}
      <p style="margin:22px 0">
        <a href="${pedidoUrl}" style="background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">
          Abrir pedidos en Gesicom
        </a>
      </p>
    </div>
  `;

  return EmailTransport.enviarEmailUnaVez({
    // Determinístico: el id del evento de historial identifica ESTE envío de
    // comprobante. Con Date.now() como fallback un reintento mandaba el mail
    // de nuevo en vez de reconocerlo como ya enviado.
    eventKey: `pedido:${envio.id}:abastecimiento_comprobante:${historialId || envio.abastecimiento_pago_enviado_at?.getTime?.() || 0}`,
    tipo: 'pedido_abastecimiento_comprobante_subido',
    to: destinatario,
    subject,
    text,
    html,
    envioId: envio.id,
    usuarioId: envio.usuario_id,
    metadata: { abastecimiento_costo: Number(envio.abastecimiento_costo) || 0, tienda: tiendaNombre },
  });
}

function notificarComprobanteAbastecimientoSubidoSinBloquear(envioId, historialId = null) {
  setImmediate(() => {
    notificarComprobanteAbastecimientoSubido(envioId, historialId).catch((error) => {
      logger.error({
        mensaje: '[PedidosNotificaciones] Error notificando comprobante de abastecimiento subido.',
        envioId,
        error: error.message,
      });
    });
  });
}

/** Avisa in-app a la tienda dueña del pedido cuando el admin rechaza el comprobante. */
async function notificarPagoAbastecimientoRechazado(envioId, motivo, historialId) {
  const envio = await Envio.findByPk(envioId);
  if (!envio) return;

  try {
    await Notificacion.create({
      usuario_id: envio.usuario_id,
      tipo: 'ABASTECIMIENTO_PAGO_RECHAZADO',
      entidad_tipo: 'envio_historial',
      entidad_id: historialId || envio.id,
      envio_id: envio.id,
      titulo: 'Comprobante de pago rechazado',
      mensaje: `El pedido #${envio.numero_pedido || envio.id}: ${motivo}`,
    });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
  }
}

function notificarPagoAbastecimientoRechazadoSinBloquear(envioId, motivo, historialId) {
  setImmediate(() => {
    notificarPagoAbastecimientoRechazado(envioId, motivo, historialId).catch((error) => {
      logger.error({
        mensaje: '[PedidosNotificaciones] Error notificando rechazo de pago de abastecimiento.',
        envioId,
        error: error.message,
      });
    });
  });
}

module.exports = {
  notificarAbastecimientoPagado,
  notificarAbastecimientoPagadoSinBloquear,
  notificarComprobanteAbastecimientoSubido,
  notificarComprobanteAbastecimientoSubidoSinBloquear,
  notificarPagoAbastecimientoRechazado,
  notificarPagoAbastecimientoRechazadoSinBloquear,
};
