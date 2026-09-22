'use strict';

/**
 * Red de contención para los handlers `async` de Express 4.
 *
 * Express 4 invoca al handler y descarta lo que devuelve. Si el handler es
 * `async` y su promesa se rechaza, nadie la mira: el rechazo sube como
 * `unhandledRejection` y —con el default de Node 22— se lleva puesto el
 * proceso ENTERO. Así se cayó el servidor con un `read ECONNRESET` del
 * túnel de Postgres adentro de `listarNotificaciones`, que NotificationBell
 * pollea para todo usuario logueado: cualquier hipo de la base lo dispara.
 *
 * `asyncHandler` convierte ese rechazo en un `next(err)` común, que termina
 * en el middleware de errores de server.js: 500 con JSON, log con ruta,
 * método e IP, y el resto de las requests sin enterarse.
 *
 * NO reemplaza al try/catch propio del handler cuando este quiere mapear el
 * error a un 404/409/422 con mensaje para el usuario. Es lo que queda abajo
 * para todo lo que nadie previó.
 *
 * Express 5 hace esto solo. Cuando se migre, todo esto se borra.
 */

/** Marca los handlers ya envueltos: envolver dos veces no rompe, pero suma ruido al stack. */
const YA_ENVUELTO = Symbol('asyncHandler');

/**
 * @param {Function} fn handler o middleware async (o sync: también sirve)
 * @returns {Function} handler de aridad 3 que deriva cualquier rechazo a `next`
 */
function asyncHandler(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('asyncHandler espera una función');
  }
  if (fn[YA_ENVUELTO]) return fn;

  const envuelto = function (req, res, next) {
    // Promise.resolve() normaliza los dos casos: si `fn` es sync y tira,
    // el throw sale de acá y lo atrapa Express (que sí maneja los sync);
    // si es async, el rechazo entra por el .catch.
    try {
      return Promise.resolve(fn.call(this, req, res, next)).catch(next);
    } catch (err) {
      next(err);
      return undefined;
    }
  };

  // El nombre ayuda a leer los stacks: sin esto todos los frames se llaman
  // "envuelto" y no se distingue qué handler falló.
  Object.defineProperty(envuelto, 'name', { value: fn.name || 'handlerAnonimo' });
  envuelto[YA_ENVUELTO] = true;
  return envuelto;
}

/**
 * Envuelve de una todos los handlers exportados por un controller.
 *
 * Se usa al final del archivo del controller (`envolverControlador(module.exports)`)
 * en vez de handler por handler porque así queda cubierto también el próximo
 * handler que alguien agregue: la protección es el default del archivo, no algo
 * que haya que acordarse de escribir.
 *
 * Muta el objeto en lugar de devolver uno nuevo, para que cualquier `require`
 * que ya tenga la referencia vea los handlers envueltos.
 *
 * Se saltean:
 *  - lo que no sea función (constantes, configuraciones);
 *  - los middlewares de error, que Express reconoce por tener 4 parámetros;
 *  - los nombres listados en `excluir`, para los helpers que el controller
 *    exporta pero que NO son handlers (los llaman otros módulos con otra
 *    firma, y ahí `next` no existe).
 *
 * @param {object} controlador normalmente `module.exports`
 * @param {{excluir?: string[]}} [opciones]
 * @returns {object} el mismo objeto, ya mutado
 */
function envolverControlador(controlador, { excluir = [] } = {}) {
  const excluidos = new Set(excluir);

  for (const nombre of Object.keys(controlador)) {
    const valor = controlador[nombre];
    if (typeof valor !== 'function') continue;
    if (excluidos.has(nombre)) continue;
    if (valor.length === 4) continue; // (err, req, res, next)
    controlador[nombre] = asyncHandler(valor);
  }

  return controlador;
}

/**
 * ¿Este handler ya pasó por asyncHandler?
 *
 * Existe para que los tests puedan verificar que un controller entero quedó
 * cubierto, sin exportar el Symbol ni depender de nombres de funciones.
 *
 * @param {Function} fn
 * @returns {boolean}
 */
function estaEnvuelto(fn) {
  return typeof fn === 'function' && fn[YA_ENVUELTO] === true;
}

module.exports = { asyncHandler, envolverControlador, estaEnvuelto };
