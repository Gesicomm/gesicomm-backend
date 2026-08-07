'use strict';

const { Envio, EnvioItem, Courier, Producto, Usuario } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const { resolverRangoFechas } = require('../utils/rangoFechas');

/**
 * Servicio de Inteligencia Comercial y Analytics de Pedidos/Envíos
 * Ejecuta consultas especializadas en paralelo con Promise.all()
 */

// 1. Embudo Integral de Conversión (Funnel)
async function getResumenFunnel(whereBase) {
  const envios = await Envio.findAll({
    where: whereBase,
    attributes: ['id', 'estado', 'estado_comercial', 'estado_logistico', 'courier_id', 'origen', 'monto'],
    raw: true,
  });

  const totalCreados = envios.length;
  let confirmados = 0;
  let cancelados = 0;
  let despachados = 0;
  let entregados = 0;
  let devueltos = 0;
  let enTransito = 0;

  let webTotal = 0;
  let webConfirmados = 0;
  let whatsappTotal = 0;
  let whatsappConfirmados = 0;

  for (const e of envios) {
    const st = (e.estado || '').toLowerCase();
    const stCom = (e.estado_comercial || '').toLowerCase();
    const stLog = (e.estado_logistico || '').toLowerCase();
    const origen = (e.origen || 'WEB').toUpperCase();

    // Confirmación Comercial
    const isConfirmado = stCom === 'confirmado' || ['confirmado', 'en tránsito', 'en transito', 'entregado', 'rendido'].includes(st);
    const isCancelado = stCom === 'cancelado' || stCom === 'rechazado' || ['cancelado', 'rechazado'].includes(st);

    if (isConfirmado) confirmados++;
    if (isCancelado) cancelados++;

    if (origen === 'WEB') {
      webTotal++;
      if (isConfirmado) webConfirmados++;
    } else if (origen === 'WHATSAPP') {
      whatsappTotal++;
      if (isConfirmado) whatsappConfirmados++;
    }

    // Logística
    const isDespachado = Boolean(e.courier_id) || ['en tránsito', 'en transito', 'entregado', 'rendido', 'devuelto'].includes(st) || ['asignado', 'en tránsito', 'entregado', 'rendido', 'devuelto'].includes(stLog);
    const isEntregado = ['entregado', 'rendido'].includes(st) || ['entregado', 'rendido'].includes(stLog);
    const isDevuelto = ['devuelto', 'no entregado', 'fallido'].includes(st) || stLog === 'devuelto';
    const isTransito = ['en tránsito', 'en transito'].includes(st) || stLog === 'en tránsito';

    if (isDespachado) despachados++;
    if (isEntregado) entregados++;
    if (isDevuelto) devueltos++;
    if (isTransito) enTransito++;
  }

  const pctConfirmacion = totalCreados > 0 ? Number(((confirmados / totalCreados) * 100).toFixed(1)) : 0;
  const pctDespachados = confirmados > 0 ? Number(((despachados / confirmados) * 100).toFixed(1)) : 0;
  const pctEntrega = despachados > 0 ? Number(((entregados / despachados) * 100).toFixed(1)) : 0;
  const pctDevolucion = despachados > 0 ? Number(((devueltos / despachados) * 100).toFixed(1)) : 0;

  const pctWebConf = webTotal > 0 ? Number(((webConfirmados / webTotal) * 100).toFixed(1)) : 0;
  const pctWppConf = whatsappTotal > 0 ? Number(((whatsappConfirmados / whatsappTotal) * 100).toFixed(1)) : 0;

  return {
    total_creados: totalCreados,
    confirmados,
    cancelados,
    despachados,
    en_transito: enTransito,
    entregados,
    devueltos,
    tasa_confirmacion: pctConfirmacion,
    tasa_despacho: pctDespachados,
    tasa_entrega: pctEntrega,
    tasa_devolucion: pctDevolucion,
    canales: {
      web: { total: webTotal, confirmados: webConfirmados, tasa: pctWebConf },
      whatsapp: { total: whatsappTotal, confirmados: whatsappConfirmados, tasa: pctWppConf },
      otros: {
        total: totalCreados - (webTotal + whatsappTotal),
        confirmados: confirmados - (webConfirmados + whatsappConfirmados),
        tasa: (totalCreados - (webTotal + whatsappTotal)) > 0
          ? Number((((confirmados - (webConfirmados + whatsappConfirmados)) / (totalCreados - (webTotal + whatsappTotal))) * 100).toFixed(1))
          : 0,
      }
    }
  };
}

