'use strict';

const { Op } = require('sequelize');
const {
  CostoGasto,
  CategoriaCostoGasto,
  Proveedor,
  MetodoPago,
  Producto,
  ProductoVariante,
  Envio,
  EnvioItem,
  EnvioItemComponente,
  CanalVenta,
  MetaReporteFila,
  MetaCampanaInterna,
  MetaReporteImport,
} = require('../models');
const MetaReportesService = require('./metaReportes.service');
const { desgloseDelivery } = require('../utils/desgloseDelivery');
const { METRIC_TERMS } = require('../utils/metricGlossary');

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

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function montoNumero(valor) {
  return Math.round(Number(valor) || 0);
}

function sumarImporte(registros) {
  return registros.reduce((acc, r) => acc + montoNumero(r.importe), 0);
}

function periodoAnterior(fechaDesde, fechaHasta) {
  if (!fechaDesde || !fechaHasta) return null;
  const desde = new Date(`${fechaDesde}T00:00:00Z`);
  const hasta = new Date(`${fechaHasta}T00:00:00Z`);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return null;
  const dias = Math.floor((hasta - desde) / (24 * 60 * 60 * 1000)) + 1;
  const anteriorHasta = new Date(desde);
  anteriorHasta.setUTCDate(anteriorHasta.getUTCDate() - 1);
  const anteriorDesde = new Date(anteriorHasta);
  anteriorDesde.setUTCDate(anteriorDesde.getUTCDate() - dias + 1);
  return {
    fecha_desde: anteriorDesde.toISOString().slice(0, 10),
    fecha_hasta: anteriorHasta.toISOString().slice(0, 10),
  };
}

