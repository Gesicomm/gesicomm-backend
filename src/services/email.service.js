'use strict';

const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

class EmailService {
  static getTransporter() {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      return null;
    }

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT) || 465;
    const secure = process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }

  /**
   * Envía correo de confirmación de solicitud de eliminación de datos.
   */
  static async enviarConfirmacionEliminacion({ email, nombre, codigo, fechaLimite, urlEstado, isDuplicada }) {
    try {
      const transporter = this.getTransporter();
      if (!transporter) {
        logger.warn({
          mensaje: '[EmailService] SMTP no configurado (SMTP_USER o SMTP_PASS ausente). Omitiendo envío de correo.',
          codigo,
          email,
        });
        return { enviado: false, razon: 'SMTP no configurado' };
      }

      const remitente = process.env.SMTP_FROM || `"GESICOM E.A.S. Privacidad" <${process.env.SMTP_USER}>`;
      const fechaFormateada = fechaLimite
        ? new Date(fechaLimite).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
        : '30 días corridos';

      
      const estaVencida = fechaLimite && new Date(fechaLimite) < new Date();
      const tituloCorreo = isDuplicada ? 'Recordatorio de trámite en curso' : 'Solicitud de eliminación de datos';
      const mensajePrincipal = isDuplicada 
        ? 'Te recordamos que ya tienes una solicitud de eliminación de datos personales en curso en nuestro sistema. Nuestro equipo de privacidad sigue trabajando para procesar tu requerimiento.'
        : 'Hemos recibido formalmente tu solicitud de eliminación de datos personales. Nuestro equipo de privacidad ya está revisando tu caso para procesarlo según las normativas vigentes.';
      
      let avisoVencimiento = '';
      if (estaVencida) {
        avisoVencimiento = '<div style="background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; color: #fca5a5; font-size: 14px;"><strong>Aviso:</strong> El plazo legal para procesar esta solicitud ha finalizado. Hemos marcado tu caso con prioridad urgente para nuestro equipo.</div>';
      }

      const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tituloCorreo}</title>
  <style>

    body { margin: 0; padding: 0; background-color: #0b0e14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9; }
    .wrapper { max-width: 600px; margin: 40px auto; padding: 0 20px; }
    .card { background-color: #121721; border: 1px solid #1e293b; border-radius: 12px; padding: 40px 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    .header { text-align: left; margin-bottom: 32px; border-bottom: 1px solid #1e293b; padding-bottom: 24px; }
    .logo-container { display: inline-flex; align-items: center; }
    .logo-text { font-size: 22px; font-weight: 700; color: #f8fafc; letter-spacing: -0.03em; margin-left: 12px; vertical-align: middle; }
    .logo-icon { width: 32px; height: 32px; vertical-align: middle; }
    h1 { font-size: 24px; font-weight: 700; color: #ffffff; margin: 0 0 16px 0; letter-spacing: -0.02em; line-height: 1.3; }
    p { font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px 0; }
    strong { color: #f8fafc; font-weight: 600; }
    .btn-container { margin: 32px 0 24px 0; }
    .btn { display: inline-block; background-color: #ffc107; color: #000000 !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 8px; transition: all 0.2s; }
    .btn:hover { background-color: #ffcd38; }
    .box { background-color: #0b0e14; border: 1px solid #1e293b; border-radius: 8px; padding: 24px; margin: 24px 0; }
    .box-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; font-weight: 600; margin-bottom: 8px; }
    .box-value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 24px; font-weight: 700; color: #ffc107; letter-spacing: 0.05em; }
    .footer { border-top: 1px solid #1e293b; margin-top: 40px; padding-top: 24px; font-size: 13px; color: #64748b; line-height: 1.6; }
    .footer a { color: #ffc107; text-decoration: none; }
    .badge { display: inline-block; padding: 4px 12px; background-color: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.2); border-radius: 9999px; color: #ffc107; font-size: 12px; font-weight: 600; margin-bottom: 20px; }

  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <a href="https://gesicomm.com" style="text-decoration: none;">
          <img src="https://gesicomm.com/icons/icon-512.png" alt="G." class="logo-icon" />
          <span class="logo-text">Gesicom</span>
        </a>
      </div>
      <div class="badge">${isDuplicada ? 'Trámite existente' : 'Solicitud en proceso'}</div>
      <h1>Hola, ${nombre || 'usuario'}</h1>
      ${avisoVencimiento}
      <p>${mensajePrincipal}</p>
      
      <div class="box">
        <div class="box-label">Código de seguimiento</div>
        <div class="box-value">${codigo}</div>
      </div>

      <div style="margin: 24px 0; font-size: 14px; color: #94a3b8;">
        <div style="margin-bottom: 8px;"><strong>Fecha límite legal:</strong> ${fechaFormateada}</div>
        <div><strong>Estado actual:</strong> Recibida (en cola de verificación)</div>
      </div>

      <div class="btn-container">
        <a href="${urlEstado}" class="btn" target="_blank" rel="noopener noreferrer">Consultar estado del trámite</a>
      </div>

      <div class="footer">
        Por favor, guardá este correo. Tu código es necesario para consultar el estado del trámite.<br><br>
        <strong>GESICOM E.A.S.</strong><br>
        Si tienes alguna consulta, puedes responder a este correo o escribir a <a href="mailto:contacto@gesicomm.com">contacto@gesicomm.com</a>.
      </div>
    </div>
  </div>
</body>
</html>
`;

      const text = `Hola ${nombre || ''},\n\nRecibimos tu solicitud de eliminación de datos personales.\n\nTU CÓDIGO DE SEGUIMIENTO: ${codigo}\n\nFecha límite de procesamiento: ${fechaFormateada}\nConsultar estado: ${urlEstado}\n\nEquipo de Privacidad GESICOM E.A.S.\ncontacto@gesicomm.com`;

      const replyTo = process.env.SMTP_REPLY_TO || 'contacto@gesicomm.com';

      const info = await transporter.sendMail({
        from: remitente,
        replyTo,
        to: email,
        subject: `[GESICOM E.A.S.] ${isDuplicada ? 'Recordatorio' : 'Solicitud'} de eliminación de datos (${codigo.slice(0, 8)})`,
        text,
        html,
      });

      logger.info({
        mensaje: '[EmailService] Correo de confirmación de eliminación enviado exitosamente.',
        messageId: info.messageId,
        destinatario: email,
        codigo,
      });

      return { enviado: true, messageId: info.messageId };
    } catch (err) {
      logger.error({
        mensaje: '[EmailService] Error al enviar correo de confirmación de eliminación:',
        error: err.message,
        stack: err.stack,
        destinatario: email,
        codigo,
      });
      // No re-lanzamos el error para no fallar el flujo principal de creación de la solicitud
      return { enviado: false, error: err.message };
    }
  }

  /**
   * Envía el código OTP de verificación de email al momento de registrarse.
   */
  static async enviarCodigoVerificacionEmail({ email, nombre, codigo }) {
    try {
      const transporter = this.getTransporter();
      if (!transporter) {
        logger.warn({
          mensaje: '[EmailService] SMTP no configurado. Omitiendo envío de código de verificación.',
          email,
        });
        return { enviado: false, razon: 'SMTP no configurado' };
      }

      const remitente = process.env.SMTP_FROM || `"GESICOM E.A.S." <${process.env.SMTP_USER}>`;
      const replyTo = process.env.SMTP_REPLY_TO || 'contacto@gesicomm.com';

      // Formatear código con espacio al medio para mejor legibilidad: "849 201"
      const codigoFormateado = `${codigo.slice(0, 3)} ${codigo.slice(3)}`;

      const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifica tu correo electrónico</title>
  <style>

    body { margin: 0; padding: 0; background-color: #0b0e14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9; }
    .wrapper { max-width: 600px; margin: 40px auto; padding: 0 20px; }
    .card { background-color: #121721; border: 1px solid #1e293b; border-radius: 12px; padding: 40px 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    .header { text-align: left; margin-bottom: 32px; border-bottom: 1px solid #1e293b; padding-bottom: 24px; }
    .logo-container { display: inline-flex; align-items: center; }
    .logo-text { font-size: 22px; font-weight: 700; color: #f8fafc; letter-spacing: -0.03em; margin-left: 12px; vertical-align: middle; }
    .logo-icon { width: 32px; height: 32px; vertical-align: middle; }
    h1 { font-size: 24px; font-weight: 700; color: #ffffff; margin: 0 0 16px 0; letter-spacing: -0.02em; line-height: 1.3; }
    p { font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px 0; }
    strong { color: #f8fafc; font-weight: 600; }
    .btn-container { margin: 32px 0 24px 0; }
    .btn { display: inline-block; background-color: #ffc107; color: #000000 !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 8px; transition: all 0.2s; }
    .btn:hover { background-color: #ffcd38; }
    .box { background-color: #0b0e14; border: 1px solid #1e293b; border-radius: 8px; padding: 24px; margin: 24px 0; }
    .box-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; font-weight: 600; margin-bottom: 8px; }
    .box-value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 24px; font-weight: 700; color: #ffc107; letter-spacing: 0.05em; }
    .footer { border-top: 1px solid #1e293b; margin-top: 40px; padding-top: 24px; font-size: 13px; color: #64748b; line-height: 1.6; }
    .footer a { color: #ffc107; text-decoration: none; }
    .badge { display: inline-block; padding: 4px 12px; background-color: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.2); border-radius: 9999px; color: #ffc107; font-size: 12px; font-weight: 600; margin-bottom: 20px; }

  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <a href="https://gesicomm.com" style="text-decoration: none;">
          <img src="https://gesicomm.com/icons/icon-512.png" alt="G." class="logo-icon" />
          <span class="logo-text">Gesicom</span>
        </a>
      </div>
      <h1>Verificá tu correo electrónico</h1>
      <p>Hola, <strong>${nombre || 'usuario'}</strong>. Para activar tu cuenta de Gesicom y empezar a usar la plataforma, ingresá el siguiente código en la pantalla de verificación:</p>

      <div class="box" style="text-align: center; padding: 32px 20px;">
        <div class="box-label">Código de seguridad</div>
        <div class="box-value" style="font-size: 36px; letter-spacing: 0.15em;">${codigoFormateado}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 16px;">Válido por <strong>15 minutos</strong></div>
      </div>

      <p style="font-size: 14px; background-color: rgba(255, 193, 7, 0.05); border-left: 3px solid #ffc107; padding: 12px 16px; margin: 24px 0; color: #cbd5e1;">
        <strong style="color: #ffc107;">Aviso de seguridad:</strong> Nunca compartas este código. Ningún miembro de nuestro equipo te lo pedirá.
      </p>

      <p style="font-size: 13px;">Si no has intentado crear una cuenta en Gesicom, puedes ignorar este mensaje de forma segura.</p>

      <div class="footer">
        <strong>GESICOM E.A.S.</strong> · <a href="https://gesicomm.com">gesicomm.com</a><br>
        Si tienes preguntas escríbenos a <a href="mailto:contacto@gesicomm.com">contacto@gesicomm.com</a>
      </div>
    </div>
  </div>
</body>
</html>
`;

      const text = `Hola ${nombre || ''},\n\nTu código de verificación de GESICOM E.A.S. es: ${codigo}\n\nEste código vence en 15 minutos. No lo compartas con nadie.\n\nSi no creaste esta cuenta, ignorá este correo.\n\nGESICOM E.A.S.\ncontacto@gesicomm.com`;

      const info = await transporter.sendMail({
        from: remitente,
        replyTo,
        to: email,
        subject: `${codigo} es tu código de verificación de GESICOM E.A.S.`,
        text,
        html,
      });

      logger.info({
        mensaje: '[EmailService] Código de verificación enviado.',
        messageId: info.messageId,
        destinatario: email,
      });

      return { enviado: true, messageId: info.messageId };
    } catch (err) {
      logger.error({
        mensaje: '[EmailService] Error al enviar código de verificación:',
        error: err.message,
        destinatario: email,
      });
      return { enviado: false, error: err.message };
    }
  }

  /**
   * Envía el enlace de recuperación de contraseña.
   */
  static async enviarRecuperacionPassword({ email, nombre, urlReset }) {
    try {
      const transporter = this.getTransporter();
      if (!transporter) {
        logger.warn({
          mensaje: '[EmailService] SMTP no configurado. Omitiendo envío de recuperación de contraseña.',
          email,
        });
        return { enviado: false, razon: 'SMTP no configurado' };
      }

      const remitente = process.env.SMTP_FROM || `"GESICOM E.A.S." <${process.env.SMTP_USER}>`;
      const replyTo = process.env.SMTP_REPLY_TO || 'contacto@gesicomm.com';

      const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Restablecer contraseña</title>
  <style>

    body { margin: 0; padding: 0; background-color: #0b0e14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9; }
    .wrapper { max-width: 600px; margin: 40px auto; padding: 0 20px; }
    .card { background-color: #121721; border: 1px solid #1e293b; border-radius: 12px; padding: 40px 36px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    .header { text-align: left; margin-bottom: 32px; border-bottom: 1px solid #1e293b; padding-bottom: 24px; }
    .logo-container { display: inline-flex; align-items: center; }
    .logo-text { font-size: 22px; font-weight: 700; color: #f8fafc; letter-spacing: -0.03em; margin-left: 12px; vertical-align: middle; }
    .logo-icon { width: 32px; height: 32px; vertical-align: middle; }
    h1 { font-size: 24px; font-weight: 700; color: #ffffff; margin: 0 0 16px 0; letter-spacing: -0.02em; line-height: 1.3; }
    p { font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 20px 0; }
    strong { color: #f8fafc; font-weight: 600; }
    .btn-container { margin: 32px 0 24px 0; }
    .btn { display: inline-block; background-color: #ffc107; color: #000000 !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 8px; transition: all 0.2s; }
    .btn:hover { background-color: #ffcd38; }
    .box { background-color: #0b0e14; border: 1px solid #1e293b; border-radius: 8px; padding: 24px; margin: 24px 0; }
    .box-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; font-weight: 600; margin-bottom: 8px; }
    .box-value { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 24px; font-weight: 700; color: #ffc107; letter-spacing: 0.05em; }
    .footer { border-top: 1px solid #1e293b; margin-top: 40px; padding-top: 24px; font-size: 13px; color: #64748b; line-height: 1.6; }
    .footer a { color: #ffc107; text-decoration: none; }
    .badge { display: inline-block; padding: 4px 12px; background-color: rgba(255, 193, 7, 0.1); border: 1px solid rgba(255, 193, 7, 0.2); border-radius: 9999px; color: #ffc107; font-size: 12px; font-weight: 600; margin-bottom: 20px; }

  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <a href="https://gesicomm.com" style="text-decoration: none;">
          <img src="https://gesicomm.com/icons/icon-512.png" alt="G." class="logo-icon" />
          <span class="logo-text">Gesicom</span>
        </a>
      </div>
      <h1>Restablecé tu contraseña</h1>
      <p>Hola, <strong>${nombre || 'usuario'}</strong>. Hemos recibido una solicitud para cambiar la contraseña de tu cuenta de Gesicom.</p>

      <div class="btn-container">
        <a href="${urlReset}" class="btn" target="_blank" rel="noopener noreferrer">Crear nueva contraseña</a>
      </div>

      <p style="font-size: 13px; color: #cbd5e1;">
        Este enlace es válido durante <strong>1 hora</strong> y solo se puede utilizar una vez. Si no solicitaste un cambio de contraseña, ignora este correo; tu cuenta sigue estando segura.
      </p>

      <div class="footer">
        Si el botón superior no funciona, copia y pega la siguiente dirección en tu navegador:<br>
        <a href="${urlReset}" style="word-break: break-all; font-size: 12px;">${urlReset}</a><br><br>
        <strong>GESICOM E.A.S.</strong> · <a href="https://gesicomm.com">gesicomm.com</a>
      </div>
    </div>
  </div>
</body>
</html>
`;

      const text = `Hola ${nombre || ''},\n\nRecibimos una solicitud para restablecer tu contraseña de GESICOM E.A.S..\n\nAbrí este enlace para crear una nueva contraseña:\n${urlReset}\n\nEl enlace vence en 1 hora y se puede usar una sola vez. Si no pediste este cambio, ignorá este correo.\n\nGESICOM E.A.S.\ncontacto@gesicomm.com`;

      const info = await transporter.sendMail({
        from: remitente,
        replyTo,
        to: email,
        subject: 'Restablecé tu contraseña de GESICOM E.A.S.',
        text,
        html,
      });

      logger.info({
        mensaje: '[EmailService] Recuperación de contraseña enviada.',
        messageId: info.messageId,
        destinatario: email,
      });

      return { enviado: true, messageId: info.messageId };
    } catch (err) {
      logger.error({
        mensaje: '[EmailService] Error al enviar recuperación de contraseña:',
        error: err.message,
        destinatario: email,
      });
      return { enviado: false, error: err.message };
    }
  }
}

module.exports = EmailService;
