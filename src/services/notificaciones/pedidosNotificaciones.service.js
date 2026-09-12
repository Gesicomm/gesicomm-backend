'use strict';

const { Envio, EnvioItem, Usuario, Tienda } = require('../../models');
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
  if (envio.abastecimiento_estado !== 'en_proceso') {
    return { enviado: false, razon: 'El abastecimiento no está pagado/en proceso' };
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

module.exports = {
  notificarAbastecimientoPagado,
  notificarAbastecimientoPagadoSinBloquear,
};
