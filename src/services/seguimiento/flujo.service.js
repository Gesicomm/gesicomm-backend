'use strict';

/**
 * Flujos de mensajes de WhatsApp: el proceso ("Confirmación de pedido") y
 * sus fases ordenadas. Reemplaza a la plantilla suelta como unidad
 * principal del seguimiento.
 *
 * Reglas que vive este service:
 *  - Un flujo se guarda con sus fases de una sola vez, en una transacción:
 *    el frontend manda el array completo y acá se resuelve qué se crea, qué
 *    se actualiza y qué se saca.
 *  - Una fase que ya tiene envíos registrados NUNCA se borra: se desactiva.
 *    Borrarla pondría en NULL el fase_id de los contactos y el historial del
 *    pedido perdería de qué fase salió cada mensaje.
 *  - `orden` se recalcula siempre desde la posición en el array que llega;
 *    el frontend no manda números de orden, manda el array ya ordenado.
 */
const { Op, fn, col } = require('sequelize');
const {
  sequelize, WhatsappFlujo, WhatsappFlujoFase,
  SeguimientoEtiqueta, SeguimientoContacto,
} = require('../../models');
const { errorHttp } = require('../../utils/errorHttp');

/**
 * Fases activas del flujo, con su etiqueta.
 *
 * Es una funcion y no una constante a proposito: Sequelize muta los objetos
 * de `include` que recibe, asi que compartir el mismo literal entre queries
 * termina arrastrando estado de una consulta a la siguiente.
 */
function includeFases() {
  return {
    model: WhatsappFlujoFase,
    as: 'fases',
    required: false,
    where: { activo: true },
    include: [{ model: SeguimientoEtiqueta, as: 'etiqueta', attributes: ['id', 'nombre', 'color'] }],
  };
}

/** El admin ve todo; el resto, solo lo suyo. */
function filtroPropietario({ usuarioId, esAdmin }, extra = {}) {
  return esAdmin ? extra : { ...extra, usuario_id: usuarioId };
}

const ORDEN_FLUJOS = [
  ['tipo', 'ASC'],
  ['predeterminado', 'DESC'],
  ['nombre', 'ASC'],
  [{ model: WhatsappFlujoFase, as: 'fases' }, 'orden', 'ASC'],
];

const TIPOS_FLUJO = new Set([
  'CONFIRMACION_PEDIDO_WEB',
  'VENTA_WHATSAPP',
  'SEGUIMIENTO_ENVIO',
  'ESCALAMIENTO_VENTAS',
]);

const ACTIVACIONES_FLUJO = new Set(['AUTOMATICA', 'MANUAL']);

/**
 * Valida y normaliza las fases que llegan del frontend.
 * Devuelve el array ya con `orden` asignado por posición.
 */
function normalizarFases(fases) {
  if (!Array.isArray(fases) || fases.length === 0) {
    throw errorHttp('El flujo necesita al menos una fase', 422);
  }

  const errores = [];
  const normalizadas = fases.map((fase, i) => {
    const posicion = i + 1;
    const nombre = String(fase?.nombre || '').trim();
    const mensaje = String(fase?.mensaje || '').trim();
    const esperaCruda = fase?.espera_sugerida_minutos;
    const espera = esperaCruda === '' || esperaCruda === null || esperaCruda === undefined
      ? 0
      : Number(esperaCruda);

    if (!nombre) errores.push(`Fase ${posicion}: falta el nombre`);
    if (!mensaje) errores.push(`Fase ${posicion}: el mensaje no puede estar vacío`);
    if (!Number.isInteger(espera) || espera < 0) {
      errores.push(`Fase ${posicion}: la espera sugerida debe ser un número de minutos (0 o más)`);
    }

    return {
      id: fase?.id ? Number(fase.id) : null,
      nombre,
      mensaje,
      orden: posicion,
      espera_sugerida_minutos: espera,
      etiqueta_id: fase?.etiqueta_id ? Number(fase.etiqueta_id) : null,
    };
  });

  if (errores.length) {
    throw errorHttp('Hay fases con datos incompletos', 422, errores);
  }
  return normalizadas;
}

function normalizarTipoFlujo(tipo) {
  const normalizado = String(tipo || 'CONFIRMACION_PEDIDO_WEB').trim().toUpperCase();
  if (!TIPOS_FLUJO.has(normalizado)) {
    throw errorHttp('Tipo de flujo inválido', 422);
  }
  return normalizado;
}

function normalizarActivacion(activacion) {
  const normalizada = String(activacion || 'MANUAL').trim().toUpperCase();
  if (!ACTIVACIONES_FLUJO.has(normalizada)) {
    throw errorHttp('Activación de flujo inválida', 422);
  }
  return normalizada;
}

function validarFlujo({ nombre, tipo, activacion }) {
  if (!String(nombre || '').trim()) {
    throw errorHttp('El nombre del flujo es obligatorio', 422);
  }
  normalizarTipoFlujo(tipo);
  normalizarActivacion(activacion);
}