// 2. KPIs Financieros y Rentabilidad Estimada
async function getKpisFinancieros(whereBase) {
  const envios = await Envio.findAll({
    where: whereBase,
    include: [
      {
        model: EnvioItem,
        as: 'items',
        include: [{ model: Producto, attributes: ['id', 'precio_costo'] }],
      }
    ]
  });

  let facturacionEntregada = 0;
  let valorConfirmado = 0;
  let valorPerdido = 0;
  let costoLogisticoTotal = 0;
  let costoLogisticoEntregados = 0;
  let costoMercaderiaEntregada = 0;
  let costoComisionTotal = 0;
  let ivaFacturadoTotal = 0;
  let pedidosEntregadosCount = 0;

  for (const e of envios) {
    const st = (e.estado || '').toLowerCase();
    const monto = Number(e.monto || 0);
    const costoEnvio = Number(e.costo_envio || 0);
    costoLogisticoTotal += costoEnvio;

    const isEntregado = ['entregado', 'rendido'].includes(st);
    const isConfirmado = ['confirmado', 'en tránsito', 'en transito', 'entregado', 'rendido'].includes(st);
    const isPerdido = ['cancelado', 'rechazado', 'devuelto'].includes(st);

    if (isEntregado) {
      facturacionEntregada += monto;
      costoLogisticoEntregados += costoEnvio;
      pedidosEntregadosCount++;

      const comisionPct = Number(e.comision_pct_aplicada || 0);
      costoComisionTotal += monto * (comisionPct / 100);

      if (e.quiere_factura) {
        ivaFacturadoTotal += monto * 0.10;
      }

      if (e.items && e.items.length > 0) {
        for (const item of e.items) {
          const costoUnit = item.Producto && item.Producto.precio_costo ? Number(item.Producto.precio_costo) : 0;
          costoMercaderiaEntregada += costoUnit * (item.cantidad || 1);
        }
      }
    } else if (isConfirmado) {
      valorConfirmado += monto;
    }

    if (isPerdido) {
      valorPerdido += monto;
    }
  }

  const ticketPromedio = pedidosEntregadosCount > 0 ? Math.round(facturacionEntregada / pedidosEntregadosCount) : 0;
  const costoLogisticoPorEntrega = pedidosEntregadosCount > 0 ? Math.round(costoLogisticoEntregados / pedidosEntregadosCount) : 0;
  const costoComisionPorEntrega = pedidosEntregadosCount > 0 ? Math.round(costoComisionTotal / pedidosEntregadosCount) : 0;
  const margenBrutoEstimado = facturacionEntregada - costoLogisticoEntregados - costoMercaderiaEntregada - costoComisionTotal - ivaFacturadoTotal;
  const pctMargenBruto = facturacionEntregada > 0 ? Number(((margenBrutoEstimado / facturacionEntregada) * 100).toFixed(1)) : 0;

  return {
    facturacion_entregada: facturacionEntregada,
    valor_confirmado: valorConfirmado,
    valor_perdido: valorPerdido,
    ticket_promedio: ticketPromedio,
    costo_logistico_total: costoLogisticoTotal,
    costo_logistico_por_entrega: costoLogisticoPorEntrega,
    costo_mercaderia_entregada: costoMercaderiaEntregada,
    costo_comision_total: Math.round(costoComisionTotal),
    costo_comision_por_entrega: costoComisionPorEntrega,
    iva_facturado_total: Math.round(ivaFacturadoTotal),
    margen_bruto_estimado: Math.round(margenBrutoEstimado),
    pct_margen_bruto: pctMargenBruto,
  };
}

