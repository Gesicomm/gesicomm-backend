'use strict';

/**
 * Máquina de estados explícita del abastecimiento Gesicom (reemplaza los
 * `if` repartidos que había antes en abastecimientoPago.js). Cada estado
 * declara, por actor, a qué estados puede pasar. `recibido_en_gesicomm` es
 * el único punto donde la transición depende además de
 * tipo_logistica_abastecimiento (GESICOMM vs PROPIA), ya definido de
 * antemano en definirLogisticaAbastecimiento.
 *
 * El frontend nunca elige el estado destino: para el tramo operativo
 * (proveedor_contactado…disponible_en_gesicomm) llama a un único endpoint
 * "avanzar" y es el backend quien resuelve `siguientesEstados` y aplica esa
 * transición. Esto evita que la UI tenga margen para pedir un estado fuera
 * de lo que la máquina permite.
 */

const ACTORES = Object.freeze({ ADMIN: 'ADMIN', USUARIO: 'USUARIO', SISTEMA: 'SISTEMA' });

const TRANSICIONES = {
  pendiente_pago: { USUARIO: ['pago_enviado'] },
  pago_enviado: { ADMIN: ['pago_validado', 'pago_rechazado'] },
  pago_rechazado: { USUARIO: ['pago_enviado'] },
  pago_validado: { ADMIN: ['proveedor_contactado'] },
  proveedor_contactado: { ADMIN: ['enviado_por_proveedor'] },
  enviado_por_proveedor: { ADMIN: ['en_transito_a_gesicomm', 'en_transito_a_deposito_cliente'] },
  en_transito_a_gesicomm: { ADMIN: ['recibido_en_gesicomm'] },
  recibido_en_gesicomm: { ADMIN: ['preparando_envio_a_deposito_cliente', 'disponible_en_gesicomm'] },
  preparando_envio_a_deposito_cliente: { ADMIN: ['despachado_a_deposito_cliente'] },
  despachado_a_deposito_cliente: { ADMIN: ['en_transito_a_deposito_cliente'] },
  en_transito_a_deposito_cliente: { USUARIO: ['recibido_en_deposito_cliente'] },
};

/** Estados donde el abastecimiento ya terminó y no hay más transiciones. */
const ESTADOS_FINALES = ['no_requiere', 'recibido_en_deposito_cliente', 'disponible_en_gesicomm'];

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/**
 * Devuelve los estados válidos desde `estadoActual` para `actor`, resolviendo
 * la única bifurcación real de la máquina (recibido_en_gesicomm) según
 * `tipoLogistica`.
 */
function siguientesEstados(estadoActual, actor, tipoLogistica, rutaAbastecimiento = 'VIA_GESICOMM') {
  const permitidos = TRANSICIONES[estadoActual]?.[actor] || [];
  
  if (estadoActual === 'enviado_por_proveedor') {
    if (rutaAbastecimiento === 'DIRECTA') return permitidos.filter(e => e === 'en_transito_a_deposito_cliente');
    return permitidos.filter(e => e === 'en_transito_a_gesicomm');
  }

  if (estadoActual !== 'recibido_en_gesicomm') return permitidos;

  if (tipoLogistica === 'PROPIA') return permitidos.filter((e) => e === 'preparando_envio_a_deposito_cliente');
  if (tipoLogistica === 'GESICOMM') return permitidos.filter((e) => e === 'disponible_en_gesicomm');
  return [];
}

/** Lanza 400/403 con mensaje explícito si la transición no está permitida. */
function validarTransicion(estadoActual, actor, nuevoEstado, tipoLogistica, rutaAbastecimiento = 'VIA_GESICOMM') {
  if (ESTADOS_FINALES.includes(estadoActual)) {
    throw errorHttp('Este abastecimiento ya está en un estado final, no admite más transiciones.');
  }
  const permitidos = siguientesEstados(estadoActual, actor, tipoLogistica, rutaAbastecimiento);
  if (permitidos.length === 0) {
    const otroActor = Object.keys(TRANSICIONES[estadoActual] || {}).find((a) => a !== actor);
    if (otroActor) {
      throw errorHttp(`Esta acción le corresponde a ${otroActor === 'ADMIN' ? 'un administrador' : 'la tienda'}, no a ${actor === 'ADMIN' ? 'un administrador' : 'la tienda'}.`, 403);
    }
    throw errorHttp('No hay una transición válida desde el estado actual.');
  }
  if (!permitidos.includes(nuevoEstado)) {
    throw errorHttp(`Transición inválida: desde "${estadoActual}" no se puede pasar a "${nuevoEstado}".`);
  }
}

/**
 * Resuelve el único siguiente estado para el tramo operativo del admin
 * (endpoint "avanzar", sin elección del frontend). Si hubiera más de una
 * opción válida (hoy no ocurre, la bifurcación ya se resuelve por
 * tipoLogistica) devuelve 409 para no adivinar.
 */
function resolverSiguienteEstadoUnico(estadoActual, actor, tipoLogistica, rutaAbastecimiento = 'VIA_GESICOMM') {
  const permitidos = siguientesEstados(estadoActual, actor, tipoLogistica, rutaAbastecimiento);
  if (permitidos.length === 0) {
    throw errorHttp('No hay una transición válida desde el estado actual.');
  }
  if (permitidos.length > 1) {
    throw errorHttp('Hay más de una transición posible; no se puede resolver automáticamente.', 409);
  }
  return permitidos[0];
}

module.exports = {
  ACTORES,
  TRANSICIONES,
  ESTADOS_FINALES,
  siguientesEstados,
  validarTransicion,
  resolverSiguienteEstadoUnico,
  errorHttp,
};
