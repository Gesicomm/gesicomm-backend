'use strict';

const { Op } = require('sequelize');
const { CostoGasto, CategoriaCostoGasto, Proveedor, MetodoPago, Producto, ProductoVariante, Envio } = require('../models');

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Suma una frecuencia a una fecha 'YYYY-MM-DD' y devuelve la próxima fecha
 * en el mismo formato. Usado tanto al crear un gasto recurrente (primera
 * proxima_fecha) como por el cron job para avanzar la plantilla.
 */
function calcularProximaFecha(fechaStr, frecuencia) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  switch (frecuencia) {
    case 'semanal': fecha.setUTCDate(fecha.getUTCDate() + 7); break;
    case 'quincenal': fecha.setUTCDate(fecha.getUTCDate() + 15); break;
    case 'mensual': fecha.setUTCMonth(fecha.getUTCMonth() + 1); break;
    case 'trimestral': fecha.setUTCMonth(fecha.getUTCMonth() + 3); break;
    case 'semestral': fecha.setUTCMonth(fecha.getUTCMonth() + 6); break;
    case 'anual': fecha.setUTCFullYear(fecha.getUTCFullYear() + 1); break;
    default: throw new Error('Frecuencia inválida.');
  }
  return fecha.toISOString().slice(0, 10);
}

const INCLUDES_LISTA = [
  { model: CategoriaCostoGasto, as: 'categoria', attributes: ['id', 'nombre', 'grupo', 'slug'] },
  { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },
  { model: MetodoPago, as: 'metodo_pago', attributes: ['id', 'nombre'] },
];

const INCLUDES_DETALLE = [
  ...INCLUDES_LISTA,
  { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'sku'] },
  { model: ProductoVariante, as: 'variante', attributes: ['id', 'nombre'] },
  { model: Envio, as: 'envio', attributes: ['id', 'cliente', 'monto'] },
  { model: CostoGasto, as: 'ocurrencias', attributes: ['id', 'fecha', 'importe', 'estado'], separate: true, order: [['fecha', 'DESC']] },
];

class CostoGastoService {
  static serializar(row) {
    const data = row.toJSON ? row.toJSON() : row;
    return data;
  }

  static async buscar(filtros, usuario_id) {
    const {
      fecha_desde, fecha_hasta, tipo, categoria_id, estado, proveedor_id,
      frecuencia, metodo_pago_id, producto_id, clasificacion, es_recurrente,
      busqueda, page = 1, limit = 20,
    } = filtros;

    const where = { usuario_id, activo: true };
    if (fecha_desde && fecha_hasta) where.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };
    else if (fecha_desde) where.fecha = { [Op.gte]: fecha_desde };
    else if (fecha_hasta) where.fecha = { [Op.lte]: fecha_hasta };

