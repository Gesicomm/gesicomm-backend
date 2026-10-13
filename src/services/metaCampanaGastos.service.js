'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { MetaCampanaInterna, MetaCampanaGasto } = require('../models');
const MetaReportesService = require('./metaReportes.service');

/**
 * Gasto de las campañas internas, cargado a mano por rango de fechas.
 *
 * Es la forma de registrar la inversión en Ads desde que la sección dejó
 * de importar CSV: "del día X al día Y gasté tanto". Cada campaña acumula
 * registros y su gasto total es la suma. De acá también sale la línea
 * "Meta (ads)" del dashboard y de Control financiero (ver gastoEnPeriodo).
 */

const DIA_MS = 24 * 60 * 60 * 1000;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
// DECIMAL(14,2): hasta 12 dígitos enteros.
const MONTO_MAXIMO = 999_999_999_999;
const NOTA_MAXIMA = 500;

const aMs = (ymd) => Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`);
const diasInclusive = (iniMs, finMs) => Math.floor((finMs - iniMs) / DIA_MS) + 1;

/** "2026-10-01" -> "01/10/2026", para los mensajes de error. */
const fechaLegible = (ymd) => {
  const [y, m, d] = String(ymd).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

function esFechaValida(valor) {
  if (typeof valor !== 'string' || !REGEX_FECHA.test(valor)) return false;
  const ms = aMs(valor);
  // Descarta fechas que el parser "corrige" solo, como 2026-02-31.
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === valor;
}

function serializar(gasto) {
  const json = typeof gasto.toJSON === 'function' ? gasto.toJSON() : gasto;
  const monto = Number(json.monto) || 0;
  const dias = diasInclusive(aMs(json.fecha_desde), aMs(json.fecha_hasta));
  return {
    id: json.id,
    meta_campana_interna_id: json.meta_campana_interna_id,
    fecha_desde: json.fecha_desde,
    fecha_hasta: json.fecha_hasta,
    dias,
    monto,
    promedio_diario: dias > 0 ? monto / dias : 0,
    nota: json.nota || null,
    created_at: json.created_at,
    updated_at: json.updated_at,
  };
}

class MetaCampanaGastosService {
  /**
   * Parte de `monto` que cae dentro de [desde, hasta], asumiendo gasto
   * uniforme en el rango cargado. Mismo criterio que ya usaba el dashboard
   * con las filas importadas: sin esto, mirar "octubre" contaría entero un
   * gasto cargado para setiembre-octubre.
   */
  static prorratear(monto, fechaDesde, fechaHasta, desde, hasta) {
    const iniMs = aMs(fechaDesde);
    const finMs = aMs(fechaHasta);
    if (!monto || Number.isNaN(iniMs) || Number.isNaN(finMs) || finMs < iniMs) return 0;

    const diasRegistro = diasInclusive(iniMs, finMs);
    const diasSolapados = diasInclusive(Math.max(iniMs, aMs(desde)), Math.min(finMs, aMs(hasta)));
    if (!(diasSolapados > 0)) return 0;

    return monto * (Math.min(diasSolapados, diasRegistro) / diasRegistro);
  }

  /** Valida y normaliza lo que viene del cliente. `previo` permite editar un solo campo. */
  static _normalizar(datos = {}, previo = null) {
    const fecha_desde = datos.fecha_desde !== undefined ? datos.fecha_desde : previo?.fecha_desde;
    const fecha_hasta = datos.fecha_hasta !== undefined ? datos.fecha_hasta : previo?.fecha_hasta;
    const montoCrudo = datos.monto !== undefined ? datos.monto : previo?.monto;
    const notaCruda = datos.nota !== undefined ? datos.nota : previo?.nota;

    if (!esFechaValida(fecha_desde) || !esFechaValida(fecha_hasta)) {
      throw new Error('Indicá el rango de fechas del gasto (desde y hasta).');
    }
    if (fecha_hasta < fecha_desde) {
      throw new Error('La fecha "hasta" no puede ser anterior a la fecha "desde".');
    }

    const esNumero = typeof montoCrudo === 'number'
      || (typeof montoCrudo === 'string' && montoCrudo.trim() !== '');
    const monto = esNumero ? Number(montoCrudo) : NaN;
    if (!Number.isFinite(monto) || monto <= 0) {
      throw new Error('El monto gastado tiene que ser mayor a cero.');
    }
    if (monto > MONTO_MAXIMO) {
      throw new Error('El monto gastado es demasiado grande.');
    }

    const nota = notaCruda == null ? '' : String(notaCruda).trim();
    if (nota.length > NOTA_MAXIMA) {
      throw new Error(`La nota no puede superar los ${NOTA_MAXIMA} caracteres.`);
    }

    // El guaraní no tiene centavos.
    return { fecha_desde, fecha_hasta, monto: Math.round(monto), nota: nota || null };
  }

  /**
   * Los rangos de una campaña no se pueden pisar: el solapamiento contaría
   * dos veces la misma plata. Para corregir un período ya cargado se edita
   * ese registro.
   */
  static async _validarSinSolapamiento(campanaId, { fecha_desde, fecha_hasta }, excluirId = null) {
    const where = {
      meta_campana_interna_id: campanaId,
      fecha_desde: { [Op.lte]: fecha_hasta },
      fecha_hasta: { [Op.gte]: fecha_desde },
    };
    if (excluirId) where.id = { [Op.ne]: excluirId };

    const pisado = await MetaCampanaGasto.findOne({ where, order: [['fecha_desde', 'ASC']] });
    if (!pisado) return;

    const rango = pisado.fecha_desde === pisado.fecha_hasta
      ? `el ${fechaLegible(pisado.fecha_desde)}`
      : `del ${fechaLegible(pisado.fecha_desde)} al ${fechaLegible(pisado.fecha_hasta)}`;
    throw new Error(`Esta campaña ya tiene gasto cargado ${rango}. Editá ese registro o elegí un rango que no se pise.`);
  }

  // Cada usuario opera únicamente sobre sus propias campañas, igual que en
  // MetaReportesService.listarCampanas.
  static async _campanaPropia(campanaId, inquilino_id, usuario_id) {
    const campana = await MetaCampanaInterna.findOne({ where: { id: campanaId, inquilino_id, usuario_id } });
    if (!campana) throw new Error('Campaña no encontrada.');
    return campana;
  }

  static async _gastoPropio(gastoId, inquilino_id, usuario_id) {
    const gasto = await MetaCampanaGasto.findOne({ where: { id: gastoId, inquilino_id, usuario_id } });
    if (!gasto) throw new Error('Registro de gasto no encontrado.');
    return gasto;
  }

  static async crear(campanaId, inquilino_id, usuario_id, datos) {
    const campana = await this._campanaPropia(campanaId, inquilino_id, usuario_id);
    const normalizado = this._normalizar(datos);
    await this._validarSinSolapamiento(campana.id, normalizado);

    const gasto = await MetaCampanaGasto.create({
      inquilino_id,
      usuario_id,
      meta_campana_interna_id: campana.id,
      ...normalizado,
    });
    return serializar(gasto);
  }

  static async actualizar(gastoId, inquilino_id, usuario_id, datos) {
    const gasto = await this._gastoPropio(gastoId, inquilino_id, usuario_id);
    const normalizado = this._normalizar(datos, gasto);
    await this._validarSinSolapamiento(gasto.meta_campana_interna_id, normalizado, gasto.id);

    await gasto.update(normalizado);
    return serializar(gasto);
  }

  static async eliminar(gastoId, inquilino_id, usuario_id) {
    const gasto = await this._gastoPropio(gastoId, inquilino_id, usuario_id);
    await gasto.destroy();
  }

  static get ORDEN_GASTOS() {
    return ['fecha_desde', 'monto', 'created_at'];
  }

  /**
   * Histórico de gasto de una campaña: los registros paginados + el
   * resumen de TODA la campaña (no de la página que se está viendo).
   */
  static async listar(campanaId, inquilino_id, usuario_id, filtros = {}) {
    const campana = await this._campanaPropia(campanaId, inquilino_id, usuario_id);
    const where = { meta_campana_interna_id: campana.id };

    const { pagina, limite, offset } = MetaReportesService._paginacion(filtros);
    const orden = MetaReportesService._orden(
      filtros, MetaCampanaGastosService.ORDEN_GASTOS, { campo: 'fecha_desde', direccion: 'DESC' },
    );

    const [{ rows, count }, agregado] = await Promise.all([
      MetaCampanaGasto.findAndCountAll({
        where,
        order: [[orden.campo, orden.direccion], ['id', 'DESC']],
        limit: limite,
        offset,
      }),
      MetaCampanaGasto.findOne({
        where,
        attributes: [
          [fn('SUM', col('monto')), 'total'],
          [fn('MIN', col('fecha_desde')), 'primer_dia'],
          [fn('MAX', col('fecha_hasta')), 'ultimo_dia'],
          // Resta de fechas en Postgres = días. Como los rangos no se
          // solapan, la suma son los días realmente cubiertos.
          [literal('SUM("fecha_hasta" - "fecha_desde" + 1)'), 'dias'],
        ],
        raw: true,
      }),
    ]);

    const totalGastado = Number(agregado?.total) || 0;
    const diasCargados = Number(agregado?.dias) || 0;

    return {
      campana: {
        id: campana.id,
        nombre_display: campana.nombre_display,
        nombre_interno: campana.nombre_interno,
      },
      resumen: {
        total_gastado: totalGastado,
        registros: count,
        primer_dia: agregado?.primer_dia || null,
        ultimo_dia: agregado?.ultimo_dia || null,
        dias_cargados: diasCargados,
        promedio_diario: diasCargados > 0 ? totalGastado / diasCargados : 0,
      },
      total: count,
      pagina,
      limite,
      total_paginas: Math.max(1, Math.ceil(count / limite)),
      orden,
      gastos: rows.map(serializar),
    };
  }

  /**
   * Gasto manual del usuario que cae en [desde, hasta], prorrateado por
   * días, con su apertura por producto. Lo consumen el dashboard de
   * rentabilidad y Control financiero para la línea de publicidad de Meta.
   *
   * La campaña dice a qué producto(s) pertenece el gasto: cada producto de
   * la campaña ve el 100% (no se parte entre ellos), misma regla que ya
   * regía para las filas importadas.
   */
  static async gastoEnPeriodo(usuario_id, inquilino_id, desde, hasta) {
    const vacio = { total: 0, sin_atribuir: 0, directo_por_producto: {} };
    if (!usuario_id || !inquilino_id || !desde || !hasta) return vacio;

    const gastos = await MetaCampanaGasto.findAll({
      where: {
        inquilino_id,
        usuario_id,
        fecha_desde: { [Op.lte]: String(hasta).slice(0, 10) },
        fecha_hasta: { [Op.gte]: String(desde).slice(0, 10) },
      },
      attributes: ['fecha_desde', 'fecha_hasta', 'monto'],
      include: [{ model: MetaCampanaInterna, as: 'campana', attributes: ['producto_ids'] }],
      raw: true,
    });

    const resultado = { total: 0, sin_atribuir: 0, directo_por_producto: {} };
    for (const g of gastos) {
      const delPeriodo = MetaCampanaGastosService.prorratear(
        Number(g.monto) || 0, g.fecha_desde, g.fecha_hasta, desde, hasta,
      );
      if (!delPeriodo) continue;
      resultado.total += delPeriodo;

      const productoIds = g['campana.producto_ids'];
      if (Array.isArray(productoIds) && productoIds.length > 0) {
        for (const pid of productoIds) {
          resultado.directo_por_producto[pid] = (resultado.directo_por_producto[pid] || 0) + delPeriodo;
        }
      } else {
        resultado.sin_atribuir += delPeriodo;
      }
    }
    return resultado;
  }
}

module.exports = MetaCampanaGastosService;
