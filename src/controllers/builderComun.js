'use strict';

const { errorHttp } = require('../utils/errorHttp');

/**
 * Piezas compartidas por los controllers del Page Builder.
 *
 * El dueño y el inquilino SIEMPRE salen de req.usuario (el JWT firmado por
 * el servidor), nunca del body, la query o los params — es la regla de
 * middleware/tenant.js y acá no hay excepción.
 */

/**
 * Traduce el error del service a una respuesta HTTP.
 *
 * A diferencia del resto del proyecto, acá NO se adivina el status leyendo
 * el texto del mensaje: los services lanzan con utils/errorHttp.js, que
 * trae `err.status` adentro. `err.errores` (array de motivos) se mantiene
 * porque es el contrato que ya usan landingCodigo.service.js y el frontend
 * para mostrar varias fallas de validación juntas.
 */
function manejarError(res, err, mensajePorDefecto) {
  const status = err.status || (err.errores ? 422 : 500);

  // 4xx son errores del cliente y no dicen nada del sistema: no ensucian
  // los logs. 5xx sí, que para eso están.
  if (status >= 500) console.error('[page-builder]', err);
  else console.warn('[page-builder]', status, err.message);

  return res.status(status).json({
    message: err.message || mensajePorDefecto,
    errores: err.errores,
  });
}

/**
 * El dueño de los recursos del Page Builder. Es el filtro de acceso de
 * todo el módulo: una página es de un usuario, no de una tienda ni de un
 * inquilino.
 */
function duenoDe(req) {
  return req.usuario.id;
}

/** Solo para escribir la columna al crear. Nunca se usa como filtro acá. */
function inquilinoDe(req) {
  return req.usuario.tenantId;
}

/** Contexto de creación: quién es el dueño y a qué inquilino pertenece. */
function contextoDe(req) {
  return { usuario_id: duenoDe(req), inquilino_id: inquilinoDe(req) };
}

/**
 * Valida y devuelve un :id de ruta como entero positivo. Lanza 404 si no
 * lo es — NUNCA deja pasar el valor crudo a una consulta.
 *
 * Sin esto, cualquier string que llegue a un `where: { id }` (un link mal
 * armado, un token de navegación sin resolver como "{{siguiente}}", un
 * usuario tipeando la URL a mano) revienta en Postgres con
 * "invalid input syntax for type integer" — un 500 con el error de SQL
 * crudo en la respuesta. Todos los ids del módulo son SERIAL, así que
 * "no es un entero" y "no existe" son la misma respuesta para el cliente:
 * 404, igual que cuando el recurso pertenece a otro usuario.
 *
 * @param {import('express').Request} req
 * @param {string} [clave='id']
 * @returns {number}
 */
function idDeRuta(req, clave = 'id') {
  const crudo = req.params[clave];
  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw errorHttp('No encontrado.', 404);
  }
  return valor;
}

/**
 * Igual que idDeRuta pero para un campo del body, donde "no vino" es
 * válido (devuelve null) y "vino pero no es un entero" no lo es (422: acá
 * sí es un error del cliente sobre el pedido, no "no encontrado" sobre un
 * recurso). Mismo motivo que idDeRuta: un valor no numérico llegando a un
 * `where: { id }` revienta en Postgres en vez de responder con un mensaje
 * claro.
 *
 * @param {import('express').Request} req
 * @param {string} clave
 * @returns {number|null}
 */
function idDeCuerpo(req, clave) {
  const crudo = req.body?.[clave];
  if (crudo === undefined || crudo === null || crudo === '') return null;
  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw errorHttp(`"${clave}" tiene que ser un número.`, 422);
  }
  return valor;
}

module.exports = { manejarError, duenoDe, inquilinoDe, contextoDe, idDeRuta, idDeCuerpo };
