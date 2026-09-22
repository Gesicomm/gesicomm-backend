'use strict';

const { logger: loggerPorDefecto } = require('./logger');

/**
 * Manejadores de último recurso del proceso.
 *
 * ============================================================
 * DECISIÓN — qué pasa con el proceso en cada caso
 * ============================================================
 *
 * `unhandledRejection` → SE LOGUEA Y EL PROCESO SIGUE VIVO.
 *
 *   Una promesa rechazada que nadie atrapó deja colgada, como mucho, LA
 *   request que la disparó (el cliente se come un timeout). El resto del
 *   proceso está sano: el heap, el pool de conexiones y los cron siguen
 *   igual que antes. Matarlo por eso es cambiar un error para un usuario
 *   por una caída para todos, que es exactamente lo que pasó con el
 *   ECONNRESET de `listarNotificaciones`.
 *
 *   El costo de reiniciar acá no es teórico: este server tarda ~2 minutos
 *   en escuchar (migraciones + validarEsquema corren ANTES del listen, ver
 *   el final de server.js). Dos minutos de caída total por un hipo del
 *   túnel no se paga.
 *
 *   Registrar este listener además APAGA el default de Node 22
 *   (`--unhandled-rejections=throw`), que es el que venía matando el
 *   proceso. Con `asyncHandler` puesto en los controllers, lo que llegue
 *   acá ya no deberían ser requests sino promesas sueltas (jobs, webhooks,
 *   workers) — mismo razonamiento, mismo trato.
 *
 *   ⚠️ Seguir vivo no es "ya está resuelto": cada línea de estas es un bug
 *   a arreglar en el origen. Para eso se loguea con `evento` propio, para
 *   poder buscarlas en logs/errores.log.
 *
 * `uncaughtException` → SE LOGUEA Y EL PROCESO MUERE (exit 1).
 *
 *   Acá es distinto: una excepción síncrona que llegó hasta arriba cortó
 *   un callback a la mitad, en un punto que nadie eligió. Puede haber
 *   quedado una transacción abierta, un lock tomado o una estructura a
 *   medio escribir. Seguir atendiendo con ese estado es servir datos que
 *   no sabemos si son ciertos, que es peor que no atender.
 *
 *   Se cierra el server HTTP primero para no cortar las requests en vuelo,
 *   y se sale con código 1 para que el supervisor levante el proceso de
 *   nuevo.
 *
 *   ⚠️ SUPUESTO: hay algo que reinicia el proceso (restart policy del
 *   contenedor, systemd, pm2). Si NO lo hay, esta salida se convierte en
 *   una caída hasta que alguien lo levante a mano: en ese caso hay que
 *   poner el supervisor, no sacar el exit.
 */

let instalados = false;

/**
 * @param {object} [opciones]
 * @param {() => (import('http').Server|null)} [opciones.obtenerServidor] devuelve el server HTTP si ya está escuchando
 * @param {(codigo: number) => void} [opciones.salir] inyectable para poder testear sin matar a Jest
 * @param {object} [opciones.log] logger con .error()
 * @param {number} [opciones.msEsperaCierre] cuánto se le da al server para drenar antes del exit forzado
 * @param {boolean} [opciones.registrar] false devuelve los handlers sin engancharlos al proceso (tests)
 * @returns {{manejarRechazo: Function, manejarExcepcion: Function}} los handlers, para poder ejercitarlos en tests
 */
function instalarManejadoresDeProceso({
  obtenerServidor = () => null,
  salir = (codigo) => process.exit(codigo),
  log = loggerPorDefecto,
  msEsperaCierre = 5000,
  registrar = true,
} = {}) {
  /**
   * `razon` puede ser cualquier cosa: `Promise.reject('texto')` es válido.
   * Por eso no se asume que haya .message ni .stack.
   */
  const manejarRechazo = (razon) => {
    const esError = razon instanceof Error;
    log.error({
      evento: 'PROMESA_RECHAZADA_SIN_MANEJAR',
      mensaje: esError ? razon.message : String(razon),
      codigo: esError ? razon.code : undefined,
      stack: esError ? razon.stack : undefined,
      // Decisión documentada arriba: acá NO se sale.
      accion: 'proceso_sigue_vivo',
    });
  };

  const manejarExcepcion = (err) => {
    log.error({
      evento: 'EXCEPCION_NO_ATRAPADA',
      mensaje: err?.message ?? String(err),
      codigo: err?.code,
      stack: err?.stack,
      accion: 'cerrando_y_saliendo',
    });

    const servidor = obtenerServidor();
    if (!servidor) return salir(1);

    // El timer se arma ANTES del close: si el drenado se cuelga (una
    // conexión keep-alive que no cierra), igual salimos.
    const forzar = setTimeout(() => salir(1), msEsperaCierre);
    if (typeof forzar.unref === 'function') forzar.unref();

    servidor.close(() => {
      clearTimeout(forzar);
      salir(1);
    });
    return undefined;
  };

  // Idempotente: requerir el módulo dos veces no debe dejar dos listeners
  // logueando lo mismo (ni dos exit en carrera).
  if (registrar && !instalados) {
    process.on('unhandledRejection', manejarRechazo);
    process.on('uncaughtException', manejarExcepcion);
    instalados = true;
  }

  return { manejarRechazo, manejarExcepcion };
}

module.exports = { instalarManejadoresDeProceso };