// 3. Ranking de Productos (¿Qué se vende, confirma y devuelve más?)
async function getProductosAnalytics(whereBase) {
  const envios = await Envio.findAll({
    where: whereBase,
    include: [
      {
        model: EnvioItem,
        as: 'items',
        include: [{ model: Producto, attributes: ['id', 'nombre', 'sku', 'precio_costo'] }],
      }
    ]
  });

  const mapProds = {};

  for (const e of envios) {
    const st = (e.estado || '').toLowerCase();
    const isConfirmado = ['confirmado', 'en tránsito', 'en transito', 'entregado', 'rendido'].includes(st);
    const isEntregado = ['entregado', 'rendido'].includes(st);
    const isDevuelto = ['devuelto', 'no entregado', 'fallido'].includes(st);
    const canal = (e.origen || 'WEB').toUpperCase();

    if (e.items && e.items.length > 0) {
      for (const item of e.items) {
        const key = item.producto_id ? `p_${item.producto_id}` : `name_${item.nombre_producto}`;
        if (!mapProds[key]) {
          mapProds[key] = {
            producto_id: item.producto_id || null,
            nombre: item.nombre_producto || (item.Producto ? item.Producto.nombre : 'Producto'),
            sku: item.Producto ? item.Producto.sku : null,
            total_pedidos: 0,
            unidades_totales: 0,
            confirmados: 0,
            entregados: 0,
            devueltos: 0,
            facturacion_total: 0,
            costo_total: 0,
            canales: { WEB: 0, WHATSAPP: 0, OTROS: 0 }
          };
        }

        const p = mapProds[key];
        p.total_pedidos += 1;
        p.unidades_totales += (item.cantidad || 1);
        if (isConfirmado) p.confirmados += 1;
        if (isEntregado) {
          p.entregados += 1;
          p.facturacion_total += Number(item.subtotal || item.precio_unitario * (item.cantidad || 1) || 0);
          const costoUnit = item.Producto && item.Producto.precio_costo ? Number(item.Producto.precio_costo) : 0;
          p.costo_total += costoUnit * (item.cantidad || 1);
        }
        if (isDevuelto) p.devueltos += 1;

        if (canal === 'WEB') p.canales.WEB += 1;
        else if (canal === 'WHATSAPP') p.canales.WHATSAPP += 1;
        else p.canales.OTROS += 1;
      }
    }
  }

  const lista = Object.values(mapProds).map((p) => {
    const tasaConf = p.total_pedidos > 0 ? Number(((p.confirmados / p.total_pedidos) * 100).toFixed(1)) : 0;
    const tasaEnt = p.total_pedidos > 0 ? Number(((p.entregados / p.total_pedidos) * 100).toFixed(1)) : 0;
    const tasaDev = p.total_pedidos > 0 ? Number(((p.devueltos / p.total_pedidos) * 100).toFixed(1)) : 0;
    const margen = p.facturacion_total - p.costo_total;

    let badge = 'excelente';
    if (tasaConf < 70 || tasaDev > 15) badge = 'critico';
    else if (tasaConf < 85 || tasaDev > 10) badge = 'moderado';

    return {
      ...p,
      tasa_confirmacion: tasaConf,
      tasa_entrega: tasaEnt,
      tasa_devolucion: tasaDev,
      margen_estimado: margen,
      badge,
    };
  });

  // Ordenar por unidades totales / pedidos descendente
  return lista.sort((a, b) => b.unidades_totales - a.unidades_totales);
}

