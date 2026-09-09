'use strict';

/**
 * Dominios propios de clientes: qué registro DNS hay que crear y cómo se
 * comprueba que quedó bien.
 *
 * La arquitectura es una sola y no tiene proveedores de por medio:
 *
 *   mitienda.com → DNS del cliente → IP pública del VPS → Caddy → backend
 *
 * El cliente crea un registro A apuntando a ORIGIN_IP. Cuando el DNS
 * resuelve a esa IP, el dominio queda verificado. Caddy emite y renueva el
 * certificado solo, en el primer handshake TLS, preguntándole antes al
 * backend si el dominio está autorizado (src/routes/interno.js).
 *
 * Un registro A y nada más: sin CNAME, sin TXT de validación, sin custom
 * hostnames en ningún tercero. Antes esto pasaba por Cloudflare for SaaS,
 * que enruta por CNAME —y por eso no servía para dominios raíz, que es lo
 * que la mayoría de los clientes quiere usar— y cobraba por hostname a
 * partir de los primeros 100.
 */

const dns = require('dns').promises;

/**
 * Los estados por los que pasa un dominio.
 *
 *   pendiente     el dominio está cargado pero su DNS todavía no apunta acá
 *   verificado    el DNS ya apunta a nuestra IP; la tienda responde por él
 *   activo        además ya tiene su certificado emitido y sirve por HTTPS
 *   deshabilitado apagado a propósito: no se sirve ni se le emite certificado
 *
 * Los tres primeros se calculan consultando el DNS y el HTTPS del dominio.
 * El cuarto es el único que se guarda, porque es una decisión nuestra y no
 * un hecho del mundo que se pueda ir a mirar.
 */
const ESTADOS = {
  PENDIENTE: 'pendiente',
  VERIFICADO: 'verificado',
  ACTIVO: 'activo',
  DESHABILITADO: 'deshabilitado',
};

/**
 * Sufijos públicos de dos niveles. Sin esta lista, "mitienda.com.py" —el
 * caso más común acá— se leería como el subdominio "mitienda" de la zona
 * "com.py", y le pediríamos al cliente un registro con el nombre
 * equivocado. Cubre la región y los internacionales que más aparecen;
 * cualquier otro sufijo cae en el caso de un solo nivel (.com, .net,
 * .shop), que es el correcto por defecto.
 */
const SUFIJOS_COMPUESTOS = [
  'com.py', 'net.py', 'org.py', 'edu.py',
  'com.ar', 'com.br', 'com.uy', 'com.bo', 'com.co', 'com.mx', 'com.pe', 'com.cl', 'com.ve',
  'com.es', 'co.uk', 'org.uk', 'com.au', 'co.nz',
];

/**
 * Qué va en la casilla "Nombre" (o "Host") del registro DNS. '@' significa
 * la raíz del dominio.
 */
function nombreDelRegistro(dominio) {
  if (!dominio) return '@';
  const partes = dominio.split('.');
  const compuesto = SUFIJOS_COMPUESTOS.find(s => dominio.endsWith(`.${s}`));
  const largoSufijo = compuesto ? compuesto.split('.').length : 1;
  return partes.slice(0, partes.length - largoSufijo - 1).join('.') || '@';
}

function esDominioRaiz(dominio) {
  return nombreDelRegistro(dominio) === '@';
}

/**
 * Los registros que el cliente tiene que cargar en su proveedor, ya listos
 * para renderizar. Se arman acá y no en el frontend para que exista una
 * sola definición de la verdad.
 */
function registrosPara(dominio) {
  const ip = process.env.ORIGIN_IP || null;

  const registros = [{
    tipo: 'A',
    nombre: nombreDelRegistro(dominio),
    valor: ip,
    obligatorio: true,
  }];

  // Casi nadie escribe "www." al compartir un link, pero mucha gente lo
  // tipea al entrar. Sin esto, www.mitienda.com queda muerto. Solo aplica
  // a los dominios raíz: en un subdominio (tienda.mitienda.com) no hay un
  // "www" que valga.
  if (esDominioRaiz(dominio)) {
    registros.push({
      tipo: 'A',
      nombre: 'www',
      valor: ip,
      obligatorio: false,
    });
  }

  return registros;
}

/**
 * ¿El DNS de este dominio ya apunta a nuestro servidor?
 *
 * Es toda la verificación de titularidad que hace falta: poder cambiar el
 * DNS de un dominio es exactamente lo que significa ser su dueño. No hay
 * TXT que cargar aparte.
 *
 * @returns {Promise<{apunta: boolean, detalle: string|null, ips: string[]}>}
 */
async function apuntaANuestroServidor(dominio) {
  const ip = process.env.ORIGIN_IP;
  if (!ip) throw new Error('Falta ORIGIN_IP en el entorno del servidor.');

  try {
    const ips = await dns.resolve4(dominio);
    if (ips.includes(ip)) {
      return { apunta: true, detalle: null, ips };
    }
    return {
      apunta: false,
      ips,
      detalle: `El dominio apunta a ${ips.join(', ')} en lugar de ${ip}. Revisá el valor del registro A.`,
    };
  } catch (err) {
    return {
      apunta: false,
      ips: [],
      detalle: 'Todavía no encontramos el registro A. La propagación del DNS puede tardar desde unos minutos hasta unas horas.',
    };
  }
}

/**
 * ¿El dominio ya sirve por HTTPS con su certificado emitido?
 *
 * Se pregunta contra nuestro propio Caddy, no contra internet: alcanza con
 * que el certificado exista. Es lo que separa 'verificado' de 'activo'.
 */
async function sirvePorHttps(dominio) {
  try {
    const res = await fetch(`https://${dominio}/`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    return res.status > 0;
  } catch (err) {
    // Un error de TLS acá significa "el certificado todavía no está":
    // es un estado esperado, no una falla.
    return false;
  }
}

module.exports = {
  ESTADOS,
  SUFIJOS_COMPUESTOS,
  nombreDelRegistro,
  esDominioRaiz,
  registrosPara,
  apuntaANuestroServidor,
  sirvePorHttps,
};
