'use strict';

/**
 * Validación de subdominios de <sub>.gesicomm.com.
 *
 * Reglas DNS estándar para una etiqueta de hostname (RFC 1035): empieza y
 * termina con alfanumérico, solo minúsculas/dígitos/guión en el medio,
 * 3-63 caracteres. Se agrega: sin guiones consecutivos (evita spoofing
 * visual tipo "go--ogle") y sin prefijo "xn--" (reservado para Punycode,
 * evita homóglifos de dominios internacionalizados).
 *
 * ⚠️ EL NAMESPACE ES COMPARTIDO POR DOS COSAS: los subdominios de tienda
 * (tiendas.subdominio) y los del Page Builder (builder_domains.subdominio,
 * ej. calcula.gesicomm.com apuntando a una página). Los dos resuelven
 * contra el mismo hostname, así que disponible() tiene que mirar LAS DOS
 * tablas — si mirara una sola, se podrían crear dos dueños para el mismo
 * host y cuál gana dependería del orden del resolvedor.
 *
 * Postgres no puede imponer una UNIQUE entre dos tablas, así que esta es
 * la única barrera. Queda una ventana de carrera mínima entre el chequeo
 * y el insert; con la escala actual (un puñado de tiendas y un solo
 * administrador creando páginas) es aceptable. Si algún día importa, la
 * salida es una tabla única de hostnames o un trigger.
 */

const { Op } = require('sequelize');
const { Tienda, BuilderDomain } = require('../models');

const SUBDOMINIO_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const RESERVADOS = new Set(
  (process.env.SUBDOMINIO_RESERVADOS ||
    'www,api,app,admin,mail,smtp,login,secure,account,billing,soporte,support,status,dev,staging,test,demo')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
);

/**
 * @param {string} sub
 * @returns {{ valido: boolean, motivo: string|null }}
 */
function validarFormato(sub) {
  if (typeof sub !== 'string' || !sub) {
    return { valido: false, motivo: 'El subdominio es obligatorio.' };
  }
  const limpio = sub.toLowerCase().trim();

  if (!SUBDOMINIO_RE.test(limpio)) {
    return { valido: false, motivo: 'Debe tener entre 3 y 63 caracteres: minúsculas, números y guiones, sin empezar ni terminar con guión.' };
  }
  if (limpio.includes('--')) {
    return { valido: false, motivo: 'No puede tener guiones consecutivos.' };
  }
  if (limpio.startsWith('xn--')) {
    return { valido: false, motivo: 'Ese prefijo está reservado.' };
  }
  if (RESERVADOS.has(limpio)) {
    return { valido: false, motivo: 'Ese subdominio está reservado.' };
  }
  return { valido: true, motivo: null };
}

/**
 * Mira las DOS tablas que comparten el namespace (ver la cabecera).
 *
 * @param {string} sub
 * @param {number|null} excluirTiendaId - para permitir revalidar la propia tienda
 * @param {number|null} excluirHostnameId - ídem para un hostname del Page Builder
 * @returns {Promise<boolean>}
 */
async function disponible(sub, excluirTiendaId = null, excluirHostnameId = null) {
  const limpio = sub.toLowerCase().trim();

  const whereTienda = { subdominio: limpio };
  if (excluirTiendaId) whereTienda.id = { [Op.ne]: excluirTiendaId };
  if (await Tienda.count({ where: whereTienda })) return false;

  const whereBuilder = { subdominio: limpio };
  if (excluirHostnameId) whereBuilder.id = { [Op.ne]: excluirHostnameId };
  if (await BuilderDomain.count({ where: whereBuilder })) return false;

  return true;
}

module.exports = { validarFormato, disponible, RESERVADOS };
