'use strict';

/**
 * Validación de subdominios de tienda (<sub>.gesicomm.com).
 *
 * Reglas DNS estándar para una etiqueta de hostname (RFC 1035): empieza y
 * termina con alfanumérico, solo minúsculas/dígitos/guión en el medio,
 * 3-63 caracteres. Se agrega: sin guiones consecutivos (evita spoofing
 * visual tipo "go--ogle") y sin prefijo "xn--" (reservado para Punycode,
 * evita homóglifos de dominios internacionalizados).
 */

const { Op } = require('sequelize');
const { Tienda } = require('../models');

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
 * @param {string} sub
 * @param {number|null} excluirTiendaId - para permitir revalidar la propia tienda
 * @returns {Promise<boolean>}
 */
async function disponible(sub, excluirTiendaId = null) {
  const limpio = sub.toLowerCase().trim();
  const where = { subdominio: limpio };
  if (excluirTiendaId) {
    where.id = { [Op.ne]: excluirTiendaId };
  }
  const existe = await Tienda.count({ where });
  return existe === 0;
}

module.exports = { validarFormato, disponible, RESERVADOS };
