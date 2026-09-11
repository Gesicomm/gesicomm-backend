'use strict';

const nodemailer = require('nodemailer');
const { NotificationEvent } = require('../../models');
const BrevoService = require('../brevo.service');
const { logger } = require('../../utils/logger');

function proveedorActual() {
  if (process.env.EMAIL_PROVIDER) return process.env.EMAIL_PROVIDER.toLowerCase();
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

async function enviarPorSmtp({ to, subject, html, text }) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    return { enviado: false, razon: 'SMTP no configurado' };
  }

  const port = Number(process.env.SMTP_PORT) || 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || `"Gesicomm" <${user}>`,
    replyTo: process.env.SMTP_REPLY_TO || process.env.BREVO_FROM_EMAIL || 'contacto@gesicomm.com',
    to,
    subject,
    text,
    html,
  });

  return { enviado: true, respuesta: info };
}

async function enviarEmail(payload) {
  const provider = proveedorActual();
  try {
    if (provider === 'brevo') {
      return BrevoService.enviarEmail(payload);
    }
    if (provider === 'smtp') {
      return enviarPorSmtp(payload);
    }

    logger.warn({ mensaje: '[EmailTransport] No hay proveedor de email configurado.', subject: payload.subject });
    return { enviado: false, razon: 'Proveedor de email no configurado' };
  } catch (error) {
    logger.error({
      mensaje: '[EmailTransport] Error enviando email.',
      provider,
      subject: payload.subject,
      error: error.message,
    });
    return { enviado: false, error: error.message };
  }
}

async function enviarEmailUnaVez({
  eventKey,
  tipo,
  to,
  subject,
  html,
  text,
  envioId = null,
  usuarioId = null,
  metadata = null,
}) {
  if (!eventKey) throw new Error('eventKey es requerido para una notificación idempotente.');

  const provider = proveedorActual();
  const [evento, creado] = await NotificationEvent.findOrCreate({
    where: { event_key: eventKey },
    defaults: {
      event_key: eventKey,
      tipo,
      canal: 'email',
      provider,
      estado: 'pending',
      destinatario: Array.isArray(to) ? to.join(',') : String(to || ''),
      asunto: subject,
      envio_id: envioId,
      usuario_id: usuarioId,
      attempts: 0,
      metadata,
    },
  });

  if (!creado && evento.estado === 'sent') {
    return { enviado: false, omitido: true, razon: 'Notificación ya enviada', evento };
  }

  if (!creado && evento.estado === 'sending') {
    return { enviado: false, omitido: true, razon: 'Notificación en proceso', evento };
  }

  await evento.update({
    estado: 'sending',
    provider,
    attempts: (Number(evento.attempts) || 0) + 1,
    last_error: null,
  });

  const resultado = await enviarEmail({ to, subject, html, text });
  if (resultado.enviado) {
    await evento.update({
      estado: 'sent',
      sent_at: new Date(),
      last_error: null,
      provider,
    });
    return { ...resultado, evento };
  }

  await evento.update({
    estado: 'failed',
    last_error: resultado.error || resultado.razon || 'Error desconocido',
    provider,
  });
  return { ...resultado, evento };
}

module.exports = {
  enviarEmail,
  enviarEmailUnaVez,
  proveedorActual,
};
