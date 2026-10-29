'use strict';
const EmailTransport = require('./emailTransport.service');
const { logger } = require('../../utils/logger');

const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const RUTAS = {fisico:'Gestión de E-commerce', personal:'Marca personal', ambas:'Gestión de E-commerce y Marca personal'};

function construirCodigoAcceso(codigo, plan) {
  const url = new URL('/registro', process.env.FRONTEND_URL || 'https://gesicomm.com').href;
  const acceso = RUTAS[codigo.ruta_acceso] || 'Acceso según el plan';
  const limite = codigo.vence_en ? new Date(codigo.vence_en).toLocaleString('es-PY', {timeZone:'America/Asuncion', dateStyle:'long', timeStyle:'short'}) : null;
  const condiciones = [
    `Usá el correo ${codigo.email} para crear tu cuenta en Gesicom.`,
    'Ingresá este código en «Código de prueba» al registrarte y verificá tu correo para entrar.',
    `Tus ${codigo.dias} días empiezan al crear la cuenta. El acceso vence automáticamente al terminar ese período.`,
    'Este código es personal, de un solo uso y está asignado a tu correo. No lo compartas ni lo reenvíes a otras personas.',
    ...(limite ? [`Canjeá el código antes del ${limite} (hora de Paraguay). Este límite no modifica la duración de tu acceso.`] : []),
  ];
  const subject = 'Tu código de acceso a Gesicom';
  const text = `Te invitamos a probar Gesicom.\n\nPlan: ${plan.nombre}\nAcceso: ${acceso}\nDuración: ${codigo.dias} días\nTu código: ${codigo.codigo}\n\n${condiciones.join('\n\n')}\n\nCrear mi cuenta: ${url}\n\nSi no esperabas esta invitación, podés ignorar este correo.`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f6f4;font-family:Arial,sans-serif;color:#13271d;padding:24px 12px">
<table role="presentation" style="max-width:580px;width:100%;margin:auto;background:#fff;border:1px solid #dfe7e3;border-radius:16px"><tr><td style="padding:32px">
<p style="font-size:18px;font-weight:bold;color:#087d4b">Gesicom</p><h1 style="font-size:26px;line-height:1.3">Tu acceso está listo para activar</h1>
<p style="font-size:16px;line-height:1.6">Te invitamos a probar <strong>${h(plan.nombre)}</strong> durante <strong>${codigo.dias} días</strong>.</p>
<p style="font-size:16px;line-height:1.6">Acceso incluido: ${h(acceso)}.</p>
<div style="padding:20px;background:#e9f8f1;border-radius:12px"><span style="font-size:14px">Tu código personal</span><p style="font-size:22px;font-weight:bold;letter-spacing:1px;overflow-wrap:anywhere;margin:10px 0">${h(codigo.codigo)}</p></div>
<ol style="padding-left:22px;font-size:16px;line-height:1.6">${condiciones.map(item => `<li style="margin:14px 0">${h(item)}</li>`).join('')}</ol>
<p style="margin:28px 0"><a href="${h(url)}" style="display:inline-block;padding:14px 22px;background:#087d4b;color:#fff;border-radius:10px;font-size:16px;font-weight:bold;text-decoration:none">Crear mi cuenta</a></p>
<p style="font-size:14px;line-height:1.6;color:#52665a">Si el botón no abre, ingresá a ${h(url)}. Si no esperabas esta invitación, podés ignorar este correo.</p>
</td></tr></table></body></html>`;
  return {to:codigo.email, subject, text, html};
}

async function enviarCodigoAcceso(codigo, plan) {
  if (!codigo.email) return {emailEnviado:false, correoEstado:'sin-destinatario'};
  try {
    const resultado = await EmailTransport.enviarEmailUnaVez({
      ...construirCodigoAcceso(codigo, plan), eventKey:`codigo-acceso:${codigo.id}`, tipo:'codigo_acceso',
    });
    const enviado = resultado.enviado || resultado.evento?.estado === 'sent';
    return {emailEnviado:Boolean(enviado), correoEstado:enviado ? 'enviado' : resultado.evento?.estado === 'sending' ? 'pendiente' : 'fallido'};
  } catch {
    logger.warn({mensaje:'[CodigoAcceso] No se confirmó el envío del correo.', codigoId:codigo.id});
    return {emailEnviado:false, correoEstado:'fallido'};
  }
}
module.exports = {construirCodigoAcceso, enviarCodigoAcceso};