// 4. Rendimiento de Confirmadores (Métrica Comercial)
async function getConfirmadoresAnalytics(whereBase) {
  const envios = await Envio.findAll({
    where: whereBase,
    attributes: ['id', 'confirmador', 'estado', 'estado_comercial', 'monto', 'origen'],
    include: [
      {
        model: EnvioItem,
        as: 'items',
        attributes: ['nombre_producto', 'cantidad']
      }
    ]
  });

  const mapConf = {};

  for (const e of envios) {
    const nombre = (e.confirmador || '').trim() || 'Sin Confirmador Asignado';
    const st = (e.estado || '').toLowerCase();
    const isConfirmado = ['confirmado', 'en tránsito', 'en transito', 'entregado', 'rendido'].includes(st);
    const isCancelado = ['cancelado', 'rechazado'].includes(st);
    const monto = Number(e.monto || 0);

    if (!mapConf[nombre]) {
      mapConf[nombre] = {
        confirmador: nombre,
        total_pedidos: 0,
        confirmados: 0,
        cancelados: 0,
        monto_confirmado: 0,
        productosCont: {},
        canalesCont: {},
      };
    }

    const c = mapConf[nombre];
    c.total_pedidos += 1;
    if (isConfirmado) {
      c.confirmados += 1;
      c.monto_confirmado += monto;
    }
    if (isCancelado) c.cancelados += 1;

    const canal = (e.origen || 'WEB').toUpperCase();
    c.canalesCont[canal] = (c.canalesCont[canal] || 0) + (isConfirmado ? 1 : 0);

    if (e.items && e.items.length > 0) {
      for (const item of e.items) {
        c.productosCont[item.nombre_producto] = (c.productosCont[item.nombre_producto] || 0) + (isConfirmado ? 1 : 0);
      }
    }
  }

  const lista = Object.values(mapConf).map((c) => {
    const tasaConf = c.total_pedidos > 0 ? Number(((c.confirmados / c.total_pedidos) * 100).toFixed(1)) : 0;
    const ticketProm = c.confirmados > 0 ? Math.round(c.monto_confirmado / c.confirmados) : 0;

    let mejorProd = 'N/A';
    let maxP = 0;
    for (const [prod, cnt] of Object.entries(c.productosCont)) {
      if (cnt > maxP) { maxP = cnt; mejorProd = prod; }
    }

    let mejorCanal = 'N/A';
    let maxC = 0;
    for (const [chan, cnt] of Object.entries(c.canalesCont)) {
      if (cnt > maxC) { maxC = cnt; mejorCanal = chan; }
    }

    let badge = 'excelente';
    if (tasaConf < 70) badge = 'critico';
    else if (tasaConf < 85) badge = 'moderado';

    return {
      confirmador: c.confirmador,
      total_pedidos: c.total_pedidos,
      confirmados: c.confirmados,
      cancelados: c.cancelados,
      tasa_confirmacion: tasaConf,
      monto_confirmado: c.monto_confirmado,
      ticket_promedio: ticketProm,
      mejor_producto: mejorProd,
      mejor_canal: mejorCanal,
      badge,
    };
  });

  return lista.sort((a, b) => b.confirmados - a.confirmados);
}