    if (tipo) where.tipo = tipo;
    if (categoria_id) where.categoria_id = categoria_id;
    if (estado) where.estado = estado;
    if (proveedor_id) where.proveedor_id = proveedor_id;
    if (frecuencia) where.frecuencia = frecuencia;
    if (metodo_pago_id) where.metodo_pago_id = metodo_pago_id;
    if (producto_id) where.producto_id = producto_id;
    if (clasificacion) where.clasificacion = clasificacion;
    if (es_recurrente !== undefined) where.es_recurrente = es_recurrente;
    if (busqueda) where.concepto = { [Op.iLike]: `%${busqueda}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows, count } = await CostoGasto.findAndCountAll({
      where,
      include: INCLUDES_LISTA,
      order: [['fecha', 'DESC'], ['id', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      registros: rows.map(this.serializar),
    };
  }

  static async crear(datos, usuario_id) {
    const { concepto, tipo, categoria_id, importe } = datos;
    if (!concepto || !concepto.trim()) throw new Error('El concepto es requerido.');
    if (!['costo', 'gasto'].includes(tipo)) throw new Error('El tipo debe ser "costo" o "gasto".');
    if (!categoria_id) throw new Error('La categoría es requerida.');
    if (importe === undefined || importe === null || isNaN(importe) || Number(importe) <= 0) {
      throw new Error('El importe es requerido y debe ser mayor a 0.');
    }

    const categoria = await CategoriaCostoGasto.findOne({ where: { id: categoria_id, activo: true } });
    if (!categoria) throw new Error('Categoría no encontrada.');

    const fecha = datos.fecha || hoyISO();
    const esRecurrente = !!datos.es_recurrente;
    let proximaFecha = null;
    if (esRecurrente) {
      if (!datos.frecuencia) throw new Error('La frecuencia es requerida para un costo/gasto recurrente.');
      proximaFecha = datos.proxima_fecha || calcularProximaFecha(fecha, datos.frecuencia);
    }

    const registro = await CostoGasto.create({
      usuario_id,
      tipo,
      categoria_id,
      concepto: concepto.trim(),
      descripcion: datos.descripcion || null,
      importe,
      moneda: datos.moneda || 'PYG',
      fecha,
      fecha_pago: datos.fecha_pago || null,
      estado: datos.estado || 'pendiente',
      clasificacion: datos.clasificacion || null,
      es_recurrente: esRecurrente,
      frecuencia: esRecurrente ? datos.frecuencia : null,
      proxima_fecha: proximaFecha,
      metodo_pago_id: datos.metodo_pago_id || null,
      proveedor_id: datos.proveedor_id || null,
      producto_id: datos.producto_id || null,
      variante_id: datos.variante_id || null,
      envio_id: datos.envio_id || null,
    });

    return this.detalle(registro.id, usuario_id);
  }

  static async detalle(id, usuario_id) {
    const registro = await CostoGasto.findOne({
      where: { id, usuario_id },
      include: INCLUDES_DETALLE,
    });
    if (!registro) throw new Error('Costo/gasto no encontrado.');
    return this.serializar(registro);
  }

  static async actualizar(id, datos, usuario_id) {
    const registro = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!registro) throw new Error('Costo/gasto no encontrado.');

    const campos = [
      'tipo', 'categoria_id', 'concepto', 'descripcion', 'importe', 'moneda',
      'fecha', 'fecha_pago', 'estado', 'clasificacion', 'metodo_pago_id',
      'proveedor_id', 'producto_id', 'variante_id', 'envio_id',
    ];
    for (const campo of campos) {
      if (datos[campo] !== undefined) registro[campo] = datos[campo];
    }

    if (datos.es_recurrente !== undefined) {
      registro.es_recurrente = !!datos.es_recurrente;
      if (registro.es_recurrente) {
        if (!datos.frecuencia && !registro.frecuencia) throw new Error('La frecuencia es requerida para un costo/gasto recurrente.');
        if (datos.frecuencia) registro.frecuencia = datos.frecuencia;
        registro.proxima_fecha = datos.proxima_fecha || registro.proxima_fecha || calcularProximaFecha(registro.fecha, registro.frecuencia);
      } else {
        registro.frecuencia = null;
        registro.proxima_fecha = null;
      }
    }

    if (!registro.concepto || !registro.concepto.trim()) throw new Error('El concepto es requerido.');
    if (registro.importe === undefined || registro.importe === null || Number(registro.importe) <= 0) {
      throw new Error('El importe debe ser mayor a 0.');
    }

    await registro.save();
    return this.detalle(id, usuario_id);
  }

  static async eliminar(id, usuario_id) {
    const registro = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!registro) throw new Error('Costo/gasto no encontrado.');
    registro.activo = false;
    await registro.save();
    return true;
  }

  static async duplicar(id, usuario_id) {
    const original = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!original) throw new Error('Costo/gasto no encontrado.');

    const copia = await CostoGasto.create({
      usuario_id,
      tipo: original.tipo,
      categoria_id: original.categoria_id,
      concepto: original.concepto,
      descripcion: original.descripcion,
      importe: original.importe,
      moneda: original.moneda,
      fecha: hoyISO(),
      fecha_pago: null,
      estado: 'pendiente',
      clasificacion: original.clasificacion,
      es_recurrente: false,
      frecuencia: null,
      proxima_fecha: null,
      metodo_pago_id: original.metodo_pago_id,
      proveedor_id: original.proveedor_id,
      producto_id: original.producto_id,
      variante_id: original.variante_id,
      envio_id: null,
    });

    return this.detalle(copia.id, usuario_id);
  }

  static async marcarPagado(id, datos, usuario_id) {
    const registro = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!registro) throw new Error('Costo/gasto no encontrado.');
    registro.estado = 'pagado';
    registro.fecha_pago = (datos && datos.fecha_pago) || hoyISO();
    await registro.save();
    return this.detalle(id, usuario_id);
  }

  /**
   * `imagenData` es el objeto de ComprobanteService.procesarComprobanteParaR2
   * ({url, storage_key, mime_type, size}).
   * @returns {{registro: object, anterior: {url: string, storage_key: string|null}|null}}
   *   `anterior` es el comprobante que se reemplaza, para que el controller
   *   borre ese objeto de R2 (o el archivo legacy en disco).
   */
  static async guardarComprobante(id, usuario_id, imagenData, nombreOriginal) {
    const registro = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!registro) throw new Error('Costo/gasto no encontrado.');
    const anterior = registro.comprobante_url
      ? { url: registro.comprobante_url, storage_key: registro.comprobante_storage_key }
      : null;

    registro.comprobante_url = imagenData.url;
    registro.comprobante_storage_key = imagenData.storage_key;
    registro.comprobante_mime_type = imagenData.mime_type;
    registro.comprobante_size = imagenData.size;
    registro.comprobante_nombre = nombreOriginal || null;
    await registro.save();
    return { registro: await this.detalle(id, usuario_id), anterior };
  }

  /**
   * Cards de resumen del dashboard (sección 4 del spec). "ingresos" es un
   * cálculo aproximado (Envio.monto de pedidos en estado "Entregado" en el
   * período) pensado para dar una primera foto del margen; se reemplaza
   * por el cálculo real de pedidosAnalyticsService en la integración con
   * Reportes/Analytics (fases siguientes).
   *
   * Solo se cuentan pedidos Entregados y no, por ejemplo, Confirmados: un
   * pedido confirmado todavía no puso plata en la caja (más aún con pago
   * contra entrega, que es el método dominante) — recién al entregarse se
   * puede considerar cobrado.
   */
  static async resumen(filtros, usuario_id) {
    const { fecha_desde, fecha_hasta } = filtros;
    const whereFecha = { usuario_id, activo: true };
    if (fecha_desde && fecha_hasta) whereFecha.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };

    const totales = await CostoGasto.findAll({
      where: whereFecha,
      attributes: ['tipo', [CostoGasto.sequelize.fn('SUM', CostoGasto.sequelize.col('importe')), 'total']],
      group: ['tipo'],
      raw: true,
    });

    const gastosPeriodo = Number(totales.find(t => t.tipo === 'gasto')?.total || 0);
    const costosPeriodo = Number(totales.find(t => t.tipo === 'costo')?.total || 0);
    const totalEgresos = gastosPeriodo + costosPeriodo;

    const whereEnvio = { usuario_id, estado: { [Op.iLike]: 'entregado' } };
    if (fecha_desde && fecha_hasta) whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };

    const ingresos = Number((await Envio.sum('monto', { where: whereEnvio })) || 0);

    const resultado = ingresos - totalEgresos;
    const margen = ingresos > 0 ? Number(((resultado / ingresos) * 100).toFixed(1)) : 0;

    return { gastos_periodo: gastosPeriodo, costos_periodo: costosPeriodo, total_egresos: totalEgresos, ingresos, resultado, margen };
  }

  /**
   * Datos completos para el reporte financiero exportable (Excel/PDF):
   * el mismo resumen de `resumen()` más el detalle SIN paginar de cada
   * gasto/costo y cada venta que compone esos totales, para que el
   * usuario pueda auditar línea por línea de dónde sale cada número.
   */
  static async datosReporteFinanciero(filtros, usuario_id) {
    const { fecha_desde, fecha_hasta } = filtros;
    const resumenCalculado = await this.resumen(filtros, usuario_id);

    const whereGastos = { usuario_id, activo: true };
    if (fecha_desde && fecha_hasta) whereGastos.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };

    const gastos = await CostoGasto.findAll({
      where: whereGastos,
      include: INCLUDES_LISTA,
      order: [['fecha', 'DESC'], ['id', 'DESC']],
    });

    const whereEnvio = { usuario_id, estado: { [Op.iLike]: 'entregado' } };
    if (fecha_desde && fecha_hasta) whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };

    const ingresos = await Envio.findAll({
      where: whereEnvio,
      attributes: ['id', 'fecha', 'cliente', 'monto', 'estado'],
      order: [['fecha', 'DESC'], ['id', 'DESC']],
    });

    return {
      resumen: resumenCalculado,
      gastos: gastos.map(this.serializar),
      ingresos: ingresos.map(this.serializar),
    };
  }

  /**
   * Desgloses para el tab "Rentabilidad" del Centro de Inteligencia
   * Comercial (gastos por categoría, evolución mensual, compromiso
   * recurrente, top gastos). Las cifras de ingresos/margen "oficiales" del
   * negocio siguen viniendo de pedidosAnalyticsService.getAnalyticsCompleto
   * (que ya neta comisión/IVA/logística/COGS por pedido) — acá solo se
   * agrega el detalle propio de Costos y Gastos que no existe en ningún
   * otro lado.
   */
  static async reporteDesglose(filtros, usuario_id) {
    const hasta = filtros.fecha_hasta || hoyISO();
    const desde = filtros.fecha_desde || (() => {
      const d = new Date(hasta);
      d.setMonth(d.getMonth() - 5);
      d.setDate(1);
      return d.toISOString().slice(0, 10);
    })();

    const whereBase = { usuario_id, activo: true, envio_id: null, fecha: { [Op.between]: [desde, hasta] } };

    const [porCategoriaRaw, porMesRaw, topGastos, plantillasRecurrentes, ingresosPorMesRaw] = await Promise.all([
      CostoGasto.findAll({
        where: whereBase,
        attributes: ['categoria_id', [CostoGasto.sequelize.fn('SUM', CostoGasto.sequelize.col('CostoGasto.importe')), 'total']],
        include: [{ model: CategoriaCostoGasto, as: 'categoria', attributes: ['nombre', 'grupo'] }],
        group: ['categoria_id', 'categoria.id', 'categoria.nombre', 'categoria.grupo'],
        raw: true,
      }),
      CostoGasto.findAll({
        where: whereBase,
        attributes: [
          [CostoGasto.sequelize.fn('LEFT', CostoGasto.sequelize.cast(CostoGasto.sequelize.col('fecha'), 'text'), 7), 'mes'],
          'tipo',
          [CostoGasto.sequelize.fn('SUM', CostoGasto.sequelize.col('importe')), 'total'],
        ],
        group: ['mes', 'tipo'],
        raw: true,
      }),
      CostoGasto.findAll({
        where: whereBase,
        include: [{ model: CategoriaCostoGasto, as: 'categoria', attributes: ['nombre'] }],
        order: [['importe', 'DESC']],
        limit: 8,
      }),
      CostoGasto.findAll({
        where: { usuario_id, activo: true, es_recurrente: true, parent_recurring_id: null },
        attributes: ['importe', 'frecuencia'],
        raw: true,
      }),
      Envio.findAll({
        where: { usuario_id, estado: { [Op.iLike]: 'entregado' }, fecha: { [Op.between]: [desde, hasta] } },
        attributes: [
          [Envio.sequelize.fn('LEFT', Envio.sequelize.col('fecha'), 7), 'mes'],
          [Envio.sequelize.fn('SUM', Envio.sequelize.col('monto')), 'total'],
        ],
        group: ['mes'],
        raw: true,
      }),
    ]);

    const totalCategorias = porCategoriaRaw.reduce((acc, c) => acc + Number(c.total), 0);
    const gastosPorCategoria = porCategoriaRaw
      .map(c => ({
        categoria_id: c.categoria_id,
        nombre: c['categoria.nombre'],
        grupo: c['categoria.grupo'],
        total: Number(c.total),
        pct: totalCategorias > 0 ? Number(((Number(c.total) / totalCategorias) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const mesesMap = {};
    for (const fila of porMesRaw) {
      if (!mesesMap[fila.mes]) mesesMap[fila.mes] = { mes: fila.mes, ingresos: 0, costos: 0, gastos: 0 };
      if (fila.tipo === 'costo') mesesMap[fila.mes].costos = Number(fila.total);
      else mesesMap[fila.mes].gastos = Number(fila.total);
    }
    for (const fila of ingresosPorMesRaw) {
      if (!mesesMap[fila.mes]) mesesMap[fila.mes] = { mes: fila.mes, ingresos: 0, costos: 0, gastos: 0 };
      mesesMap[fila.mes].ingresos = Number(fila.total);
    }
    const evolucionMensual = Object.values(mesesMap)
      .map(m => ({ ...m, ganancia_neta: m.ingresos - m.costos - m.gastos }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    const MULT_MENSUAL = { semanal: 4.33, quincenal: 2, mensual: 1, trimestral: 1 / 3, semestral: 1 / 6, anual: 1 / 12 };
    const gastosRecurrentesMensuales = Math.round(
      plantillasRecurrentes.reduce((acc, p) => acc + Number(p.importe) * (MULT_MENSUAL[p.frecuencia] || 0), 0)
    );

    return {
      periodo: { desde, hasta },
      gastos_por_categoria: gastosPorCategoria,
      evolucion_mensual: evolucionMensual,
      gastos_recurrentes_mensuales: gastosRecurrentesMensuales,
      top_gastos: topGastos.map(g => this.serializar(g)),
    };
  }
}

module.exports = CostoGastoService;
module.exports.calcularProximaFecha = calcularProximaFecha;
