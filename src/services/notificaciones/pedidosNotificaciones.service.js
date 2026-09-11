'use strict';

const { Envio, EnvioItem, Usuario, Tienda } = require('../../models');
const EmailTransport = require('./emailTransport.service');
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

async function notificarAbastecimientoPendiente(envioId) {
  const envio = await Envio.findByPk(envioId, {
    include: [
      { model: EnvioItem, as: 'items' },
      { model: Usuario },
    ],
  });

  if (!envio) return { enviado: false, razon: 'Pedido no encontrado' };
  if (envio.abastecimiento_estado !== 'pendiente_pago') {
    return { enviado: false, razon: 'El pedido no tiene abastecimiento pendiente' };
  }
  if (envio.abastecimiento_notificado_at) {
    return { enviado: false, razon: 'Notificación ya enviada' };
  }

  const destinatario = envio.Usuario?.correo_electronico;
  if (!destinatario) return { enviado: false, razon: 'Usuario sin email' };

  const tienda = await Tienda.findOne({ where: { usuario_id: envio.usuario_id }, attributes: ['nombre'] });
  const costo = formatGs(envio.abastecimiento_costo);
  const pedidoUrl = urlPedidos();
  const cliente = [envio.nombre_cliente, envio.apellido_cliente].filter(Boolean).join(' ') || envio.cliente || 'Cliente';
  const tiendaNombre = tienda?.nombre || 'Tu tienda';

  const subject = `Acción requerida: pagá el abastecimiento del pedido #${envio.id}`;
  const text = [
    `Pedido #${envio.id} confirmado.`,
    `Tienda: ${tiendaNombre}`,
    `Cliente: ${cliente}`,
    `Tenés 24 horas para pagar ${costo} y que Gesicom procese el abastecimiento.`,
    `Entrá a Pedidos: ${pedidoUrl}`,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px">
      <div style="border:1px solid #fecaca;background:#fff1f2;border-radius:10px;padding:18px 20px;margin-bottom:16px">
        <p style="margin:0 0 6px;color:#991b1b;font-weight:800;text-transform:uppercase;font-size:12px;letter-spacing:.06em">Acción requerida</p>
        <h1 style="font-size:22px;margin:0 0 8px;color:#111827">Pagá el abastecimiento del pedido #${envio.id}</h1>
        <p style="margin:0;color:#7f1d1d">Tenés <strong>24 horas</strong> para pagar <strong>${costo}</strong> y que Gesicom procese el pedido.</p>
      </div>

      <p><strong>Tienda:</strong> ${escapeHtml(tiendaNombre)}</p>
      <p><strong>Cliente:</strong> ${escapeHtml(cliente)}</p>
      <p><strong>Productos:</strong></p>
      <ul>${resumenItems(envio.items || [])}</ul>

      <p style="margin:22px 0">
        <a href="${pedidoUrl}" style="background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">
          Ver pedido y pagar abastecimiento
        </a>
      </p>

      <p style="color:#6b7280;font-size:13px">Si ya pagaste por transferencia o contacto directo, esperá la acreditación manual de Gesicom.</p>
    </div>
  `;

  logger.info({ mensaje: '[PedidosNotificaciones] Notificando abastecimiento pendiente.', envioId, destinatario });
  const resultado = await EmailTransport.enviarEmailUnaVez({
    eventKey: `pedido:${envio.id}:abastecimiento_pendiente`,
    tipo: 'pedido_abastecimiento_pendiente',
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

function notificarAbastecimientoPendienteSinBloquear(envioId) {
  setImmediate(() => {
    notificarAbastecimientoPendiente(envioId).catch((error) => {
      logger.error({
        mensaje: '[PedidosNotificaciones] Error notificando abastecimiento pendiente.',
        envioId,
        error: error.message,
      });
    });
  });
}

module.exports = {
  notificarAbastecimientoPendiente,
  notificarAbastecimientoPendienteSinBloquear,
};
