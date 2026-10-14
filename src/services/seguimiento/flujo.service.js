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
const { ETAPAS } = require('./flujosBase');

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
  'PERSONALIZADO',
]);

const ACTIVACIONES_FLUJO = new Set(['AUTOMATICA', 'MANUAL']);
const ESTADOS_PEDIDO = new Set([
  'Pendiente',
  'EnSeguimiento',
  'Confirmado',
  'Preparado',
  'Despachado',
  'Reprogramado',
  'Entregado',
  'Cancelado',
  'Devuelto',
  'Perdido',
]);
const ACCIONES_OPERATIVAS = new Set(['PREPARAR_PEDIDO', 'DESPACHAR_PEDIDO', 'AVISO_EN_CAMINO', 'CAMBIAR_ESTADO']);
const ACCIONES_OPERATIVAS_PROTEGIDAS = new Set(['PREPARAR_PEDIDO', 'DESPACHAR_PEDIDO']);

const NOMBRES_LEGACY_POR_TIPO = {
  CONFIRMACION_PEDIDO_WEB: new Set(['contacto inicial']),
};

function normalizarNombreBase(nombre) {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function accionOperativaBase(tipo, fase) {
  if (tipo !== 'SEGUIMIENTO_ENVIO') return null;
  const nombre = normalizarNombreBase(fase?.nombre);
  if (/confirm|prepar/.test(nombre)) return 'PREPARAR_PEDIDO';
  if (/despach/.test(nombre)) return 'DESPACHAR_PEDIDO';
  if (/camino/.test(nombre)) return 'AVISO_EN_CAMINO';
  return null;
}

function transicionPorAccion(accion) {
  if (accion === 'PREPARAR_PEDIDO') return { desde: 'Confirmado', hasta: 'Preparado' };
  if (accion === 'DESPACHAR_PEDIDO') return { desde: 'Preparado', hasta: 'Despachado' };
  return { desde: null, hasta: null };
}

function accionPorTransicion(desde, hasta, accionOriginal = null) {
  if (!desde && !hasta) {
    return accionOriginal === 'AVISO_EN_CAMINO' ? 'AVISO_EN_CAMINO' : null;
  }
  if (desde === 'Confirmado' && hasta === 'Preparado') return 'PREPARAR_PEDIDO';
  if (desde === 'Preparado' && hasta === 'Despachado') return 'DESPACHAR_PEDIDO';
  return 'CAMBIAR_ESTADO';
}

function normalizarEstadoOperativo(valor) {
  const limpio = valor === undefined || valor === null ? '' : String(valor).trim();
  if (!limpio) return null;
  return [...ESTADOS_PEDIDO].find((estado) => estado.toLowerCase() === limpio.toLowerCase()) || limpio;
}

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
    const accionCruda = fase?.accion_operativa
      ? String(fase.accion_operativa).trim().toUpperCase()
      : null;
    const accionOperativaCruda = ACCIONES_OPERATIVAS.has(accionCruda) ? accionCruda : accionCruda;
    const transicionLegacy = transicionPorAccion(accionOperativaCruda);
    const transicionDesde = normalizarEstadoOperativo(
      fase?.transicion_estado_desde ?? transicionLegacy.desde,
    );
    const transicionHasta = normalizarEstadoOperativo(
      fase?.transicion_estado_hasta ?? transicionLegacy.hasta,
    );
    const accionOperativa = accionPorTransicion(transicionDesde, transicionHasta, accionOperativaCruda);

    if (!nombre) errores.push(`Fase ${posicion}: falta el nombre`);
    if (!mensaje) errores.push(`Fase ${posicion}: el mensaje no puede estar vacío`);
    if (!Number.isInteger(espera) || espera < 0) {
      errores.push(`Fase ${posicion}: la espera sugerida debe ser un número de minutos (0 o más)`);
    }
    if (accionOperativaCruda && !ACCIONES_OPERATIVAS.has(accionOperativaCruda)) {
      errores.push(`Fase ${posicion}: acción operativa inválida`);
    }
    if ((transicionDesde && !transicionHasta) || (!transicionDesde && transicionHasta)) {
      errores.push(`Fase ${posicion}: para cambiar estado tenés que elegir estado desde y estado hasta`);
    }
    if (transicionDesde && !ESTADOS_PEDIDO.has(transicionDesde)) {
      errores.push(`Fase ${posicion}: estado desde inválido`);
    }
    if (transicionHasta && !ESTADOS_PEDIDO.has(transicionHasta)) {
      errores.push(`Fase ${posicion}: estado hasta inválido`);
    }
    if (transicionDesde && transicionHasta && transicionDesde === transicionHasta) {
      errores.push(`Fase ${posicion}: el estado desde y hasta no pueden ser iguales`);
    }

    return {
      id: fase?.id ? Number(fase.id) : null,
      nombre,
      mensaje,
      orden: posicion,
      espera_sugerida_minutos: espera,
      etiqueta_id: fase?.etiqueta_id ? Number(fase.etiqueta_id) : null,
      accion_operativa: accionOperativa,
      transicion_estado_desde: transicionDesde,
      transicion_estado_hasta: transicionHasta,
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
        accion_operativa: fase.accion_operativa || null,
        transicion_estado_desde: fase.transicion_estado_desde || null,
        transicion_estado_hasta: fase.transicion_estado_hasta || null,
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
        accion_operativa: fase.accion_operativa || null,
        transicion_estado_desde: fase.transicion_estado_desde || null,
        transicion_estado_hasta: fase.transicion_estado_hasta || null,
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

async function validarFasesOperativasConservadas(flujoId, fasesNormalizadas, t) {
  if (!fasesNormalizadas) return;
  const existentes = await WhatsappFlujoFase.findAll({
    where: { flujo_id: flujoId, activo: true },
    transaction: t,
  });
  const idsQueLlegan = new Set(fasesNormalizadas.filter((f) => f.id).map((f) => Number(f.id)));
  const protegidasSacadas = existentes.filter((fase) => (
    (ACCIONES_OPERATIVAS_PROTEGIDAS.has(fase.accion_operativa)
      || (fase.transicion_estado_desde && fase.transicion_estado_hasta))
    && !idsQueLlegan.has(Number(fase.id))
  ));
  if (protegidasSacadas.length === 0) return;

  throw errorHttp(
    'No se puede eliminar una fase operativa del seguimiento de envío.',
    422,
    protegidasSacadas.map((fase) => (
      `"${fase.nombre}" cambia el estado del pedido; podés editar su texto, nombre u orden, pero no quitarla del flujo.`
    )),
  );
}

async function asegurarAccionesOperativasBase(usuarioId, t = null) {
  const fases = await WhatsappFlujoFase.findAll({
    where: { activo: true },
    include: [{
      model: WhatsappFlujo,
      as: 'flujo',
      required: true,
      where: { usuario_id: usuarioId, tipo: 'SEGUIMIENTO_ENVIO' },
    }],
    transaction: t,
  });

  for (const fase of fases) {
    const accion = accionOperativaBase(fase.flujo?.tipo, fase);
    if (!accion) continue;
    const transicion = transicionPorAccion(accion);
    const cambios = {};
    if (!fase.accion_operativa) cambios.accion_operativa = accion;
    if (transicion.desde && !fase.transicion_estado_desde) cambios.transicion_estado_desde = transicion.desde;
    if (transicion.hasta && !fase.transicion_estado_hasta) cambios.transicion_estado_hasta = transicion.hasta;
    if (Object.keys(cambios).length > 0) await fase.update(cambios, { transaction: t });
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

/**
 * Garantiza que la cuenta tenga al menos un flujo de cada etapa
 * (Confirmación web, Venta por WhatsApp, Seguimiento de envío, Escalamiento
 * de ventas). Crea solo lo que falta, con mensajes de partida editables, y
 * lo deja como predeterminado de su etapa.
 *
 * Mira si existe ALGÚN flujo del tipo, activo o no: si la persona desactivó
 * el suyo a propósito, no se le crea otro al lado.
 *
 * Se llama al listar los flujos y al abrir el tablero. Devuelve cuántos creó.
 */
async function asegurarFlujosBase({ usuarioId }) {
  const existentes = await WhatsappFlujo.findAll({
    where: { usuario_id: usuarioId },
    attributes: ['id', 'tipo', 'nombre', 'predeterminado', 'activo'],
    raw: true,
  });
  const porTipo = existentes.reduce((mapa, flujo) => {
    if (!mapa.has(flujo.tipo)) mapa.set(flujo.tipo, []);
    mapa.get(flujo.tipo).push(flujo);
    return mapa;
  }, new Map());

  const necesitaBaseCanonica = (etapa) => {
    const delTipo = porTipo.get(etapa.tipo) || [];
    if (delTipo.length === 0) return true;

    const nombreCanonico = normalizarNombreBase(etapa.nombre);
    if (delTipo.some((flujo) => normalizarNombreBase(flujo.nombre) === nombreCanonico)) return false;

    // Migración conservadora: cuentas viejas tenían "Contacto inicial" como
    // flujo de confirmación web. No lo borramos; creamos el flujo base real y
    // lo dejamos como predeterminado para que los pedidos web caigan ahí.
    const nombresLegacy = NOMBRES_LEGACY_POR_TIPO[etapa.tipo];
    return !!nombresLegacy && delTipo.some((flujo) => nombresLegacy.has(normalizarNombreBase(flujo.nombre)));
  };

  const idsLegacyDelTipo = (etapa) => {
    const nombresLegacy = NOMBRES_LEGACY_POR_TIPO[etapa.tipo];
    if (!nombresLegacy) return [];
    return (porTipo.get(etapa.tipo) || [])
      .filter((flujo) => nombresLegacy.has(normalizarNombreBase(flujo.nombre)))
      .map((flujo) => flujo.id);
  };

  const faltantes = ETAPAS.filter(necesitaBaseCanonica);

  let creados = 0;
  for (const etapa of faltantes) {
    try {
      await sequelize.transaction(async (t) => {
        await limpiarPredeterminado({ usuarioId, esAdmin: false, tipo: etapa.tipo }, t);
        const legacyIds = idsLegacyDelTipo(etapa);
        if (legacyIds.length > 0) {
          await WhatsappFlujo.update(
            { activo: false, predeterminado: false },
            { where: { usuario_id: usuarioId, id: { [Op.in]: legacyIds } }, transaction: t },
          );
        }
        const flujo = await WhatsappFlujo.create({
          usuario_id: usuarioId,
          nombre: etapa.nombre,
          descripcion: etapa.descripcion,
          activo: true,
          tipo: etapa.tipo,
          activacion: 'AUTOMATICA',
          predeterminado: true,
        }, { transaction: t });
        for (const [i, fase] of etapa.fases.entries()) {
          await WhatsappFlujoFase.create({
            flujo_id: flujo.id,
            nombre: fase.nombre,
            mensaje: fase.mensaje,
            orden: i + 1,
            espera_sugerida_minutos: fase.espera,
            etiqueta_id: null,
            accion_operativa: fase.accion_operativa || null,
            transicion_estado_desde: fase.transicion_estado_desde || null,
            transicion_estado_hasta: fase.transicion_estado_hasta || null,
            activo: true,
          }, { transaction: t });
        }
      });
      creados += 1;
    } catch (error) {
      // Dos pedidos a la vez pueden intentar crear el mismo flujo base: el
      // índice único (usuario, tipo, predeterminado) deja pasar a uno solo.
      if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
    }
  }
  await asegurarAccionesOperativasBase(usuarioId);
  return creados;
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
    if (normalizadas) {
      await validarFasesOperativasConservadas(flujo.id, normalizadas, t);
      await sincronizarFases(flujo.id, normalizadas, t);
    }
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

  // Cada etapa tiene que conservar al menos un flujo: sin él, los pedidos de
  // esa etapa no tendrían qué mensaje mandar (y asegurarFlujosBase lo
  // volvería a crear igual). Se puede editar o desactivar, no dejar en cero.
  const delMismoTipo = await WhatsappFlujo.count({
    where: { usuario_id: flujo.usuario_id, tipo: flujo.tipo },
  });
  const etapa = ETAPAS.find((e) => e.tipo === flujo.tipo);
  if (etapa && delMismoTipo <= 1) {
    throw errorHttp(
      `Este es el único flujo de "${etapa.nombre}" y esa etapa tiene que tener uno. Podés editar sus mensajes o desactivarlo, pero no eliminarlo.`,
      422,
    );
  }

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
      'estado',
      [fn('COUNT', col('id')), 'veces'],
      [fn('MAX', col('created_at')), 'ultimo'],
    ],
    where: { envio_id: envioId, fase_id: { [Op.ne]: null } },
    group: ['fase_id', 'estado'],
    raw: true,
  });

  // Una fase puede tener aperturas sin confirmar y aperturas completadas:
  // se suman las veces, y "completada" sale de si hay alguna confirmada.
  const porFase = new Map();
  for (const e of envios) {
    const id = Number(e.fase_id);
    const actual = porFase.get(id) || { veces: 0, ultimo_envio_en: null, completada: false };
    actual.veces += Number(e.veces);
    if (!actual.ultimo_envio_en || new Date(e.ultimo) > new Date(actual.ultimo_envio_en)) actual.ultimo_envio_en = e.ultimo;
    if (e.estado === 'CONFIRMADO_POR_OPERADOR') actual.completada = true;
    porFase.set(id, actual);
  }

  return flujos.map((flujo) => {
    const plano = flujo.toJSON();
    plano.fases = (plano.fases || []).map((fase) => {
      const stats = porFase.get(fase.id);
      return {
        ...fase,
        envios: stats?.veces || 0,
        ultimo_envio_en: stats?.ultimo_envio_en || null,
        completada: !!stats?.completada,
      };
    });
    plano.envios_totales = plano.fases.reduce((acc, f) => acc + f.envios, 0);
    return plano;
  });
}

module.exports = {
  asegurarFlujosBase,
  listarFlujos,
  obtenerFlujo,
  crearFlujo,
  actualizarFlujo,
  eliminarFlujo,
  estadoFlujosDelPedido,
};
