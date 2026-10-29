'use strict';

const EmailTransport = require('./emailTransport.service');
const MODULOS = require('../modulosAcceso.json');
const { logger } = require('../../utils/logger');

// Paleta de la marca (gesicomm-frontend/src/index.css). Los clientes de correo
// no leen variables CSS, así que van como literales y con estilos en línea.
const C = {
  tinta: '#0b0f0e',
  bosque: '#0f3d2e',
  verde: '#22b573',
  verdeTexto: '#087d4b',
  verdeSuave: '#e9f8f1',
  fondo: '#f3f6f4',
  borde: '#dfe7e3',
  texto: '#3b4a44',
  tenue: '#6b7a73',
};
const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function baseUrl() {
  return (process.env.FRONTEND_URL || 'https://gesicomm.com').replace(/\/$/, '');
}

/** Permisos en el orden del menú, agrupados por sección. */
function permisosAgrupados(permisos = {}) {
  const grupos = [];
  for (const modulo of MODULOS) {
    const nivel = permisos[modulo.clave];
    if (!nivel) continue;
    const seccion = modulo.seccion || 'General';
    let grupo = grupos.find(g => g.seccion === seccion);
    if (!grupo) grupos.push(grupo = { seccion, items: [] });
    grupo.items.push({ nombre: modulo.nombre, nivel: nivel === 'gestionar' ? 'Ver y gestionar' : 'Solo ver', gestiona: nivel === 'gestionar' });
  }
  return grupos;
}