async function limpiarPredeterminado({ usuarioId, esAdmin, tipo, exceptoId = null }, t) {
  const where = filtroPropietario({ usuarioId, esAdmin }, {
    tipo,
    predeterminado: true,
    ...(exceptoId ? { id: { [Op.ne]: exceptoId } } : {}),
  });
  await WhatsappFlujo.update({ predeterminado: false }, { where, transaction: t });
}

/** Fases del flujo que ya tienen al menos un envío registrado: no se pueden borrar. */
async function idsDeFasesConEnvios(faseIds, t) {
  if (faseIds.length === 0) return new Set();
  const usadas = await SeguimientoContacto.findAll({
    attributes: ['fase_id'],
    where: { fase_id: { [Op.in]: faseIds } },
    group: ['fase_id'],
    transaction: t,
  });
  return new Set(usadas.map((u) => u.fase_id));
}

/**
 * Guarda las fases que llegaron contra las que ya estaban: actualiza las que
 * traen id, crea las nuevas y saca las que ya no vienen (desactivando las
 * que tienen historial).
 */
async function sincronizarFases(flujoId, fasesNormalizadas, t) {
  const existentes = await WhatsappFlujoFase.findAll({
    where: { flujo_id: flujoId },
    transaction: t,
  });
  const porId = new Map(existentes.map((f) => [f.id, f]));
  const idsQueLlegan = new Set(fasesNormalizadas.filter((f) => f.id).map((f) => f.id));

  for (const fase of fasesNormalizadas) {
    const existente = fase.id ? porId.get(fase.id) : null;
    if (existente) {
      await existente.update({
        nombre: fase.nombre,
        mensaje: fase.mensaje,
        orden: fase.orden,
        espera_sugerida_minutos: fase.espera_sugerida_minutos,
        etiqueta_id: fase.etiqueta_id,
        activo: true,
      }, { transaction: t });
    } else {
      // Un id que no pertenece a este flujo se ignora y la fase se crea:
      // es más seguro que dejar que el payload toque fases de otro flujo.
      await WhatsappFlujoFase.create({
        flujo_id: flujoId,
        nombre: fase.nombre,
        mensaje: fase.mensaje,
        orden: fase.orden,
        espera_sugerida_minutos: fase.espera_sugerida_minutos,
        etiqueta_id: fase.etiqueta_id,
        activo: true,
      }, { transaction: t });
    }
  }

  const sacadas = existentes.filter((f) => f.activo && !idsQueLlegan.has(f.id));
  if (sacadas.length === 0) return;

  const conHistorial = await idsDeFasesConEnvios(sacadas.map((f) => f.id), t);
  for (const fase of sacadas) {
    if (conHistorial.has(fase.id)) {
      await fase.update({ activo: false }, { transaction: t });
    } else {
      await fase.destroy({ transaction: t });
    }
  }
}

/** Las etiquetas referenciadas por las fases tienen que ser del mismo usuario. */
async function validarEtiquetas(fasesNormalizadas, { usuarioId, esAdmin }, t) {
  const ids = [...new Set(fasesNormalizadas.map((f) => f.etiqueta_id).filter(Boolean))];
  if (ids.length === 0) return;
  const encontradas = await SeguimientoEtiqueta.findAll({
    where: filtroPropietario({ usuarioId, esAdmin }, { id: { [Op.in]: ids } }),
    attributes: ['id'],
    transaction: t,
  });
  if (encontradas.length !== ids.length) {
    throw errorHttp('Alguna de las etiquetas elegidas no existe', 422);
  }
}

async function listarFlujos({ usuarioId, esAdmin, soloActivos = false }) {
  const where = filtroPropietario({ usuarioId, esAdmin });
  if (soloActivos) where.activo = true;
  return WhatsappFlujo.findAll({
    where,
    include: [includeFases()],
    order: ORDEN_FLUJOS,
  });
}

async function obtenerFlujo(id, { usuarioId, esAdmin }) {
  const flujo = await WhatsappFlujo.findOne({
    where: filtroPropietario({ usuarioId, esAdmin }, { id }),
    include: [includeFases()],
    order: [[{ model: WhatsappFlujoFase, as: 'fases' }, 'orden', 'ASC']],
  });
  if (!flujo) throw errorHttp('Flujo no encontrado', 404);
  return flujo;
}

async function crearFlujo({ nombre, descripcion, activo, fases, tipo, activacion, predeterminado }, { usuarioId, esAdmin }) {
  validarFlujo({ nombre, tipo, activacion });
  const normalizadas = normalizarFases(fases);
  const tipoNormalizado = normalizarTipoFlujo(tipo);
  const activacionNormalizada = normalizarActivacion(activacion);

  const creado = await sequelize.transaction(async (t) => {
    await validarEtiquetas(normalizadas, { usuarioId, esAdmin }, t);
    if (predeterminado) {
      await limpiarPredeterminado({ usuarioId, esAdmin, tipo: tipoNormalizado }, t);
    }
    const flujo = await WhatsappFlujo.create({
      usuario_id: usuarioId,
      nombre: String(nombre).trim(),
      descripcion: descripcion ? String(descripcion).trim() : null,
      activo: activo !== undefined ? !!activo : true,
      tipo: tipoNormalizado,
      activacion: activacionNormalizada,
      predeterminado: !!predeterminado,
    }, { transaction: t });
    await sincronizarFases(flujo.id, normalizadas, t);
    return flujo;
  });

  return obtenerFlujo(creado.id, { usuarioId, esAdmin });
}

