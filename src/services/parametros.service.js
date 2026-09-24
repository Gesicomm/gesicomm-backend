const { Parametro } = require('../models');

/**
 * Acceso a los parámetros del sistema, con caché en memoria.
 *
 * La caché evita ir a la base en cada cobro. Es corta (60s) y se invalida
 * sola al escribir, así que un cambio desde el panel se ve enseguida sin
 * reiniciar nada — que es justamente el punto de haberlos sacado del .env.
 */
const TTL_MS = 60 * 1000;
let cache = null;
let cacheHasta = 0;

/** Claves conocidas, para que el panel sepa qué ofrecer. */
const DEFINICIONES = [
  { clave: 'PAGOPAR_PUBLIC_KEY', grupo: 'pagopar', secreto: false, descripcion: 'Token público del comercio de Gesicomm en PagoPar.' },
  { clave: 'PAGOPAR_PRIVATE_KEY', grupo: 'pagopar', secreto: true, descripcion: 'Token privado. Se cifra y nunca vuelve por la API.' },
  { clave: 'PAGOPAR_COMISION_FALLBACK_PCT', grupo: 'pagopar', secreto: false, descripcion: 'Porcentaje de comisión usado para estimar neto si PagoPar no devuelve comisión.' },
  { clave: 'PAGOPAR_COMISIONES_JSON', grupo: 'pagopar', secreto: false, descripcion: 'Mapa opcional de comisiones por forma de pago. Ej: {"26":3.5,"tarjetas":3.5}.' },
  { clave: 'AFILIADOS_PROGRAMA_ACTIVO', grupo: 'afiliados', secreto: false, descripcion: 'Activa o pausa el Programa de Afiliados Gesicom.' },
  { clave: 'AFILIADOS_COMISION_PCT', grupo: 'afiliados', secreto: false, descripcion: 'Porcentaje recurrente sobre suscripciones SaaS elegibles cobradas.' },
  { clave: 'AFILIADOS_REGLAS_JSON', grupo: 'afiliados', secreto: false, descripcion: 'Reglas comerciales visibles del Programa de Afiliados.' },
  { clave: 'ADMIN_TELEFONO_CONTACTO', grupo: 'contacto', secreto: false, descripcion: 'Número al que escriben los comercios ante un problema de cobro o de plan. Con código de país, sin espacios (ej: 595981234567).' },
  { clave: 'ABASTECIMIENTO_NOTIFICACION_EMAIL', grupo: 'notificaciones', secreto: false, descripcion: 'Correo interno de Gesicom que recibe avisos de pedidos con abastecimiento pendiente.' },
  { clave: 'ABASTECIMIENTO_BANCO_NOMBRE', grupo: 'abastecimiento_transferencia', secreto: false, descripcion: 'Banco de la cuenta a la que las tiendas transfieren el costo de abastecimiento.' },
  { clave: 'ABASTECIMIENTO_BANCO_TITULAR', grupo: 'abastecimiento_transferencia', secreto: false, descripcion: 'Titular de la cuenta.' },
  { clave: 'ABASTECIMIENTO_BANCO_CI_RUC', grupo: 'abastecimiento_transferencia', secreto: false, descripcion: 'CI o RUC del titular de la cuenta.' },
  { clave: 'ABASTECIMIENTO_BANCO_NUMERO_CUENTA', grupo: 'abastecimiento_transferencia', secreto: false, descripcion: 'Número de cuenta al que transferir.' },
  { clave: 'ABASTECIMIENTO_ALIAS_TIPO', grupo: 'abastecimiento_transferencia', secreto: false, descripcion: 'Tipo de alias para transferir (CEDULA, TELEFONO o EMAIL).' },
  { clave: 'ABASTECIMIENTO_ALIAS_VALOR', grupo: 'abastecimiento_transferencia', secreto: false, descripcion: 'Número o correo del alias, según el tipo elegido.' },
  { clave: 'ABASTECIMIENTO_TRANSFERENCIA_NOTA', grupo: 'abastecimiento_transferencia', secreto: false, descripcion: 'Nota visible para la tienda al pagar abastecimiento por transferencia.' },
];

async function cargar() {
  const ahora = Date.now();
  if (cache && ahora < cacheHasta) return cache;
  const filas = await Parametro.findAll();
  cache = {};
  for (const f of filas) cache[f.clave] = f.valor;
  cacheHasta = ahora + TTL_MS;
  return cache;
}

function invalidar() {
  cache = null;
  cacheHasta = 0;
}

/**
 * Lee un parámetro. Cae al process.env con el mismo nombre si no está en la
 * base — así la migración desde el .env es gradual y nada se rompe mientras
 * tanto.
 */
async function obtener(clave) {
  const todos = await cargar();
  const valor = todos[clave];
  if (valor !== undefined && valor !== null && valor !== '') return valor;
  return process.env[clave] || null;
}

async function obtenerVarios(claves) {
  const salida = {};
  for (const c of claves) salida[c] = await obtener(c);
  return salida;
}

/** Crea o actualiza. Un valor vacío en un secreto significa "no lo toques". */
async function guardar(clave, valor, opciones = {}) {
  const def = DEFINICIONES.find(d => d.clave === clave) || {};
  const secreto = opciones.secreto !== undefined ? opciones.secreto : !!def.secreto;

  let fila = await Parametro.findOne({ where: { clave } });
  if (!fila) {
    fila = Parametro.build({
      clave,
      secreto,
      grupo: opciones.grupo || def.grupo || 'general',
      descripcion: opciones.descripcion || def.descripcion || null,
    });
    fila.valor = valor;
    await fila.save();
  } else {
    if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
      fila.secreto = secreto;
      fila.valor = valor;
      await fila.save();
    }
  }
  invalidar();
  return fila;
}

/** Lo que se le puede mostrar al panel: los secretos solo como booleano. */
async function listarParaPanel() {
  const filas = await Parametro.findAll();
  const porClave = new Map(filas.map(f => [f.clave, f]));

  return DEFINICIONES.map(def => {
    const fila = porClave.get(def.clave);
    const valor = fila ? fila.valor : null;
    const desdeEnv = !valor && !!process.env[def.clave];
    return {
      clave: def.clave,
      grupo: def.grupo,
      descripcion: def.descripcion,
      secreto: def.secreto,
      configurado: !!valor || desdeEnv,
      origen: valor ? 'base' : (desdeEnv ? 'entorno' : 'sin_configurar'),
      // Los no secretos sí se muestran; los secretos jamás.
      valor: def.secreto ? null : (valor || null),
    };
  });
}

module.exports = { obtener, obtenerVarios, guardar, listarParaPanel, invalidar, DEFINICIONES };