// 5. Rendimiento de Couriers (Tarjetas de Transporte y Logística)
async function getCouriersAnalytics(whereBase, usuario_id) {
  const couriersDb = await Courier.findAll({
    where: { usuario_id },
    attributes: ['id', 'nombre', 'telefono', 'vehiculo'],
    raw: true,
  });

  const envios = await Envio.findAll({
    where: whereBase,
    attributes: ['id', 'courier_id', 'estado', 'monto', 'costo_envio'],
    raw: true,
  });

  const mapCouriers = {};
  for (const c of couriersDb) {
    mapCouriers[c.id] = {
      courier_id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      vehiculo: c.vehiculo,
      total_asignados: 0,
      entregados: 0,
      en_transito: 0,
      devueltos: 0,
      pendientes: 0,
      monto_recaudado: 0,
      costo_fletes: 0,
    };
  }

  // Entrada para Delivery Propio / Sin Courier
  mapCouriers['null'] = {
    courier_id: null,
    nombre: 'Delivery Propio / Sin Asignar',
    telefono: null,
    vehiculo: null,
    total_asignados: 0,
    entregados: 0,
    en_transito: 0,
    devueltos: 0,
    pendientes: 0,
    monto_recaudado: 0,
    costo_fletes: 0,
  };

  for (const e of envios) {
    const key = e.courier_id ? e.courier_id : 'null';
    if (!mapCouriers[key]) {
      mapCouriers[key] = {
        courier_id: e.courier_id,
        nombre: `Courier #${e.courier_id}`,
        total_asignados: 0,
        entregados: 0,
        en_transito: 0,
        devueltos: 0,
        pendientes: 0,
        monto_recaudado: 0,
        costo_fletes: 0,
      };
    }

    const c = mapCouriers[key];
    c.total_asignados += 1;
    c.costo_fletes += Number(e.costo_envio || 0);

    const st = (e.estado || '').toLowerCase();
    if (['entregado', 'rendido'].includes(st)) {
      c.entregados += 1;
      c.monto_recaudado += Number(e.monto || 0);
    } else if (['en tránsito', 'en transito'].includes(st)) {
      c.en_transito += 1;
    } else if (['devuelto', 'no entregado', 'cancelado', 'rechazado'].includes(st)) {
      c.devueltos += 1;
    } else {
      c.pendientes += 1;
    }
  }

  const lista = Object.values(mapCouriers)
    .filter(c => c.total_asignados > 0 || c.courier_id !== null)
    .map(c => {
      const tasaEntrega = c.total_asignados > 0 ? Number(((c.entregados / c.total_asignados) * 100).toFixed(1)) : 0;
      const tasaDev = c.total_asignados > 0 ? Number(((c.devueltos / c.total_asignados) * 100).toFixed(1)) : 0;

      let badge = 'excelente';
      if (tasaDev > 15 || tasaEntrega < 70) badge = 'critico';
      else if (tasaDev > 10 || tasaEntrega < 85) badge = 'moderado';

      return {
        ...c,
        tasa_entrega: tasaEntrega,
        tasa_devolucion: tasaDev,
        badge,
      };
    });

  return lista.sort((a, b) => b.total_asignados - a.total_asignados);
}

// 6. Timeline de Tendencias (Sparklines)
async function getTimelineTendencias(whereBase, fechaDesde, fechaHasta) {
  const envios = await Envio.findAll({
    where: whereBase,
    attributes: ['id', 'fecha', 'dispatchedAt', 'estado', 'monto'],
    raw: true,
  });

  const mapTimeline = {};

  for (const e of envios) {
    const f = e.dispatchedAt || e.fecha;
    if (!f) continue;

    if (!mapTimeline[f]) {
      mapTimeline[f] = { fecha: f, pedidos: 0, confirmados: 0, entregados: 0, devueltos: 0, monto: 0 };
    }

    const t = mapTimeline[f];
    t.pedidos += 1;

    const st = (e.estado || '').toLowerCase();
    if (['confirmado', 'en tránsito', 'en transito', 'entregado', 'rendido'].includes(st)) t.confirmados += 1;
    if (['entregado', 'rendido'].includes(st)) {
      t.entregados += 1;
      t.monto += Number(e.monto || 0);
    }
    if (['devuelto', 'no entregado', 'cancelado'].includes(st)) t.devueltos += 1;
  }

  // Ordenar cronológicamente
  const timeline = Object.values(mapTimeline).sort((a, b) => a.fecha.localeCompare(b.fecha));
  return timeline;
}