async function actualizarFlujo(id, { nombre, descripcion, activo, fases, tipo, activacion, predeterminado }, { usuarioId, esAdmin }) {
  const flujo = await WhatsappFlujo.findOne({
    where: filtroPropietario({ usuarioId, esAdmin }, { id }),
  });
  if (!flujo) throw errorHttp('Flujo no encontrado', 404);

  const tipoFinal = tipo !== undefined ? normalizarTipoFlujo(tipo) : flujo.tipo;
  const activacionFinal = activacion !== undefined ? normalizarActivacion(activacion) : flujo.activacion;

  if (nombre !== undefined || tipo !== undefined || activacion !== undefined) {
    validarFlujo({
      nombre: nombre !== undefined ? nombre : flujo.nombre,
      tipo: tipoFinal,
      activacion: activacionFinal,
    });
  }
  const normalizadas = fases !== undefined ? normalizarFases(fases) : null;

  await sequelize.transaction(async (t) => {
    if (normalizadas) await validarEtiquetas(normalizadas, { usuarioId, esAdmin }, t);
    if (predeterminado === true) {
      await limpiarPredeterminado({ usuarioId, esAdmin, tipo: tipoFinal, exceptoId: flujo.id }, t);
    }
    await flujo.update({
      nombre: nombre !== undefined ? String(nombre).trim() : flujo.nombre,
      descripcion: descripcion !== undefined
        ? (descripcion ? String(descripcion).trim() : null)
        : flujo.descripcion,
      activo: activo !== undefined ? !!activo : flujo.activo,
      tipo: tipoFinal,
      activacion: activacionFinal,
      predeterminado: predeterminado !== undefined ? !!predeterminado : flujo.predeterminado,
    }, { transaction: t });
    if (normalizadas) await sincronizarFases(flujo.id, normalizadas, t);
  });

  return obtenerFlujo(flujo.id, { usuarioId, esAdmin });
}

/**
 * Borra el flujo. Si alguna de sus fases ya se usó, no se borra nada: el
 * flujo y sus fases quedan inactivos, porque el CASCADE de fases dejaría el
 * historial de contactos sin saber de qué fase salió cada mensaje.
 * Devuelve { desactivado: boolean } para que el controller lo cuente.
 */
async function eliminarFlujo(id, { usuarioId, esAdmin }) {
  const flujo = await WhatsappFlujo.findOne({
    where: filtroPropietario({ usuarioId, esAdmin }, { id }),
    include: [{ model: WhatsappFlujoFase, as: 'fases', attributes: ['id'] }],
  });
  if (!flujo) throw errorHttp('Flujo no encontrado', 404);

  const faseIds = (flujo.fases || []).map((f) => f.id);

  return sequelize.transaction(async (t) => {
    const conHistorial = await idsDeFasesConEnvios(faseIds, t);
    if (conHistorial.size > 0) {
      await WhatsappFlujoFase.update({ activo: false }, { where: { flujo_id: flujo.id }, transaction: t });
      await flujo.update({ activo: false }, { transaction: t });
      return { desactivado: true };
    }
    await flujo.destroy({ transaction: t });
    return { desactivado: false };
  });
}

/**
 * Flujos activos del usuario + lo que ya pasó con cada fase EN ESTE PEDIDO.
 * Esto es lo que alimenta el panel del pedido: por fase devuelve cuántas
 * veces se abrió y cuándo fue la última, derivado del historial de
 * contactos. No hay ninguna "fase actual" guardada en ningún lado.
 */
async function estadoFlujosDelPedido(envioId, { usuarioId, esAdmin }) {
  const flujos = await listarFlujos({ usuarioId, esAdmin, soloActivos: true });

  const envios = await SeguimientoContacto.findAll({
    attributes: [
      'fase_id',
      [fn('COUNT', col('id')), 'veces'],
      [fn('MAX', col('created_at')), 'ultimo'],
    ],
    where: { envio_id: envioId, fase_id: { [Op.ne]: null } },
    group: ['fase_id'],
    raw: true,
  });

  const porFase = new Map(envios.map((e) => [
    Number(e.fase_id),
    { veces: Number(e.veces), ultimo_envio_en: e.ultimo },
  ]));

  return flujos.map((flujo) => {
    const plano = flujo.toJSON();
    plano.fases = (plano.fases || []).map((fase) => {
      const stats = porFase.get(fase.id);
      return {
        ...fase,
        envios: stats?.veces || 0,
        ultimo_envio_en: stats?.ultimo_envio_en || null,
      };
    });
    plano.envios_totales = plano.fases.reduce((acc, f) => acc + f.envios, 0);
    return plano;
  });
}

module.exports = {
  listarFlujos,
  obtenerFlujo,
  crearFlujo,
  actualizarFlujo,
  eliminarFlujo,
  estadoFlujosDelPedido,
};