function capitalizar(texto) {
  const t = String(texto).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function filaPermiso({ nombre, nivel, gestiona }) {
  const chip = gestiona
    ? `background:${C.verdeSuave};color:${C.verdeTexto};border:1px solid #bfe9d4;`
    : `background:#f1f4f3;color:${C.texto};border:1px solid ${C.borde};`;
  return `
              <tr>
                <td style="padding:10px 0;border-top:1px solid ${C.borde};font-family:${FUENTE};font-size:15px;line-height:22px;color:${C.tinta};">${escapeHtml(nombre)}</td>
                <td align="right" style="padding:10px 0;border-top:1px solid ${C.borde};white-space:nowrap;">
                  <span style="display:inline-block;${chip}border-radius:999px;padding:3px 10px;font-family:${FUENTE};font-size:13px;line-height:18px;font-weight:600;">${nivel}</span>
                </td>
              </tr>`;
}

function paso(numero, titulo, detalle) {
  return `
          <tr>
            <td width="36" valign="top" style="padding:0 0 16px;">
              <div style="width:28px;height:28px;border-radius:999px;background:${C.bosque};color:#ffffff;font-family:${FUENTE};font-size:14px;font-weight:700;line-height:28px;text-align:center;">${numero}</div>
            </td>
            <td valign="top" style="padding:3px 0 16px 8px;font-family:${FUENTE};">
              <div style="font-size:15px;line-height:22px;font-weight:600;color:${C.tinta};">${titulo}</div>
              <div style="font-size:14px;line-height:21px;color:${C.texto};">${detalle}</div>
            </td>
          </tr>`;
}

/**
 * Arma el correo de bienvenida para una persona que el propietario sumó al
 * equipo de su tienda, con las credenciales que el propietario definió.
 * La contraseña viaja solo en este correo: nunca se loguea ni se devuelve.
 */
function construirBienvenidaEquipo({ nombre, email, password, tienda, invitante, permisos }) {
  const urlLogin = `${baseUrl()}/login`;
  const tiendaNombre = tienda || 'la tienda';
  const quien = invitante || 'El propietario';
  const primerNombre = String(nombre || '').trim().split(/\s+/)[0] || '';
  const grupos = permisosAgrupados(permisos);
  const total = grupos.reduce((n, g) => n + g.items.length, 0);

  const subject = `${quien} te sumó al equipo de ${tiendaNombre} en Gesicom`;
  const preheader = `Tu cuenta ya está activa. Acá tenés tu usuario y contraseña para entrar a ${tiendaNombre}.`;

  const bloquePermisos = grupos.map(g => `
              <tr>
                <td colspan="2" style="padding:14px 0 6px;font-family:${FUENTE};font-size:13px;line-height:18px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.tenue};">${escapeHtml(capitalizar(g.seccion))}</td>
              </tr>${g.items.map(filaPermiso).join('')}`).join('');

  const h = escapeHtml;
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${h(subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .gc-contenedor { width: 100% !important; }
      .gc-pad { padding-left: 22px !important; padding-right: 22px !important; }
      .gc-titulo { font-size: 24px !important; line-height: 31px !important; }
      .gc-boton a { display: block !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${C.fondo};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${h(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.fondo};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="gc-contenedor" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

          <tr>
            <td class="gc-pad" style="padding:0 8px 20px;">
              <a href="${baseUrl()}" style="text-decoration:none;">
                <img src="https://gesicomm.com/icons/icon-128.png" width="32" height="32" alt="" style="vertical-align:middle;border:0;border-radius:8px;">
                <span style="vertical-align:middle;margin-left:10px;font-family:${FUENTE};font-size:20px;font-weight:700;letter-spacing:-.02em;color:${C.tinta};">Gesicom</span>
              </a>
            </td>
          </tr>

          <tr>
            <td style="background:#ffffff;border:1px solid ${C.borde};border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:6px;background:${C.verde};font-size:0;line-height:0;">&nbsp;</td></tr>

                <tr>
                  <td class="gc-pad" style="padding:36px 40px 8px;font-family:${FUENTE};">
                    <span style="display:inline-block;background:${C.verdeSuave};color:${C.verdeTexto};border-radius:999px;padding:4px 12px;font-size:13px;line-height:18px;font-weight:700;">Nuevo acceso al equipo</span>
                    <h1 class="gc-titulo" style="margin:18px 0 12px;font-size:28px;line-height:36px;font-weight:700;letter-spacing:-.02em;color:${C.tinta};">${primerNombre ? `Hola, ${h(primerNombre)}.` : 'Hola.'} Ya sos parte de ${h(tiendaNombre)}</h1>
                    <p style="margin:0;font-size:16px;line-height:26px;color:${C.texto};"><strong style="color:${C.tinta};">${h(quien)}</strong> creó tu cuenta en Gesicom para que trabajes en <strong style="color:${C.tinta};">${h(tiendaNombre)}</strong>. Tu acceso ya está activo.</p>
                  </td>
                </tr>

                <tr>
                  <td class="gc-pad" style="padding:24px 40px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8faf9;border:1px solid ${C.borde};border-radius:12px;">
                      <tr>
                        <td style="padding:20px 22px;font-family:${FUENTE};">
                          <div style="font-size:13px;line-height:18px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.tenue};">Tus datos de ingreso</div>
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
                            <tr>
                              <td style="padding:6px 0;font-size:14px;line-height:21px;color:${C.tenue};width:110px;">Usuario</td>
                              <td style="padding:6px 0;font-size:15px;line-height:22px;font-weight:600;color:${C.tinta};word-break:break-all;">${h(email)}</td>
                            </tr>
                            <tr>
                              <td style="padding:6px 0;font-size:14px;line-height:21px;color:${C.tenue};">Contraseña</td>
                              <td style="padding:6px 0;"><span style="display:inline-block;background:#ffffff;border:1px solid ${C.borde};border-radius:6px;padding:4px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;line-height:22px;font-weight:700;letter-spacing:.02em;color:${C.tinta};word-break:break-all;">${h(password)}</span></td>
                            </tr>
                            <tr>
                              <td style="padding:6px 0;font-size:14px;line-height:21px;color:${C.tenue};">Tienda</td>
                              <td style="padding:6px 0;font-size:15px;line-height:22px;color:${C.tinta};">${h(tiendaNombre)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="gc-pad gc-boton" align="left" style="padding:28px 40px 8px;">
                    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${urlLogin}" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="20%" fillcolor="${C.verde}" stroke="f"><center style="color:${C.tinta};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Iniciar sesión</center></v:roundrect><![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${urlLogin}" target="_blank" rel="noopener" style="display:inline-block;background:${C.verde};color:${C.tinta};font-family:${FUENTE};font-size:16px;line-height:20px;font-weight:700;text-decoration:none;text-align:center;padding:15px 34px;border-radius:10px;">Iniciar sesión</a>
                    <!--<![endif]-->
                  </td>
                </tr>
                <tr>
                  <td class="gc-pad" style="padding:6px 40px 0;font-family:${FUENTE};font-size:13px;line-height:20px;color:${C.tenue};">
                    Si el botón no funciona, copiá este enlace en el navegador:<br>
                    <a href="${urlLogin}" style="color:${C.verdeTexto};word-break:break-all;">${urlLogin}</a>
                  </td>
                </tr>

                ${total ? `<tr>
                  <td class="gc-pad" style="padding:32px 40px 0;">
                    <div style="font-family:${FUENTE};font-size:18px;line-height:26px;font-weight:700;color:${C.tinta};">Qué vas a poder hacer</div>
                    <div style="font-family:${FUENTE};font-size:14px;line-height:21px;color:${C.texto};margin-top:4px;">${total === 1 ? 'Tenés acceso a 1 sección.' : `Tenés acceso a ${total} secciones.`} ${h(quien)} puede ajustar estos permisos cuando quiera.</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${bloquePermisos}
                    </table>
                  </td>
                </tr>` : ''}

                <tr>
                  <td class="gc-pad" style="padding:32px 40px 8px;">
                    <div style="font-family:${FUENTE};font-size:18px;line-height:26px;font-weight:700;color:${C.tinta};margin-bottom:16px;">Primeros pasos</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${paso(1, 'Entrá a Gesicom', 'Usá el botón de arriba con el usuario y la contraseña de este correo.')}${paso(2, `Elegí ${h(tiendaNombre)}`, 'Si trabajás en más de una tienda, la elegís al ingresar.')}${paso(3, 'Cambiá la contraseña', 'Te recomendamos definir una que solo vos sepas: usá «¿Olvidaste tu contraseña?» en la pantalla de ingreso.')}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="gc-pad" style="padding:8px 40px 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.borde};background:#f8faf9;border-radius:8px;">
                      <tr>
                        <td style="padding:14px 16px;font-family:${FUENTE};font-size:14px;line-height:21px;color:${C.texto};">
                          Este correo contiene tu contraseña: no lo reenvíes. ¿No esperabas recibirlo? Respondé este mensaje y lo revisamos.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="gc-pad" align="center" style="padding:24px 16px 8px;font-family:${FUENTE};font-size:13px;line-height:20px;color:${C.tenue};">
              Te llegó este correo porque ${h(quien)} te dio acceso a ${h(tiendaNombre)} en Gesicom.<br>
              <strong style="color:${C.texto};">GESICOM E.A.S.</strong> · Paraguay · <a href="mailto:contacto@gesicomm.com" style="color:${C.verdeTexto};text-decoration:none;">contacto@gesicomm.com</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const lineasPermisos = grupos.flatMap(g => [
    `${capitalizar(g.seccion)}:`,
    ...g.items.map(i => `  - ${i.nombre}: ${i.nivel.toLowerCase()}`),
  ]);
  const text = [
    `Hola${primerNombre ? `, ${primerNombre}` : ''}.`,
    '',
    `${quien} creó tu cuenta en Gesicom para que trabajes en ${tiendaNombre}. Tu acceso ya está activo.`,
    '',
    'TUS DATOS DE INGRESO',
    `Usuario: ${email}`,
    `Contraseña: ${password}`,
    `Tienda: ${tiendaNombre}`,
    '',
    `Iniciar sesión: ${urlLogin}`,
    ...(lineasPermisos.length ? ['', 'QUÉ VAS A PODER HACER', ...lineasPermisos] : []),
    '',
    'Te recomendamos cambiar la contraseña: usá "¿Olvidaste tu contraseña?" en la pantalla de ingreso.',
    'Este correo contiene tu contraseña: no lo reenvíes. ¿No esperabas recibirlo? Respondé este mensaje.',
    '',
    'GESICOM E.A.S. · contacto@gesicomm.com',
  ].join('\n');

  return { subject, html, text, urlLogin };
}

/** Envía la bienvenida. Un fallo del correo nunca deshace el alta. */
async function enviarBienvenidaEquipo(datos) {
  try {
    const { subject, html, text } = construirBienvenidaEquipo(datos);
    const resultado = await EmailTransport.enviarEmail({ to: datos.email, subject, html, text });
    if (!resultado.enviado) {
      logger.warn({ mensaje: '[AccesoEquipo] No se envió la bienvenida.', razon: resultado.razon || resultado.error });
    }
    return { enviado: Boolean(resultado.enviado) };
  } catch (error) {
    logger.error({ mensaje: '[AccesoEquipo] Error enviando la bienvenida.', error: error.message });
    return { enviado: false };
  }
}

module.exports = { construirBienvenidaEquipo, enviarBienvenidaEquipo };