function variacion(actual, anterior, tipo = 'pct') {
  const a = Number(actual) || 0;
  const b = Number(anterior) || 0;
  if (tipo === 'pp') return Number((a - b).toFixed(1));
  if (b === 0) return a === 0 ? 0 : null;
  return Number((((a - b) / Math.abs(b)) * 100).toFixed(1));
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

const TIPOS_MOVIMIENTO = ['ingreso', 'costo', 'gasto'];
const TIPOS_EGRESO = ['costo', 'gasto'];

function ivaDesdeImporte(importe, impuestosIncluidos = true) {
  const n = Number(importe) || 0;
  if (n <= 0) return 0;
  return impuestosIncluidos === false ? n * 0.10 : n - (n / 1.10);
}

function calcularIvaFacturadoEnvio(envio) {
  if (!envio?.quiere_factura) return 0;
  const items = envio.items || [];
  const ventaProducto = montoNumero(desgloseDelivery(envio).venta_producto);
  const sumaSubtotales = items.reduce(
    (acc, item) => acc + montoNumero(item.subtotal || ((Number(item.precio_unitario) || 0) * (Number(item.cantidad) || 1))),
    0
  );
  if (!items.length || !sumaSubtotales) return Math.round(ivaDesdeImporte(ventaProducto, true));

  return Math.round(items.reduce((acc, item) => {
    const subtotal = montoNumero(item.subtotal || ((Number(item.precio_unitario) || 0) * (Number(item.cantidad) || 1)));
    const importeItem = ventaProducto * (subtotal / sumaSubtotales);
    const impuestosIncluidos = item.Producto?.impuestos_incluidos ?? true;
    return acc + ivaDesdeImporte(importeItem, impuestosIncluidos);
  }, 0));
}

function dineroEnManoCourier(envio) {
  const custodia = envio.MetodoPago ? envio.MetodoPago.custodia_cobro : 'negocio';
  if (custodia !== 'courier' || envio.estado_financiero !== 'pendiente_liquidacion') return 0;
  return montoNumero(envio.monto) + montoNumero(desgloseDelivery(envio).envio_fuera_del_monto);
}

function saldoCourierPorRendir(envio) {
  const dineroCourier = dineroEnManoCourier(envio);
  if (!dineroCourier) return 0;
  return dineroCourier - montoNumero(envio.costo_envio);
}

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

    if (tipo === 'egreso') where.tipo = { [Op.in]: TIPOS_EGRESO };
    else if (Array.isArray(tipo)) where.tipo = { [Op.in]: tipo.filter(t => TIPOS_MOVIMIENTO.includes(t)) };
    else if (tipo) where.tipo = tipo;
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

  static async validarReferencias(datos, usuario_id, inquilino_id) {
    if (datos.categoria_id) {
      const alcances = [{ inquilino_id: null }];
      if (inquilino_id !== undefined && inquilino_id !== null) alcances.push({ inquilino_id });
      const categoria = await CategoriaCostoGasto.findOne({
        where: {
          id: datos.categoria_id,
          activo: true,
          [Op.or]: alcances,
        },
      });
      if (!categoria) throw new Error('Categoría no encontrada.');
    }
    if (datos.metodo_pago_id) {
      const metodo = await MetodoPago.findOne({ where: { id: datos.metodo_pago_id, usuario_id, activo: true } });
      if (!metodo) throw new Error('Método de pago no encontrado.');
    }
    if (datos.proveedor_id) {
      const proveedor = await Proveedor.findOne({ where: { id: datos.proveedor_id, usuario_id, activo: true } });
      if (!proveedor) throw new Error('Proveedor no encontrado.');
    }
    if (datos.producto_id) {
      const producto = await Producto.findOne({ where: { id: datos.producto_id, activo: true, creado_por: usuario_id } });
      if (!producto) throw new Error('Producto no encontrado.');
    }
  }

  static async crear(datos, usuario_id, inquilino_id) {
    const { concepto, tipo, categoria_id, importe } = datos;
    if (!concepto || !concepto.trim()) throw new Error('El concepto es requerido.');
    if (!TIPOS_MOVIMIENTO.includes(tipo)) throw new Error('El tipo debe ser "ingreso", "costo" o "gasto".');
    if (!categoria_id) throw new Error('La categoría es requerida.');
    if (importe === undefined || importe === null || isNaN(importe) || Number(importe) <= 0) {
      throw new Error('El importe es requerido y debe ser mayor a 0.');
    }

    await this.validarReferencias(datos, usuario_id, inquilino_id);

    const fecha = datos.fecha || hoyISO();
    const esRecurrente = !!datos.es_recurrente;
    let proximaFecha = null;
    if (esRecurrente) {
      if (!datos.frecuencia) throw new Error('La frecuencia es requerida para un movimiento recurrente.');
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
      clasificacion: tipo === 'ingreso' ? null : (datos.clasificacion || null),
      es_recurrente: esRecurrente,
      frecuencia: esRecurrente ? datos.frecuencia : null,
      proxima_fecha: proximaFecha,
      metodo_pago_id: datos.metodo_pago_id || null,
      proveedor_id: tipo === 'ingreso' ? null : (datos.proveedor_id || null),
      producto_id: tipo === 'ingreso' ? null : (datos.producto_id || null),
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
    if (!registro) throw new Error('Movimiento financiero no encontrado.');
    return this.serializar(registro);
  }

  static async actualizar(id, datos, usuario_id, inquilino_id) {
    const registro = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!registro) throw new Error('Movimiento financiero no encontrado.');

    if (datos.tipo !== undefined && !TIPOS_MOVIMIENTO.includes(datos.tipo)) {
      throw new Error('El tipo debe ser "ingreso", "costo" o "gasto".');
    }
    await this.validarReferencias(datos, usuario_id, inquilino_id);

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
        if (!datos.frecuencia && !registro.frecuencia) throw new Error('La frecuencia es requerida para un movimiento recurrente.');
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
    if (registro.tipo === 'ingreso') {
      registro.clasificacion = null;
      registro.proveedor_id = null;
      registro.producto_id = null;
      registro.variante_id = null;
      registro.envio_id = null;
    }

    await registro.save();
    return this.detalle(id, usuario_id);
  }

  static async eliminar(id, usuario_id) {
    const registro = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!registro) throw new Error('Movimiento financiero no encontrado.');
    registro.activo = false;
    await registro.save();
    return true;
  }

  static async duplicar(id, usuario_id) {
    const original = await CostoGasto.findOne({ where: { id, usuario_id } });
    if (!original) throw new Error('Movimiento financiero no encontrado.');

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
    if (!registro) throw new Error('Movimiento financiero no encontrado.');
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
    if (!registro) throw new Error('Movimiento financiero no encontrado.');
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
    const whereFecha = { usuario_id, activo: true, estado: { [Op.ne]: 'cancelado' } };
    if (fecha_desde && fecha_hasta) whereFecha.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };

    const totales = await CostoGasto.findAll({
      where: whereFecha,
      attributes: ['tipo', [CostoGasto.sequelize.fn('SUM', CostoGasto.sequelize.col('importe')), 'total']],
      group: ['tipo'],
      raw: true,
    });

    const gastosPeriodo = Number(totales.find(t => t.tipo === 'gasto')?.total || 0);
    const costosPeriodo = Number(totales.find(t => t.tipo === 'costo')?.total || 0);
    const otrosIngresosPeriodo = Number(totales.find(t => t.tipo === 'ingreso')?.total || 0);
    const totalEgresos = gastosPeriodo + costosPeriodo;

    const whereEnvio = { usuario_id, estado: { [Op.iLike]: 'entregado' } };
    if (fecha_desde && fecha_hasta) whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };

    const enviosEntregados = await Envio.findAll({
      where: whereEnvio,
      attributes: ['id', 'monto', 'costo_envio', 'delivery_a_cargo', 'cupon_descuento'],
      include: [{ model: EnvioItem, as: 'items', attributes: ['cantidad', 'precio_unitario', 'subtotal'], required: false }],
    });
    const ventasNetas = enviosEntregados.reduce((acc, envio) => acc + montoNumero(desgloseDelivery(envio).venta_producto), 0);
    const ingresos = ventasNetas + otrosIngresosPeriodo;

    const resultado = ingresos - totalEgresos;
    const margen = ingresos > 0 ? Number(((resultado / ingresos) * 100).toFixed(1)) : 0;

    return {
      gastos_periodo: gastosPeriodo,
      costos_periodo: costosPeriodo,
      otros_ingresos_periodo: otrosIngresosPeriodo,
      total_egresos: totalEgresos,
      ventas_netas: ventasNetas,
      ingresos,
      resultado,
      margen,
    };
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

    const whereGastos = { usuario_id, activo: true, estado: { [Op.ne]: 'cancelado' } };
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
      attributes: ['id', 'fecha', 'cliente', 'monto', 'costo_envio', 'delivery_a_cargo', 'cupon_descuento', 'estado'],
      include: [{ model: EnvioItem, as: 'items', attributes: ['cantidad', 'precio_unitario', 'subtotal'], required: false }],
      order: [['fecha', 'DESC'], ['id', 'DESC']],
    });

    return {
      resumen: resumenCalculado,
      gastos: gastos.map(this.serializar),
      ingresos: ingresos.map(v => {
        const data = this.serializar(v);
        data.ventas_netas = montoNumero(desgloseDelivery(v).venta_producto);
        data.cobro_total = montoNumero(v.monto);
        return data;
      }),
    };
  }

  static _costoDeItem(item) {
    if (item.componentes_vendidos && item.componentes_vendidos.length > 0) {
      return item.componentes_vendidos.reduce(
        (acc, comp) => acc + (Number(comp.costo_unitario) || 0) * (Number(comp.cantidad) || 0),
        0
      );
    }
    const producto = item.Producto;
    const costoUnitario = producto ? (Number(producto.precio_base) || Number(producto.precio_costo) || 0) : 0;
    return costoUnitario * (Number(item.cantidad) || 1);
  }

  static async _gastoMetaAds(usuario_id, inquilino_id, fecha_desde, fecha_hasta) {
    if (!usuario_id || !inquilino_id || !fecha_desde || !fecha_hasta) return 0;

    const filas = await MetaReporteFila.findAll({
      where: {
        inquilino_id,
        fecha_inicio: { [Op.ne]: null, [Op.lte]: fecha_hasta },
        fecha_fin: { [Op.ne]: null, [Op.gte]: fecha_desde },
      },
      attributes: ['fecha_inicio', 'fecha_fin', 'importe_gastado'],
      include: [
        { model: MetaCampanaInterna, as: 'campana', attributes: ['id'], required: false },
        { model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true },
      ],
    });

    const diaMs = 24 * 60 * 60 * 1000;
    const aMs = (ymd) => Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`);
    const diasInclusive = (iniMs, finMs) => Math.floor((finMs - iniMs) / diaMs) + 1;
    const desdeMs = aMs(fecha_desde);
    const hastaMs = aMs(fecha_hasta);

    return Math.round(filas.reduce((acc, fila) => {
      const gasto = Number(fila.importe_gastado) || 0;
      const iniMs = aMs(fila.fecha_inicio);
      const finMs = aMs(fila.fecha_fin);
      if (!gasto || Number.isNaN(iniMs) || Number.isNaN(finMs) || finMs < iniMs) return acc;
      const diasFila = diasInclusive(iniMs, finMs);
      const diasSolapados = diasInclusive(Math.max(iniMs, desdeMs), Math.min(finMs, hastaMs));
      if (diasSolapados <= 0) return acc;
      return acc + gasto * (Math.min(diasSolapados, diasFila) / diasFila) * MetaReportesService.MULTIPLICADOR_IVA;
    }, 0));
  }

  static async _datosReporteVisualPeriodo(filtros, usuario_id, inquilino_id) {
    const { fecha_desde, fecha_hasta } = filtros;
    const wherePeriodo = {};
    if (fecha_desde && fecha_hasta) wherePeriodo.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };

    const [envios, gastos, metaAds, productos, cuentasPendientes] = await Promise.all([
      Envio.findAll({
        where: { usuario_id, ...wherePeriodo },
        attributes: [
          'id', 'fecha', 'cliente', 'monto', 'costo_envio', 'estado', 'origen',
          'canal_venta_id', 'comision_pct_aplicada', 'quiere_factura', 'estado_financiero',
          'delivery_a_cargo', 'cupon_descuento',
        ],
        include: [
          { model: CanalVenta, as: 'canal_venta', attributes: ['id', 'nombre', 'slug'], required: false },
          { model: MetodoPago, attributes: ['id', 'custodia_cobro'], required: false },
          {
            model: EnvioItem,
            as: 'items',
            attributes: ['id', 'cantidad', 'precio_unitario', 'subtotal'],
            include: [
              { model: Producto, attributes: ['id', 'precio_base', 'precio_costo', 'impuestos_incluidos'], required: false },
              {
                model: EnvioItemComponente,
                as: 'componentes_vendidos',
                attributes: ['cantidad', 'costo_unitario'],
                required: false,
              },
            ],
          },
        ],
      }),
      CostoGasto.findAll({
        where: { usuario_id, activo: true, estado: { [Op.ne]: 'cancelado' }, ...wherePeriodo },
        include: INCLUDES_LISTA,
        order: [['fecha', 'DESC'], ['id', 'DESC']],
      }),
      this._gastoMetaAds(usuario_id, inquilino_id, fecha_desde, fecha_hasta),
      Producto.findAll({
        where: {
          activo: true,
          creado_por: usuario_id,
        },
        attributes: ['id', 'precio_base', 'precio_costo', 'cantidad_disponible'],
        raw: true,
      }),
      CostoGasto.sum('importe', {
        where: {
          usuario_id,
          activo: true,
          tipo: { [Op.in]: TIPOS_EGRESO },
          estado: 'pendiente',
          ...(fecha_hasta ? { fecha: { [Op.lte]: fecha_hasta } } : {}),
        },
      }),
    ]);

    const entregados = envios.filter(e => normalizarTexto(e.estado) === 'entregado');
    const devoluciones = envios
      .filter(e => ['devuelto', 'perdido'].includes(normalizarTexto(e.estado)))
      .reduce((acc, e) => acc + montoNumero(desgloseDelivery(e).venta_producto), 0);

    const ingresosPorCanal = { web: 0, whatsapp: 0, organico: 0 };
    let ventasTotales = 0;
    let cobrosReales = 0;
    let comisionesPasarela = 0;
    let logistica = 0;
    let salidasLogistica = 0;
    let ivaFacturado = 0;
    let costoProductosVendidos = 0;
    let courierPorRendir = 0;
    let courierPorPagar = 0;

    for (const envio of entregados) {
      const monto = montoNumero(envio.monto);
      const desglose = desgloseDelivery(envio);
      const ventaProducto = montoNumero(desglose.venta_producto);
      const cobroTotalCliente = monto + montoNumero(desglose.envio_fuera_del_monto);
      const retenidoCourier = dineroEnManoCourier(envio);
      const saldoCourier = saldoCourierPorRendir(envio);
      ventasTotales += ventaProducto;
      cobrosReales += Math.max(0, cobroTotalCliente - retenidoCourier);
      courierPorRendir += Math.max(0, saldoCourier);
      courierPorPagar += Math.max(0, -saldoCourier);
      comisionesPasarela += Math.round(cobroTotalCliente * ((Number(envio.comision_pct_aplicada) || 0) / 100));
      logistica += montoNumero(desglose.envio_absorbido);
      if (!retenidoCourier) salidasLogistica += montoNumero(desglose.envio_pagado);
      ivaFacturado += calcularIvaFacturadoEnvio(envio);

      for (const item of envio.items || []) {
        costoProductosVendidos += this._costoDeItem(item);
      }

      const canal = normalizarTexto(envio.canal_venta?.slug || envio.canal_venta?.nombre || envio.origen);
      if (canal.includes('whatsapp')) ingresosPorCanal.whatsapp += ventaProducto;
      else if (canal.includes('web') || canal.includes('landing') || canal.includes('meta')) ingresosPorCanal.web += ventaProducto;
      else ingresosPorCanal.organico += ventaProducto;
    }

    const registros = gastos.map(g => this.serializar(g));
    const ingresosManuales = registros.filter(g => g.tipo === 'ingreso');
    const egresosManuales = registros.filter(g => TIPOS_EGRESO.includes(g.tipo));
    const variableManual = egresosManuales.filter(g => g.clasificacion === 'variable' || (g.tipo === 'costo' && g.clasificacion !== 'fijo'));
    const fijoManual = egresosManuales.filter(g => g.clasificacion === 'fijo' || (g.tipo === 'gasto' && g.clasificacion !== 'variable'));
    const agruparPorCategoria = (items, prefijo) => {
      const grupos = new Map();
      for (const item of items) {
        const categoria = item.categoria || {};
        const id = categoria.id ? `${prefijo}_categoria_${categoria.id}` : `${prefijo}_sin_categoria`;
        if (!grupos.has(id)) {
          grupos.set(id, {
            id,
            categoria_id: categoria.id || null,
            label: categoria.nombre || 'Sin categoría',
            valor: 0,
            origen: 'control_financiero',
          });
        }
        grupos.get(id).valor += montoNumero(item.importe);
      }
      return [...grupos.values()].map(item => ({ ...item, valor: montoNumero(item.valor) }));
    };

    const totalOtrosIngresos = sumarImporte(ingresosManuales);
    const ingresosNetos = ventasTotales + totalOtrosIngresos - devoluciones;
    const costosVariables = [
      { id: 'costo_productos_vendidos', label: 'Costo de productos vendidos', valor: montoNumero(costoProductosVendidos) },
      { id: 'publicidad_meta_ads', label: 'Publicidad Meta Ads', valor: montoNumero(metaAds) },
      { id: 'comisiones_pasarela', label: 'Comisiones de pasarela', valor: montoNumero(comisionesPasarela) },
      { id: 'envios_logistica', label: 'Envíos/logística', valor: montoNumero(logistica) },
      ...agruparPorCategoria(variableManual, 'costo_variable'),
    ];
    const gastosFijos = agruparPorCategoria(fijoManual, 'gasto_fijo');

    const totalCostosVariables = costosVariables.reduce((acc, item) => acc + item.valor, 0);
    const totalGastosFijos = gastosFijos.reduce((acc, item) => acc + item.valor, 0);
    const gastosTotales = totalCostosVariables + totalGastosFijos;
    const margenContribucion = ingresosNetos - totalCostosVariables;
    const utilidadOperativa = margenContribucion - totalGastosFijos;
    const margenNeto = ingresosNetos > 0 ? Number(((utilidadOperativa / ingresosNetos) * 100).toFixed(1)) : 0;
    const roi = gastosTotales > 0 ? Number(((utilidadOperativa / gastosTotales) * 100).toFixed(1)) : 0;

    const salidasReales = registros
      .filter(g => TIPOS_EGRESO.includes(g.tipo) && g.estado === 'pagado')
      .reduce((acc, g) => acc + montoNumero(g.importe), 0) + comisionesPasarela + salidasLogistica;
    const entradasReales = cobrosReales + ingresosManuales
      .filter(g => g.estado === 'pagado')
      .reduce((acc, g) => acc + montoNumero(g.importe), 0);
    const flujoCajaNeto = entradasReales - salidasReales;

    const valorInventario = productos.reduce((acc, p) => {
      const costo = Number(p.precio_costo) || Number(p.precio_base) || 0;
      return acc + costo * (Number(p.cantidad_disponible) || 0);
    }, 0);

    const activos = [
      { id: 'caja_efectivo', label: 'Caja estimada del período', valor: montoNumero(flujoCajaNeto), derivado: true },
      { id: 'cuentas_cobrar', label: 'Cuentas por cobrar', valor: montoNumero(courierPorRendir) },
      { id: 'inventario', label: 'Inventario', valor: montoNumero(valorInventario) },
    ];
    const pasivos = [
      { id: 'proveedores', label: 'Cuentas por pagar a proveedores', valor: montoNumero(cuentasPendientes) },
      ...(courierPorPagar > 0 ? [{ id: 'courier_por_pagar', label: 'Courier por pagar', valor: montoNumero(courierPorPagar) }] : []),
      { id: 'iva_facturado', label: 'IVA estimado de ventas facturadas', valor: montoNumero(ivaFacturado) },
    ];

    return {
      periodo: { fecha_desde, fecha_hasta },
      indicadores: {
        ventas: ingresosNetos,
        utilidad_neta: utilidadOperativa,
        margen_neto: margenNeto,
        flujo_caja_neto: flujoCajaNeto,
        roi,
        caja_disponible: flujoCajaNeto,
      },
      ingresos: {
        ventas_totales: ventasTotales,
        ventas_web: ingresosPorCanal.web,
        ventas_whatsapp: ingresosPorCanal.whatsapp,
        ventas_organicas: ingresosPorCanal.organico,
        otros_ingresos: totalOtrosIngresos,
        otros_ingresos_disponible: true,
        devoluciones,
        ingresos_netos: ingresosNetos,
      },
      gastos: {
        costos_variables: costosVariables,
        gastos_fijos: gastosFijos,
        total_costos_variables: totalCostosVariables,
        total_gastos_fijos: totalGastosFijos,
        gastos_totales: gastosTotales,
      },
      resultado_operativo: {
        ingresos_netos: ingresosNetos,
        costos_variables: totalCostosVariables,
        margen_contribucion: margenContribucion,
        gastos_fijos: totalGastosFijos,
        utilidad_operativa: utilidadOperativa,
        margen_neto: margenNeto,
      },
      flujo_caja: {
        saldo_inicial_caja: 0,
        entradas_reales: entradasReales,
        salidas_reales: salidasReales,
        saldo_final_caja: flujoCajaNeto,
        nota: 'Caja estimada del período: cobros directos de la tienda menos salidas pagadas, comisiones y logística. El dinero retenido por courier queda en cuentas por cobrar hasta rendición. No incluye saldos bancarios iniciales porque todavía no existe un módulo de bancos.',
      },
      activos: {
        items: activos,
        total: activos.reduce((acc, item) => acc + item.valor, 0),
      },
      pasivos: {
        items: pasivos,
        total: pasivos.reduce((acc, item) => acc + item.valor, 0),
      },
      fuentes: {
        ventas: 'Pedidos entregados y otros ingresos registrados',
        costos: 'Costo de producto, Meta Ads, logística, comisiones y Control financiero',
        activos_pasivos: 'Inventario, pedidos pendientes, proveedores e IVA estimado de ventas facturadas',
      },
    };
  }

  static async reporteVisualFlujoCaja(filtros, usuario_id, inquilino_id) {
    const actual = await this._datosReporteVisualPeriodo(filtros, usuario_id, inquilino_id);
    const comparar = filtros.comparar_anterior === true || filtros.comparar_anterior === 'true' || filtros.comparar_anterior === '1';
    if (!comparar) return { ...actual, comparacion: null };

    const anteriorRango = periodoAnterior(filtros.fecha_desde, filtros.fecha_hasta);
    if (!anteriorRango) return { ...actual, comparacion: null };

    const anterior = await this._datosReporteVisualPeriodo(anteriorRango, usuario_id, inquilino_id);
    const filas = [
      {
        indicador: METRIC_TERMS.ventasNetas,
        actual: actual.indicadores.ventas,
        anterior: anterior.indicadores.ventas,
        variacion: variacion(actual.indicadores.ventas, anterior.indicadores.ventas),
        tipo: 'moneda',
      },
      {
        indicador: METRIC_TERMS.utilidadNeta,
        actual: actual.indicadores.utilidad_neta,
        anterior: anterior.indicadores.utilidad_neta,
        variacion: variacion(actual.indicadores.utilidad_neta, anterior.indicadores.utilidad_neta),
        tipo: 'moneda',
      },
      {
        indicador: METRIC_TERMS.margen,
        actual: actual.indicadores.margen_neto,
        anterior: anterior.indicadores.margen_neto,
        variacion: variacion(actual.indicadores.margen_neto, anterior.indicadores.margen_neto, 'pp'),
        tipo: 'porcentaje',
        unidad_variacion: 'pp',
      },
      {
        indicador: 'Gastos',
        actual: actual.gastos.gastos_totales,
        anterior: anterior.gastos.gastos_totales,
        variacion: variacion(actual.gastos.gastos_totales, anterior.gastos.gastos_totales),
        tipo: 'moneda',
      },
    ];

    return {
      ...actual,
      comparacion: {
        periodo_anterior: anterior.periodo,
        filas,
      },
    };
  }

  /**
   * Desgloses para el tab "Rentabilidad" del Centro de Inteligencia
   * Comercial (gastos por categoría, evolución mensual, compromiso
   * recurrente, top gastos). Las cifras de ingresos/margen "oficiales" del
   * negocio siguen viniendo de pedidosAnalyticsService.getAnalyticsCompleto
   * (que ya neta comisión/IVA/logística/COGS por pedido) — acá solo se
   * agrega el detalle propio de Control financiero que no existe en ningún
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

    const whereBase = { usuario_id, activo: true, estado: { [Op.ne]: 'cancelado' }, tipo: { [Op.in]: TIPOS_EGRESO }, envio_id: null, fecha: { [Op.between]: [desde, hasta] } };

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
        where: { usuario_id, activo: true, estado: { [Op.ne]: 'cancelado' }, tipo: { [Op.in]: TIPOS_EGRESO }, es_recurrente: true, parent_recurring_id: null },
        attributes: ['importe', 'frecuencia'],
        raw: true,
      }),
      Envio.findAll({
        where: { usuario_id, estado: { [Op.iLike]: 'entregado' }, fecha: { [Op.between]: [desde, hasta] } },
        attributes: ['id', 'fecha', 'monto', 'costo_envio', 'delivery_a_cargo', 'cupon_descuento'],
        include: [{ model: EnvioItem, as: 'items', attributes: ['cantidad', 'precio_unitario', 'subtotal'], required: false }],
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
    for (const envio of ingresosPorMesRaw) {
      const mes = String(envio.fecha || '').slice(0, 7);
      if (!mes) continue;
      if (!mesesMap[mes]) mesesMap[mes] = { mes, ingresos: 0, costos: 0, gastos: 0 };
      mesesMap[mes].ingresos += montoNumero(desgloseDelivery(envio).venta_producto);
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
module.exports.calcularIvaFacturadoEnvio = calcularIvaFacturadoEnvio;
module.exports.dineroEnManoCourier = dineroEnManoCourier;
module.exports.saldoCourierPorRendir = saldoCourierPorRendir;
