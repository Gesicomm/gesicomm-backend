'use strict';

const { BrevoClient } = require('@getbrevo/brevo');
const { logger } = require('../utils/logger');

let client = null;
let clientApiKey = null;

function configuracion() {
  return {
    apiKey: process.env.BREVO_API_KEY,
    fromEmail: process.env.BREVO_FROM_EMAIL || 'contacto@gesicomm.com',
    fromName: process.env.BREVO_FROM_NAME || 'Gesicomm',
    adminEmail: process.env.BREVO_ADMIN_EMAIL || process.env.BREVO_FROM_EMAIL,
  };
}

function cliente() {
  const { apiKey } = configuracion();
  if (!apiKey) return null;

  if (!client || clientApiKey !== apiKey) {
    client = new BrevoClient({ apiKey });
    clientApiKey = apiKey;
  }

  return client;
}

async function enviarEmail({ to, subject, html, text }) {
  const cfg = configuracion();
  const api = cliente();

  if (!api) {
    logger.warn({ mensaje: '[BREVO] BREVO_API_KEY no configurada. No se envió email.', to, subject });
    return { enviado: false, razon: 'BREVO_API_KEY no configurada' };
  }

  const destinatarios = Array.isArray(to) ? to : [to];
  const payload = {
    sender: { name: cfg.fromName, email: cfg.fromEmail },
    to: destinatarios.filter(Boolean).map((emailDestino) => ({ email: emailDestino })),
    subject,
    htmlContent: html,
  };
  if (text) payload.textContent = text;

  if (payload.to.length === 0) {
    return { enviado: false, razon: 'Sin destinatario' };
  }

  try {
    logger.info({ mensaje: '[BREVO] Enviando email transaccional.', to: payload.to.map(d => d.email), subject });
    const respuesta = await api.transactionalEmails.sendTransacEmail(payload);
    logger.info({ mensaje: '[BREVO] Email enviado correctamente.', messageId: respuesta?.messageId });
    return { enviado: true, respuesta };
  } catch (error) {
    logger.error({
      mensaje: '[BREVO] Error enviando email transaccional.',
      error: error.body || error.message,
      subject,
    });
    return {
      enviado: false,
      error: error.body?.message || error.message,
      detalle: error.body,
    };
  }
}

async function enviarPrueba({ to } = {}) {
  const cfg = configuracion();
  const destino = to || cfg.adminEmail;
  return enviarEmail({
    to: destino,
    subject: 'Prueba Brevo - Gesicomm',
    text: 'La integracion de Brevo con Gesicomm funciona correctamente.',
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <h1 style="font-size:20px;margin:0 0 12px">Prueba Brevo - Gesicomm</h1>
        <p>La integracion de Brevo con Gesicomm funciona correctamente.</p>
      </div>
    `,
  });
}

module.exports = {
  enviarEmail,
  enviarPrueba,
  configuracion,
};