// 7. Generador de Alertas y Smart Insights Accionables
function getSmartInsights(funnel, kpis, productos, confirmadores, couriers) {
  const insights = [];

  // Insight 1: Producto estrella
  if (productos.length > 0) {
    const top = productos[0];
    insights.push({
      tipo: 'positivo',
      icono: 'Trophy',
      titulo: 'Producto de Alto Volumen',
      mensaje: `"${top.nombre}" lidera la demanda con ${top.unidades_totales} unidades y una tasa de confirmación del ${top.tasa_confirmacion}%.`,
    });
  }

  // Insight 2: Alerta de baja confirmación en producto
  const criticoProd = productos.find(p => p.total_pedidos >= 3 && p.tasa_confirmacion < 70);
  if (criticoProd) {
    insights.push({
      tipo: 'alerta',
      icono: 'AlertTriangle',
      titulo: 'Oportunidad de Confirmación',
      mensaje: `El producto "${criticoProd.nombre}" tiene una tasa de confirmación del ${criticoProd.tasa_confirmacion}%. Se sugiere revisar el speech comercial o la calidad de leads.`,
    });
  }

  // Insight 3: Alerta de Devolución en Couriers
  const courierCritico = couriers.find(c => c.total_asignados >= 3 && c.tasa_devolucion > 12);
  if (courierCritico) {
    insights.push({
      tipo: 'critico',
      icono: 'Truck',
      titulo: 'Alta Tasa de Devolución Logística',
      mensaje: `El courier "${courierCritico.nombre}" registra un ${courierCritico.tasa_devolucion}% de devoluciones (${courierCritico.devueltos} pedidos), superior al umbral óptimo del 8%.`,
    });
  }

  // Insight 4: Desempeño de Confirmadores
  if (confirmadores.length > 0) {
    const topConf = confirmadores[0];
    if (topConf.total_pedidos > 0) {
      insights.push({
        tipo: 'positivo',
        icono: 'UserCheck',
        titulo: 'Top Confirmador',
        mensaje: `"${topConf.confirmador}" lidera el equipo con ${topConf.confirmados} pedidos confirmados (${topConf.tasa_confirmacion}% de efectividad).`,
      });
    }
  }

  // Insight 5: Comparativa de Canales
  if (funnel.canales.web.total > 0 && funnel.canales.whatsapp.total > 0) {
    const diff = funnel.canales.whatsapp.tasa - funnel.canales.web.tasa;
    if (Math.abs(diff) >= 5) {
      const mejor = diff > 0 ? 'WhatsApp' : 'Web';
      insights.push({
        tipo: 'info',
        icono: 'TrendingUp',
        titulo: 'Rendimiento por Canal',
        mensaje: `El canal ${mejor} presenta un ${Math.abs(diff).toFixed(1)}% mayor tasa de confirmación.`,
      });
    }
  }

  return insights;
}

// Función principal exportada
exports.getAnalyticsCompleto = async (filtros = {}, usuario_id) => {
  const { desde, hasta } = resolverRangoFechas(filtros);

  const whereBase = {
    usuario_id,
    [Op.or]: [
      { dispatchedAt: { [Op.between]: [desde, hasta] } },
      { fecha: { [Op.between]: [desde, hasta] } }
    ]
  };

  if (filtros.confirmador && filtros.confirmador !== 'TODOS') {
    whereBase.confirmador = filtros.confirmador;
  }
  if (filtros.courier_id && filtros.courier_id !== 'TODOS') {
    whereBase.courier_id = filtros.courier_id === 'null' ? null : filtros.courier_id;
  }
  if (filtros.origen && filtros.origen !== 'TODOS') {
    whereBase.origen = filtros.origen;
  }
  if (filtros.campana) {
    whereBase.campaign_name = filtros.campana;
  }

  // Lista de confirmadores únicos disponibles en el inquilino
  const confirmadoresDisponiblesPromise = Envio.findAll({
    where: { usuario_id, confirmador: { [Op.ne]: null } },
    attributes: [[fn('DISTINCT', col('confirmador')), 'confirmador']],
    raw: true,
  });

  // Ejecución en paralelo con Promise.all()
  const [
    funnel,
    kpisFinancieros,
    rankingProductos,
    confirmadores,
    couriers,
    tendencias,
    rawConf
  ] = await Promise.all([
    getResumenFunnel(whereBase),
    getKpisFinancieros(whereBase),
    getProductosAnalytics(whereBase),
    getConfirmadoresAnalytics(whereBase),
    getCouriersAnalytics(whereBase, usuario_id),
    getTimelineTendencias(whereBase, desde, hasta),
    confirmadoresDisponiblesPromise,
  ]);

  const smartInsights = getSmartInsights(funnel, kpisFinancieros, rankingProductos, confirmadores, couriers);
  const confirmadoresDisponibles = rawConf.map(r => r.confirmador).filter(Boolean);

  return {
    rango_fechas: { desde, hasta, periodo: filtros.periodo || 'este_mes' },
    funnel,
    kpis: kpisFinancieros,
    ranking_productos: rankingProductos,
    confirmadores,
    couriers,
    tendencias,
    insights: smartInsights,
    confirmadores_disponibles: confirmadoresDisponibles,
  };
};
