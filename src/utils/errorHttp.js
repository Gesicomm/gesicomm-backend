'use strict';

/**
 * Error con el código HTTP adentro.
 *
 * El resto del proyecto viene mapeando el status leyendo el TEXTO del
 * mensaje en el controller (`err.message.includes('no encontrado') ? 404 :
 * 400`, ver proveedor.controller.js y landingSimple.controller.js). Eso
 * funciona hasta que alguien reescribe un mensaje y, sin darse cuenta,
 * convierte un 404 en un 400.
 *
 * Acá el service dice explícitamente qué status corresponde y el
 * controller solo lo lee. Se mantiene `errores` (array de motivos) porque
 * es el contrato que ya usan landingCodigo.service.js y el frontend para
 * mostrar varias fallas de validación juntas con un 422.
 *
 * @param {string} mensaje
 * @param {number} [status=400]
 * @param {string[]} [errores]
 */
function errorHttp(mensaje, status = 400, errores = undefined) {
  const err = new Error(mensaje);
  err.status = status;
  if (errores && errores.length) err.errores = errores;
  return err;
}

module.exports = { errorHttp };
