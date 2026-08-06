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
  static async enviarConfirmacionEliminacion({ email, nombre, codigo, fechaLimite, urlEstado }) {
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

      const remitente = process.env.SMTP_FROM || `"Gesicomm Privacidad" <${process.env.SMTP_USER}>`;
      const fechaFormateada = fechaLimite
        ? new Date(fechaLimite).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
        : '30 días corridos';

      const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solicitud de eliminación de datos</title>
  <style>
    body { margin: 0; padding: 0; background-color: #0b0f17; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0; }
    .wrapper { max-width: 600px; margin: 40px auto; padding: 0 20px; }
    .card { background-color: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 36px 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    .logo { font-size: 20px; font-weight: 700; color: #38bdf8; letter-spacing: -0.02em; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 4px 12px; background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 9999px; color: #34d399; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; color: #f8fafc; margin: 0 0 16px 0; letter-spacing: -0.02em; }
    p { font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 18px 0; }
    .code-box { background-color: #0b0f17; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center; }
    .code-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; font-weight: 700; margin-bottom: 8px; }
    .code-value { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 20px; font-weight: 700; color: #38bdf8; letter-spacing: 0.05em; word-break: break-all; }
    .info-list { margin: 24px 0; padding: 0; list-style: none; }
    .info-item { font-size: 14px; color: #94a3b8; margin-bottom: 10px; display: flex; align-items: baseline; }
    .info-item strong { color: #e2e8f0; min-width: 140px; }
    .btn-container { text-align: center; margin: 32px 0 16px 0; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 10px; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3); }
    .footer { border-top: 1px solid #1e293b; margin-top: 32px; padding-top: 20px; font-size: 12px; color: #64748b; text-align: center; line-height: 1.5; }
    .footer a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo">Gesicomm</div>
      <div class="badge">✓ Solicitud registrada</div>
      <h1>Hola, ${nombre || 'usuario'}</h1>
      <p>Recibimos correctamente tu solicitud de eliminación de datos personales. Nuestro equipo de privacidad revisará la información para procesar tu requerimiento.</p>
      
      <div class="code-box">
        <div class="code-label">Tu código de seguimiento</div>
        <div class="code-value">${codigo}</div>
      </div>

      <div class="info-list">
        <div class="info-item">
          <strong>Fecha límite:</strong> <span>${fechaFormateada}</span>
        </div>
        <div class="info-item">
          <strong>Estado inicial:</strong> <span>Recibida (en cola de verificación)</span>
        </div>
      </div>

      <div class="btn-container">
        <a href="${urlEstado}" class="btn" target="_blank" rel="noopener noreferrer">Consultar estado en vivo</a>
      </div>

      <div class="footer">
        Guardá este correo. El código es la única forma de consultar el estado de tu trámite.<br>
        Si tenés consultas, podés responder a este correo o escribir a <a href="mailto:contacto@gesicomm.com">contacto@gesicomm.com</a>.
      </div>
    </div>
  </div>
</body>
</html>
      `;

      const text = `Hola ${nombre || ''},\n\nRecibimos tu solicitud de eliminación de datos personales.\n\nTU CÓDIGO DE SEGUIMIENTO: ${codigo}\n\nFecha límite de procesamiento: ${fechaFormateada}\nConsultar estado: ${urlEstado}\n\nEquipo de Privacidad Gesicomm\ncontacto@gesicomm.com`;

      const replyTo = process.env.SMTP_REPLY_TO || 'contacto@gesicomm.com';

      const info = await transporter.sendMail({
        from: remitente,
        replyTo,
        to: email,
        subject: `[Gesicomm] Solicitud de eliminación de datos (${codigo.slice(0, 8)})`,
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

      const remitente = process.env.SMTP_FROM || `"Gesicomm" <${process.env.SMTP_USER}>`;
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
    body { margin: 0; padding: 0; background-color: #0b0f17; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0; }
    .wrapper { max-width: 600px; margin: 40px auto; padding: 0 20px; }
    .card { background-color: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 36px 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    .logo { font-size: 20px; font-weight: 700; color: #38bdf8; letter-spacing: -0.02em; margin-bottom: 24px; }
    h1 { font-size: 22px; font-weight: 700; color: #f8fafc; margin: 0 0 12px 0; letter-spacing: -0.02em; }
    p { font-size: 15px; line-height: 1.6; color: #94a3b8; margin: 0 0 18px 0; }
    .otp-box { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; border-radius: 14px; padding: 28px 20px; margin: 28px 0; text-align: center; }
    .otp-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; margin-bottom: 14px; }
    .otp-code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 42px; font-weight: 800; color: #38bdf8; letter-spacing: 0.15em; line-height: 1; }
    .otp-expires { font-size: 12px; color: #64748b; margin-top: 12px; }
    .otp-expires strong { color: #f59e0b; }
    .warning { background-color: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px; padding: 14px 16px; margin: 20px 0; font-size: 13px; color: #94a3b8; line-height: 1.5; }
    .warning strong { color: #f59e0b; }
    .footer { border-top: 1px solid #1e293b; margin-top: 32px; padding-top: 20px; font-size: 12px; color: #64748b; text-align: center; line-height: 1.5; }
    .footer a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="logo">Gesicomm</div>
      <h1>Verificá tu correo electrónico</h1>
      <p>Hola, <strong style="color:#e2e8f0">${nombre || 'usuario'}</strong>. Para activar tu cuenta en Gesicomm ingresá el siguiente código en la pantalla de verificación:</p>

      <div class="otp-box">
        <div class="otp-label">Código de verificación</div>
        <div class="otp-code">${codigoFormateado}</div>
        <div class="otp-expires">Válido por <strong>15 minutos</strong></div>
      </div>

      <div class="warning">
        <strong>⚠️ No compartás este código con nadie.</strong> Gesicomm nunca te lo pedirá por teléfono, chat o correo electrónico aparte de este.
      </div>

      <p style="margin-bottom:0">Si no creaste una cuenta en Gesicomm, ignorá este correo. Nadie más tiene acceso a tu dirección de email.</p>

      <div class="footer">
        Gesicomm · <a href="https://gesicomm.com">gesicomm.com</a><br>
        Si tenés preguntas escribinos a <a href="mailto:contacto@gesicomm.com">contacto@gesicomm.com</a>
      </div>
    </div>
  </div>
</body>
</html>
      `;

      const text = `Hola ${nombre || ''},\n\nTu código de verificación de Gesicomm es: ${codigo}\n\nEste código vence en 15 minutos. No lo compartas con nadie.\n\nSi no creaste esta cuenta, ignorá este correo.\n\nGesicomm\ncontacto@gesicomm.com`;

      const info = await transporter.sendMail({
        from: remitente,
        replyTo,
        to: email,
        subject: `${codigo} es tu código de verificación de Gesicomm`,
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
}

module.exports = EmailService;
