'use strict';

const { Envio, EnvioItem, EnvioItemComponente, Courier, Producto, Usuario, CostoGasto, CategoriaCostoGasto, PaymentTransaction, CanalVenta, Landing, LandingEvento, Tienda } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../config/database');
const { resolverRangoFechas } = require('../utils/rangoFechas');

/**
 * Servicio de Inteligencia Comercial y Analytics de Pedidos/Envíos
 * Ejecuta consultas especializadas en paralelo con Promise.all()
 */

/**
 * Traducción del `origen` histórico (texto libre) al slug del catálogo de
 * canales. Es la MISMA tabla de equivalencias que usa el backfill de
 * scripts/migrar-canales-venta.js — si cambia una, tiene que cambiar la otra.
 *
 * Solo se usa como red de seguridad para un pedido sin `canal_venta_id`.
 * Sin esto, un pedido de la landing (origen 'LANDING') no encontraba el
 * canal 'web' y caía en "Sin canal", quedando fuera de su propio embudo.
 */
const SLUG_POR_ORIGEN = {
  LANDING: 'web',
  META_ADS: 'web',
  WEB: 'organico',
  WHATSAPP: 'whatsapp',
};

/**
 * Costo real de mercadería de UN EnvioItem entregado. Se prefiere siempre el
 * snapshot de EnvioItemComponente (existe desde que el pedido pasó por
 * "Confirmado" — ver envioController.descontarStockYSnapshot): ya tiene en
 * cuenta el multiplicador de stock de una oferta (ej. x3 = 3 unidades
 * físicas) y el costo vigente al momento de la venta, no el actual.
 */
function costoDeItem(item) {
  if (item.componentes_vendidos && item.componentes_vendidos.length > 0) {
    return item.componentes_vendidos.reduce((acc, comp) => acc + (Number(comp.costo_unitario) || 0) * (comp.cantidad || 0), 0);
  }
  // Sin snapshot (pedido anterior a EnvioItemComponente): el costo del
  // comerciante es `precio_base`, el precio de lista al que le compra al
  // admin — NO `precio_costo`, que es lo que le costó al admin y que el
  // comerciante nunca paga. Misma regla que costoParaComerciante() en
  // envioController: si cambia una, tiene que cambiar la otra.
  const prod = item.Producto;
  const costoUnit = prod ? (Number(prod.precio_base) || Number(prod.precio_costo) || 0) : 0;
  return costoUnit * (item.cantidad || 1);
}

// 1. Embudo Integral de Conversión (Funnel)
async function getResumenFunnel(whereBase, canalesCatalogo = []) {
  const envios = await Envio.findAll({
    where: whereBase,
    attributes: ['id', 'estado', 'estado_comercial', 'estado_logistico', 'courier_id', 'origen', 'canal_venta_id', 'monto'],
    raw: true,
  });

  const totalCreados = envios.length;
  let confirmados = 0;
  let cancelados = 0;
  let despachados = 0;
  let entregados = 0;
  let devueltos = 0;
  let enTransito = 0;
  let perdidos = 0;

  // Contadores por canal — 'landing' es su propio bucket (checkout propio con
  // formulario, ver landing.service.js crearCheckout) en vez de diluirse en
  // "otros": es la única forma de armar el Embudo de Formularios Web.
  // Los buckets salen del catálogo `canales_venta` (tabla, no constantes):
  // agregar un canal es cargar una fila, no tocar este archivo. Se indexan
  // por id y por slug para poder ubicar tanto un pedido ya migrado
  // (canal_venta_id) como uno viejo que todavía tiene el `origen` de texto.
  const canales = {};
  const canalPorId = new Map();
  const canalPorSlug = new Map();
  for (const c of canalesCatalogo) {
    canales[c.slug] = { canal_id: c.id, nombre: c.nombre, total: 0, cancelados: 0, confirmados: 0, entregados: 0 };
    canalPorId.set(c.id, canales[c.slug]);
    canalPorSlug.set(c.slug, canales[c.slug]);
  }
  // "Sin canal" recoge los pedidos que todavía no tienen canal asignado y
  // cuyo `origen` histórico no coincide con ninguno del catálogo. Existe
  // para que ningún pedido (ni su facturación) desaparezca del reporte.
  canales.sin_canal = { canal_id: null, nombre: 'Sin canal', total: 0, cancelados: 0, confirmados: 0, entregados: 0 };

  for (const e of envios) {
    const st = (e.estado || '').toLowerCase();
    const stCom = (e.estado_comercial || '').toLowerCase();
    const stLog = (e.estado_logistico || '').toLowerCase();
    const origen = (e.origen || 'WEB').toUpperCase();

    // Confirmación Comercial — catálogo operativo nuevo (9 valores, ver
    // envioController.ESTADOS_OPERATIVOS): cualquier estado posterior a
    // Pendiente implica que el pedido llegó a confirmarse en algún momento.
    const isConfirmado = stCom === 'confirmado' || ['confirmado', 'preparado', 'despachado', 'reprogramado', 'entregado', 'devuelto', 'perdido'].includes(st);
    const isCancelado = stCom === 'cancelado' || stCom === 'rechazado' || st === 'cancelado';

    // Logística
    const isDespachado = Boolean(e.courier_id) || ['despachado', 'reprogramado', 'entregado', 'devuelto', 'perdido'].includes(st) || ['asignado', 'despachado', 'entregado', 'devuelto', 'perdido'].includes(stLog);
    const isEntregado = st === 'entregado' || stLog === 'entregado';
    const isDevuelto = ['devuelto', 'no entregado', 'fallido'].includes(st) || stLog === 'devuelto';
    const isTransito = st === 'despachado' || stLog === 'despachado';
    const isPerdido = st === 'perdido' || stLog === 'perdido';

    if (isConfirmado) confirmados++;
    if (isCancelado) cancelados++;
    if (isDespachado) despachados++;
    if (isEntregado) entregados++;
    if (isDevuelto) devueltos++;
    if (isTransito) enTransito++;
    if (isPerdido) perdidos++;

    // Primero el canal asignado; si el pedido todavía no fue migrado, se
    // intenta ubicar por el `origen` de texto. El guion bajo se normaliza a
    // guion porque los slugs del catálogo usan guion (META_ADS → meta-ads).
    const canal = canalPorId.get(e.canal_venta_id)
      || canalPorSlug.get(SLUG_POR_ORIGEN[origen] || '')
      || canales.sin_canal;
    canal.total++;
    if (isCancelado) canal.cancelados++;
    if (isConfirmado) canal.confirmados++;
    if (isEntregado) canal.entregados++;
  }

  const pctConfirmacion = totalCreados > 0 ? Number(((confirmados / totalCreados) * 100).toFixed(1)) : 0;
  const pctDespachados = totalCreados > 0 ? Number(((despachados / totalCreados) * 100).toFixed(1)) : 0;
  const pctEntrega = totalCreados > 0 ? Number(((entregados / totalCreados) * 100).toFixed(1)) : 0;
  const pctDevolucion = totalCreados > 0 ? Number(((devueltos / totalCreados) * 100).toFixed(1)) : 0;
  const pctPerdida = totalCreados > 0 ? Number(((perdidos / totalCreados) * 100).toFixed(1)) : 0;
  const pctCancelacion = totalCreados > 0 ? Number(((cancelados / totalCreados) * 100).toFixed(1)) : 0;

  // tasa por canal = confirmados/total, para no romper nada que ya la consuma;
  // efectividad (entregados/total) queda como campo aparte para el Embudo
  // WhatsApp / Formularios Web, que necesitan ambas cosas.
  for (const canal of Object.values(canales)) {
    canal.tasa = canal.total > 0 ? Number(((canal.confirmados / canal.total) * 100).toFixed(1)) : 0;
    canal.efectividad = canal.total > 0 ? Number(((canal.entregados / canal.total) * 100).toFixed(1)) : 0;
  }

  return {
    total_creados: totalCreados,
    confirmados,
    cancelados,
    despachados,
    en_transito: enTransito,
    entregados,
    devueltos,
    perdidos,
    tasa_confirmacion: pctConfirmacion,
    tasa_cancelacion: pctCancelacion,
    tasa_despacho: pctDespachados,
    tasa_entrega: pctEntrega,
    tasa_devolucion: pctDevolucion,
    tasa_perdida: pctPerdida,
    canales,
  };
}

/**
 * Lectura única de pedidos con sus ítems para los tres análisis que la
 * necesitan (KPIs financieros, ranking de productos y ofertas). Antes cada
 * uno hacía su propia consulta: tres joins idénticos sobre las mismas filas
 * en cada carga del dashboard.
 *
 * Los `attributes` son la UNIÓN de lo que pedía cada uno — quitar uno de
 * acá rompe en silencio al análisis que lo lea (`undefined` en vez de un
 * número), así que si un cálculo necesita un campo nuevo, se agrega acá.
 */
function getEnviosConItems(whereBase) {
  return Envio.findAll({
    where: whereBase,
    include: [
      {
        model: EnvioItem,
        as: 'items',
        include: [
          { model: Producto, attributes: ['id', 'nombre', 'sku', 'precio_costo', 'precio_base'] },
          {
            model: EnvioItemComponente,
            as: 'componentes_vendidos',
            attributes: ['cantidad', 'costo_unitario', 'cantidad_perdida', 'cantidad_devuelta_danada', 'cantidad_devuelta_vendible'],
          },
        ],
      }
    ]
  });
}

// 2. KPIs Financieros y Rentabilidad Estimada
function getKpisFinancieros(envios) {

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

    const isEntregado = st === 'entregado';
    const isConfirmado = ['confirmado', 'preparado', 'despachado', 'reprogramado'].includes(st);
    const isPerdido = ['cancelado', 'devuelto', 'perdido'].includes(st);

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
          costoMercaderiaEntregada += costoDeItem(item);
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
    // El que realmente entra en margen_bruto_estimado es el de los pedidos
    // ENTREGADOS; `costo_logistico_total` incluye además los que no se
    // entregaron. Se exponen los dos para que la tarjeta de Rentabilidad
    // pueda mostrar el importe que efectivamente se restó y cierre la cuenta.
    costo_logistico_entregados: costoLogisticoEntregados,
    costo_logistico_por_entrega: costoLogisticoPorEntrega,
    costo_mercaderia_entregada: costoMercaderiaEntregada,
    costo_comision_total: Math.round(costoComisionTotal),
    costo_comision_por_entrega: costoComisionPorEntrega,
    iva_facturado_total: Math.round(ivaFacturadoTotal),
    margen_bruto_estimado: Math.round(margenBrutoEstimado),
    pct_margen_bruto: pctMargenBruto,
  };
}

// 2b. Costos y Gastos operativos del módulo Finanzas (fuera de whereBase
// porque CostoGasto no es un Envio: se filtra directo por usuario_id/fecha).
// Se excluyen a propósito los registros con envio_id (costos "asociados a
// una venta") para no duplicar lo que getKpisFinancieros ya resta a nivel
// de pedido (costo_envio, comisión, precio_costo de los ítems) — ver spec
// del módulo, regla "no duplicar importes cuando un costo ya esté asociado
// a una venta".
async function getGastosOperativos(usuario_id, desde, hasta) {
  const filas = await CostoGasto.findAll({
    where: {
      usuario_id,
      activo: true,
      envio_id: null,
      fecha: { [Op.between]: [desde, hasta] },
    },
    attributes: ['tipo', [fn('SUM', col('importe')), 'total']],
    group: ['tipo'],
    raw: true,
  });

  const gastos = Number(filas.find(f => f.tipo === 'gasto')?.total || 0);
  const costosAdicionales = Number(filas.find(f => f.tipo === 'costo')?.total || 0);

  // Desglose por categoría (Alquiler, Salarios, Publicidad/Meta Ads, etc.) —
  // no existe un concepto fijo de "gasto de Meta Ads" en el sistema: si el
  // usuario carga su gasto publicitario como CostoGasto con esa categoría,
  // este desglose es lo que lo saca a la luz en el dashboard.
  const filasCategoria = await CostoGasto.findAll({
    where: { usuario_id, activo: true, envio_id: null, fecha: { [Op.between]: [desde, hasta] } },
    attributes: [[fn('SUM', col('importe')), 'total']],
    include: [{ model: CategoriaCostoGasto, as: 'categoria', attributes: ['nombre'] }],
    group: ['categoria.id', 'categoria.nombre'],
    raw: true,
  });
  const porCategoria = filasCategoria
    .map(f => ({ categoria: f['categoria.nombre'] || 'Sin categoría', total: Number(f.total || 0) }))
    .sort((a, b) => b.total - a.total);

  return { gastos_operativos: gastos, costos_operativos_adicionales: costosAdicionales, total: gastos + costosAdicionales, por_categoria: porCategoria };
}

/**
 * Mercadería perdida de UN EnvioItem, valorizada a lo que costó cuando se
 * vendió (el snapshot de EnvioItemComponente, nunca el precio_costo actual
 * del producto: eso cambiaría el pasado cada vez que se ajusta un costo).
 *
 * Solo cuenta lo que quedó registrado como perdido o devuelto DAÑADO. Dos
 * cosas que a propósito NO son pérdida:
 *  - `cantidad_devuelta_vendible`: vuelve al stock, se puede vender de nuevo.
 *  - que el pedido esté en estado "Perdido": el estado no implica que toda
 *    su mercadería se haya perdido, solo cuenta lo efectivamente registrado.
 *
 * Función aparte para poder probarla sin base de datos (ver los casos de
 * devolución vendible / dañada / pérdida en scripts/verificar-perdidas.js).
 */
function perdidaDeItem(item) {
  let unidades = 0;
  let importe = 0;
  for (const comp of item.componentes_vendidos || []) {
    const perdidas = (comp.cantidad_perdida || 0) + (comp.cantidad_devuelta_danada || 0);
    if (perdidas <= 0) continue;
    unidades += perdidas;
    importe += perdidas * (Number(comp.costo_unitario) || 0);
  }
  return { unidades, importe };
}

// 3. Ranking de Productos (¿Qué se vende, confirma y devuelve más?)
function getProductosAnalytics(envios) {

  const mapProds = {};

  for (const e of envios) {
    const st = (e.estado || '').toLowerCase();
    const isConfirmado = ['confirmado', 'preparado', 'despachado', 'reprogramado', 'entregado', 'devuelto', 'perdido'].includes(st);
    const isEntregado = st === 'entregado';
    const isDevuelto = ['devuelto', 'no entregado', 'fallido'].includes(st);
    const canal = (e.origen || 'WEB').toUpperCase();

    // Reparto del monto REAL del pedido entre sus líneas.
    //
    // `monto` manda sobre la suma de los subtotales: es lo que el cliente
    // efectivamente pagó, y es lo que suma `facturacion_entregada`. Los dos
    // números se despegan por dos motivos reales:
    //   - un cupón descuenta a nivel PEDIDO y no toca `EnvioItem.subtotal`;
    //   - al cerrar la venta se puede ajustar el monto (ej. cobrarle el
    //     envío al cliente), y eso tampoco baja a las líneas.
    // Sumando subtotales, "Más Vendidos" facturaba Gs 1.183.000 mientras
    // "Facturación Real" decía Gs 1.044.000 — el mismo período, dos cifras.
    // Repartiendo el monto, la tabla de productos cierra siempre con el KPI.
    let facturacionPorItem = null;
    let costoDirectoPorItem = null;
    if (isEntregado && e.items && e.items.length > 0) {
      const subtotales = e.items.map(it => Number(it.subtotal || (it.precio_unitario * (it.cantidad || 1)) || 0));
      const sumaSub = subtotales.reduce((a, b) => a + b, 0);
      const montoPedido = Number(e.monto || 0);
      facturacionPorItem = sumaSub > 0
        ? subtotales.map(s => Math.round((s / sumaSub) * montoPedido))
        // Sin precios en las líneas no hay proporción que aplicar: se reparte
        // en partes iguales antes que descartar la facturación del pedido.
        : e.items.map(() => Math.round(montoPedido / e.items.length));

      // El redondeo no puede despegar la suma por producto del monto del
      // pedido: el resto va a la línea más grande (mismo criterio que el
      // prorrateo de costos comunes de más abajo).
      const resto = montoPedido - facturacionPorItem.reduce((a, b) => a + b, 0);
      if (resto !== 0) {
        let mayor = 0;
        for (let i = 1; i < subtotales.length; i++) if (subtotales[i] > subtotales[mayor]) mayor = i;
        facturacionPorItem[mayor] += resto;
      }

      // Costos que son DE ESTE PEDIDO: el envío que se pagó por él, su
      // comisión y su IVA. Se reparten entre SUS propios ítems, no en la
      // bolsa común del final.
      //
      // Antes iban todos a un pool global que se repartía por unidades entre
      // todos los productos del período. Eso hacía que un producto cargara
      // el envío de otro: un pedido con Gs 50.000 de flete y otro con Gs
      // 30.000 terminaban pagando Gs 40.000 cada uno. La información de a
      // qué pedido pertenecía cada costo existe — promediarla era perderla.
      const comisionPedido = montoPedido * (Number(e.comision_pct_aplicada || 0) / 100);
      const ivaPedido = e.quiere_factura ? montoPedido * 0.10 : 0;
      const costoDelPedido = Number(e.costo_envio || 0) + comisionPedido + ivaPedido;
      if (costoDelPedido > 0) {
        const base = facturacionPorItem.reduce((a, b) => a + b, 0);
        costoDirectoPorItem = base > 0
          ? facturacionPorItem.map(f => Math.round((f / base) * costoDelPedido))
          : e.items.map(() => Math.round(costoDelPedido / e.items.length));
        const restoCosto = Math.round(costoDelPedido) - costoDirectoPorItem.reduce((a, b) => a + b, 0);
        if (restoCosto !== 0) {
          let mayor = 0;
          for (let i = 1; i < subtotales.length; i++) if (subtotales[i] > subtotales[mayor]) mayor = i;
          costoDirectoPorItem[mayor] += restoCosto;
        }
      }
    }

    if (e.items && e.items.length > 0) {
      for (let idxItem = 0; idxItem < e.items.length; idxItem++) {
        const item = e.items[idxItem];
        const key = item.producto_id ? `p_${item.producto_id}` : `name_${item.nombre_producto}`;
        if (!mapProds[key]) {
          mapProds[key] = {
            producto_id: item.producto_id || null,
            nombre: item.nombre_producto || (item.Producto ? item.Producto.nombre : 'Producto'),
            sku: item.Producto ? item.Producto.sku : null,
            total_pedidos: 0,
            unidades_totales: 0,
            // Unidades de pedidos ENTREGADOS. `unidades_totales` cuenta las
            // de todos los pedidos (pendientes y cancelados incluidos), así
            // que no es comparable con facturacion_total/costo_total, que
            // solo suman entregados. "Cuántas vendí de verdad" es esta.
            unidades_entregadas: 0,
            confirmados: 0,
            entregados: 0,
            devueltos: 0,
            facturacion_total: 0,
            costo_total: 0,
            // Envío, comisión e IVA de los pedidos donde se vendió este
            // producto. Atribuido, no promediado (ver arriba).
            costo_directo_pedido: 0,
            unidades_perdidas: 0,
            perdida: 0,
            canales: { WEB: 0, WHATSAPP: 0, OTROS: 0 }
          };
        }

        const p = mapProds[key];
        p.total_pedidos += 1;
        p.unidades_totales += (item.cantidad || 1);
        if (isConfirmado) p.confirmados += 1;
        if (isEntregado) {
          p.entregados += 1;
          p.unidades_entregadas += (item.cantidad || 1);
          p.facturacion_total += facturacionPorItem ? facturacionPorItem[idxItem] : 0;
          p.costo_directo_pedido += costoDirectoPorItem ? costoDirectoPorItem[idxItem] : 0;
          p.costo_total += costoDeItem(item);
        }
        if (isDevuelto) p.devueltos += 1;

        // Pérdida de mercadería — FUERA del `if (isEntregado)` a propósito:
        // un pedido que se perdió o se devolvió dañado nunca llega a
        // "Entregado", y su mercadería igual salió del stock y se pagó. Si
        // se contara solo en entregados, un producto perdido saldría gratis.
        const { unidades: unidadesPerdidas, importe } = perdidaDeItem(item);
        p.unidades_perdidas += unidadesPerdidas;
        p.perdida += importe;

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

// 3b. Desglose de Ventas por Oferta dentro de cada Producto
// (ej. "de las 300 unidades vendidas de Earplugs, 38% fueron pack x3")
function getOfertasAnalytics(envios) {

  const mapProductos = {};

  for (const e of envios) {
    const st = (e.estado || '').toLowerCase();
    if (st !== 'entregado') continue;

    for (const item of e.items || []) {
      if (!item.producto_id) continue;

      if (!mapProductos[item.producto_id]) {
        mapProductos[item.producto_id] = {
          producto_id: item.producto_id,
          producto_nombre: item.Producto ? item.Producto.nombre : item.nombre_producto,
          unidades_totales: 0,
          ofertas: {},
        };
      }
      const p = mapProductos[item.producto_id];
      const cantidad = item.cantidad || 1;
      p.unidades_totales += cantidad;

      const clave = item.oferta_codigo || '__individual__';
      if (!p.ofertas[clave]) {
        p.ofertas[clave] = {
          oferta_codigo: item.oferta_codigo || null,
          oferta_nombre: item.oferta_nombre || 'Individual',
          unidades: 0,
          facturacion: 0,
        };
      }
      p.ofertas[clave].unidades += cantidad;
      p.ofertas[clave].facturacion += Number(item.subtotal || 0);
    }
  }

  return Object.values(mapProductos)
    .map(p => ({
      producto_id: p.producto_id,
      producto_nombre: p.producto_nombre,
      unidades_totales: p.unidades_totales,
      ofertas: Object.values(p.ofertas)
        .map(o => ({
          ...o,
          pct_unidades: p.unidades_totales > 0 ? Number(((o.unidades / p.unidades_totales) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.unidades - a.unidades),
    }))
    .sort((a, b) => b.unidades_totales - a.unidades_totales);
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
    const isConfirmado = ['confirmado', 'preparado', 'despachado', 'reprogramado', 'entregado', 'devuelto', 'perdido'].includes(st);
    const isCancelado = st === 'cancelado';
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
        perdidos: 0,
        cancelados: 0,
        pendientes: 0,
        monto_recaudado: 0,
        costo_fletes: 0,
      };
    }

    const c = mapCouriers[key];
    c.total_asignados += 1;
    c.costo_fletes += Number(e.costo_envio || 0);

    const st = (e.estado || '').toLowerCase();
    if (st === 'entregado') {
      c.entregados += 1;
      c.monto_recaudado += Number(e.monto || 0);
    } else if (['despachado', 'reprogramado'].includes(st)) {
      c.en_transito += 1;
    } else if (['devuelto', 'no entregado', 'fallido'].includes(st)) {
      c.devueltos += 1;
    } else if (st === 'perdido') {
      c.perdidos = (c.perdidos || 0) + 1;
    } else if (['cancelado', 'rechazado'].includes(st)) {
      c.cancelados = (c.cancelados || 0) + 1;
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

// 6. Timeline de Tendencias (Sparklines) — incluye costo/ganancia por día
// para el gráfico de "Evolución de Ventas" del dashboard: mismo cálculo de
// costo por pedido que ya usa getKpisFinancieros (costo_envio + costo de
// mercadería vía costoDeItem + comisión + IVA estimado), solo que acumulado
// día por día en vez de para todo el período.
async function getTimelineTendencias(whereBase, fechaDesde, fechaHasta) {
  const envios = await Envio.findAll({
    where: whereBase,
    attributes: ['id', 'fecha', 'dispatchedAt', 'estado', 'monto', 'costo_envio', 'comision_pct_aplicada', 'quiere_factura'],
    include: [
      {
        model: EnvioItem,
        as: 'items',
        include: [
          { model: Producto, attributes: ['id', 'precio_costo', 'precio_base'] },
          { model: EnvioItemComponente, as: 'componentes_vendidos', attributes: ['cantidad', 'costo_unitario'] },
        ],
      }
    ]
  });

  const mapTimeline = {};

  for (const e of envios) {
    const f = e.dispatchedAt || e.fecha;
    if (!f) continue;

    if (!mapTimeline[f]) {
      mapTimeline[f] = { fecha: f, pedidos: 0, confirmados: 0, entregados: 0, devueltos: 0, perdidos: 0, cancelados: 0, monto: 0, costo: 0, ganancia: 0 };
    }

    const t = mapTimeline[f];
    t.pedidos += 1;

    const st = (e.estado || '').toLowerCase();
    if (['confirmado', 'preparado', 'despachado', 'reprogramado', 'entregado', 'devuelto', 'perdido'].includes(st)) t.confirmados += 1;
    if (st === 'entregado') {
      t.entregados += 1;
      const monto = Number(e.monto || 0);
      const comisionPct = Number(e.comision_pct_aplicada || 0);
      const costoComision = monto * (comisionPct / 100);
      const iva = e.quiere_factura ? monto * 0.10 : 0;
      let costoMercaderia = 0;
      if (e.items && e.items.length > 0) {
        for (const item of e.items) costoMercaderia += costoDeItem(item);
      }
      const costoOrden = Number(e.costo_envio || 0) + costoMercaderia + costoComision + iva;

      t.monto += monto;
      t.costo += costoOrden;
      t.ganancia += monto - costoOrden;
    }
    if (['devuelto', 'no entregado', 'fallido'].includes(st)) t.devueltos += 1;
    if (st === 'perdido') t.perdidos += 1;
    if (['cancelado', 'rechazado'].includes(st)) t.cancelados += 1;
  }

  // Ordenar cronológicamente
  const timeline = Object.values(mapTimeline)
    .map(t => ({ ...t, costo: Math.round(t.costo), ganancia: Math.round(t.ganancia) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  return timeline;
}

// 6b. Pagos Online — cuenta transacciones realmente cobradas (Pagopar u otro
// gateway configurado), respetando los mismos filtros activos (fecha,
// producto, origen, etc.) que el resto del dashboard.
async function getPagosOnlineAnalytics(whereBase) {
  const pagos = await PaymentTransaction.findAll({
    where: { status: 'PAID' },
    attributes: ['id', 'amount'],
    include: [{ model: Envio, as: 'envio', attributes: [], where: whereBase, required: true }],
    raw: true,
  });

  return {
    pagos_realizados: pagos.length,
    monto_pagado: pagos.reduce((acc, p) => acc + Number(p.amount || 0), 0),
  };
}

// Filtros dinámicos: el frontend no hardcodea listas, las pide acá. Mismo
// patrón que confirmadoresDisponiblesPromise más abajo.

// Productos con alguna actividad histórica del inquilino (para el <select>
// del filtro por producto) — sin acotar por rango de fechas, igual que ya
// hace confirmadoresDisponiblesPromise, para que la lista no "desaparezca"
// productos al cambiar de período.
async function getProductosDisponibles(usuario_id) {
  const filas = await EnvioItem.findAll({
    attributes: [[fn('DISTINCT', col('EnvioItem.producto_id')), 'producto_id']],
    where: { producto_id: { [Op.ne]: null } },
    include: [{ model: Envio, attributes: [], where: { usuario_id }, required: true }],
    raw: true,
  });
  const ids = filas.map(f => f.producto_id).filter(Boolean);
  if (ids.length === 0) return [];

  const productos = await Producto.findAll({ where: { id: ids }, attributes: ['id', 'nombre'], raw: true });
  return productos
    .map(p => ({ producto_id: p.id, nombre: p.nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Caché en memoria de los CATÁLOGOS del dashboard (años, productos, landings,
 * canales, confirmadores, tienda).
 *
 * Estas listas no dependen del período ni de ningún filtro: son "qué existe
 * en tu cuenta". Sin caché se volvían a consultar en CADA clic de filtro —
 * media docena de viajes a la base por interacción, que contra una base
 * remota (~230 ms por viaje) es la mayor parte del tiempo de espera.
 *
 * Se guarda la PROMESA, no el valor: dos pedidos simultáneos comparten la
 * misma consulta en vez de disparar dos.
 *
 * TTL corto a propósito: si el usuario crea una landing o carga un producto,
 * tiene que verlo aparecer enseguida. 30 s es el techo de esa espera.
 * Un error no se cachea, para no dejar el dashboard roto medio minuto.
 */
const CATALOGO_TTL_MS = 30000;
const CATALOGO_MAX_CLAVES = 500;
const cacheCatalogos = new Map();

function catalogoCacheado(clave, cargar) {
  const ahora = Date.now();
  const guardado = cacheCatalogos.get(clave);
  if (guardado && guardado.expira > ahora) return guardado.valor;

  // Poda perezosa: sin esto el Map crece con cada usuario que entra y nunca
  // se vacía (una fuga lenta en un proceso que vive días).
  if (cacheCatalogos.size > CATALOGO_MAX_CLAVES) {
    for (const [k, v] of cacheCatalogos) if (v.expira <= ahora) cacheCatalogos.delete(k);
  }

  const valor = Promise.resolve().then(cargar);
  cacheCatalogos.set(clave, { expira: ahora + CATALOGO_TTL_MS, valor });
  valor.catch(() => cacheCatalogos.delete(clave));
  return valor;
}

/** Para tests y para el día que haga falta invalidar a mano. */
exports.limpiarCacheCatalogos = () => cacheCatalogos.clear();

/**
 * Ranking de landings por facturación entregada, con su tráfico al lado.
 *
 * Responde "¿cuál de mis páginas vende más?", que es la pregunta que la
 * atribución por landing (Envio.landing_id) habilita por primera vez.
 *
 * DOS FUENTES, a propósito: los pedidos salen de `envios` y las visitas de
 * `landing_eventos`. Por eso el universo se siembra con las dos — una landing
 * con visitas y cero ventas TIENE que aparecer (con 0% de conversión): es
 * exactamente el caso que hay que detectar, y si solo se listaran las que
 * vendieron, esa página quedaría invisible.
 *
 * La ganancia usa la MISMA fórmula que margen_bruto_estimado de
 * getKpisFinancieros (facturación − mercadería − envío − comisión − IVA) pero
 * NO descuenta gastos operativos: son del negocio entero y repartirlos entre
 * landings sería un prorrateo inventado. La columna se rotula como ganancia
 * antes de gastos fijos para que no se confunda con la Utilidad Neta.
 *
 * Los pedidos sin landing (carga manual, WhatsApp, y todo lo anterior a
 * Envio.landing_id) quedan fuera: no son una landing y encabezarían el
 * ranking sin querer decir nada.
 */
async function getRankingLandings(whereRanking, desde, hasta, landingsTienda, limite = 5) {
  // La consulta de pedidos y la lista de landings no dependen una de la otra:
  // arrancan juntas. Contra una base remota cada `await` suelto cuesta un
  // viaje completo (~230 ms medidos por el túnel), así que encadenarlas de
  // más es lo que hace lento al dashboard, no el tamaño de los datos.
  const landings = landingsTienda || [];
  const idsTienda = landings.map(l => l.id);
  const [envios, visitas] = await Promise.all([
    Envio.findAll({
    where: whereRanking,
    attributes: ['id', 'landing_id', 'estado', 'monto', 'costo_envio', 'comision_pct_aplicada', 'quiere_factura'],
    include: [{
      model: EnvioItem,
      as: 'items',
      attributes: ['id', 'cantidad'],
      include: [
        { model: Producto, attributes: ['id', 'precio_costo', 'precio_base'] },
        { model: EnvioItemComponente, as: 'componentes_vendidos', attributes: ['cantidad', 'costo_unitario'] },
      ],
    }],
    }),
    // Visitas del período por landing. Se piden para TODAS las páginas de la
    // tienda, no solo las que vendieron: una landing con tráfico y cero
    // ventas tiene que aparecer en el ranking.
    idsTienda.length
      ? LandingEvento.findAll({
          where: {
            landing_id: { [Op.in]: idsTienda },
            tipo_evento: 'visita',
            created_at: { [Op.between]: [new Date(`${desde}T00:00:00`), new Date(`${hasta}T23:59:59.999`)] },
          },
          attributes: ['landing_id', [fn('COUNT', col('id')), 'visitas']],
          group: ['landing_id'],
          raw: true,
        })
      : Promise.resolve([]),
  ]);

  const filaVacia = (landing_id) => ({
    landing_id,
    nombre: null,
    slug: null,
    visitas: 0,
    pedidos: 0,
    entregados: 0,
    facturacion: 0,
    costo: 0,
    ganancia: 0,
    conversion: 0,
    ticket_promedio: 0,
  });
  const porLanding = new Map();
  const fila = (id) => {
    if (!porLanding.has(id)) porLanding.set(id, filaVacia(id));
    return porLanding.get(id);
  };

  for (const e of envios) {
    const f = fila(e.landing_id);
    f.pedidos++;
    if ((e.estado || '').toLowerCase() !== 'entregado') continue;

    const monto = Number(e.monto || 0);
    f.entregados++;
    f.facturacion += monto;
    f.costo += Number(e.costo_envio || 0);
    f.costo += monto * (Number(e.comision_pct_aplicada || 0) / 100);
    if (e.quiere_factura) f.costo += monto * 0.10;
    for (const item of e.items || []) f.costo += costoDeItem(item);
  }

  for (const v of visitas) fila(v.landing_id).visitas = Number(v.visitas) || 0;

  if (porLanding.size === 0) {
    return { top: [], totales: { landings: 0, visitas: 0, pedidos: 0, entregados: 0, facturacion: 0, ganancia: 0, conversion: 0 }, total_landings: 0 };
  }

  // Los nombres salen de la lista que ya se trajo: pedirlos de nuevo era una
  // ida y vuelta entera para datos que estaban en memoria.
  const nombrePorId = new Map(landings.map(l => [l.id, l]));

  const filas = [...porLanding.values()].map(f => {
    const meta = nombrePorId.get(f.landing_id);
    return {
      ...f,
      nombre: meta ? meta.nombre : `Landing #${f.landing_id}`,
      slug: meta ? meta.slug : null,
      costo: Math.round(f.costo),
      ganancia: Math.round(f.facturacion - f.costo),
      // Conversión = ventas entregadas sobre visitas. Sin visitas registradas
      // se devuelve 0 y el frontend muestra un guion: no es 0% de conversión,
      // es que no hay con qué calcularla.
      conversion: f.visitas > 0 ? Number(((f.entregados / f.visitas) * 100).toFixed(1)) : 0,
      ticket_promedio: f.entregados > 0 ? Math.round(f.facturacion / f.entregados) : 0,
    };
  });

  const totales = filas.reduce((acc, f) => ({
    landings: acc.landings + 1,
    visitas: acc.visitas + f.visitas,
    pedidos: acc.pedidos + f.pedidos,
    entregados: acc.entregados + f.entregados,
    facturacion: acc.facturacion + f.facturacion,
    ganancia: acc.ganancia + f.ganancia,
  }), { landings: 0, visitas: 0, pedidos: 0, entregados: 0, facturacion: 0, ganancia: 0 });
  totales.conversion = totales.visitas > 0 ? Number(((totales.entregados / totales.visitas) * 100).toFixed(1)) : 0;

  // Ordenado por facturación: "las que más venden". El desempate por visitas
  // deja arriba a la que al menos trajo gente cuando ninguna vendió todavía.
  filas.sort((a, b) => (b.facturacion - a.facturacion) || (b.visitas - a.visitas));

  return { top: filas.slice(0, limite), totales, total_landings: filas.length };
}

/**
 * Tiendas (landings de tipo 'inicio') del inquilino, para el selector de
 * landing del dashboard. Mismo criterio que el resto de los filtros: la
 * lista sale de la base, el frontend solo la renderiza.
 *
 * Solo 'inicio': una landing de tipo catálogo/contacto es una página más de
 * la misma tienda, no una tienda aparte, y los funnels quedan fuera a
 * pedido del usuario (se van a retirar). El tráfico y las ventas de todas
 * ellas siguen sumando en la opción "Todas", que no filtra nada.
 */
function getLandingsDisponibles(landingsTienda) {
  return (landingsTienda || []).filter(l => l.tipo_pagina === 'inicio').map(l => ({
    landing_id: l.id,
    nombre: l.nombre,
    slug: l.slug,
    publicada: Boolean(l.activo),
    es_home: Boolean(l.es_home),
  }));
}

// Años con al menos un pedido, para el <select> de año del filtro "Por mes".
// `fecha` es un STRING (no DATE) en el modelo Envio, así que el año se saca
// en JS a partir de dispatchedAt/fecha en vez de un EXTRACT() en SQL.
async function getAniosDisponibles(usuario_id) {
  // El DISTINCT lo hace Postgres. Antes esto traía TODAS las filas de pedidos
  // del usuario a memoria solo para leerles el año: con pocos pedidos no se
  // nota, con decenas de miles es una consulta que crece para siempre.
  //
  // `fecha` es varchar 'YYYY-MM-DD': se le toma el prefijo de 4 dígitos en
  // vez de castearla a date, para que una fila con basura no reviente la
  // consulta entera (la versión anterior toleraba eso y hay que mantenerlo).
  const filas = await sequelize.query(
    `SELECT DISTINCT COALESCE(
              EXTRACT(YEAR FROM "dispatchedAt")::int,
              substring("fecha" from '^[0-9]{4}')::int
            ) AS anio
       FROM "envios"
      WHERE "usuario_id" = :usuario_id`,
    { replacements: { usuario_id }, type: sequelize.QueryTypes.SELECT }
  );

  const anios = new Set([new Date().getFullYear()]);
  for (const f of filas) {
    const anio = Number(f.anio);
    if (Number.isFinite(anio) && anio > 0) anios.add(anio);
  }
  return [...anios].sort((a, b) => b - a);
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
// Se exporta para poder verificar la regla de pérdida sin base de datos.
exports.perdidaDeItem = perdidaDeItem;

exports.getAnalyticsCompleto = async (filtros = {}, usuario_id, inquilino_id = null) => {
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
  if (filtros.canal_venta_id && filtros.canal_venta_id !== 'TODOS') {
    whereBase.canal_venta_id = filtros.canal_venta_id;
  }
  if (filtros.campana) {
    whereBase.campaign_name = filtros.campana;
  }

  // Filtro por producto: se resuelve a nivel de PEDIDO completo (no de línea
  // de ítem) — un pedido que combina el producto filtrado con otro sigue
  // entrando entero, porque costo de envío/comisión/IVA son del pedido y no
  // se pueden partir de forma confiable por línea.
  if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
    const enviosConProducto = await Envio.findAll({
      where: whereBase,
      attributes: ['id'],
      include: [{ model: EnvioItem, as: 'items', attributes: [], where: { producto_id: filtros.producto_id }, required: true }],
      raw: true,
    });
    whereBase.id = { [Op.in]: enviosConProducto.length > 0 ? enviosConProducto.map(e => e.id) : [-1] };
  }

  // El ranking de landings se congela ACÁ, antes de aplicar el filtro de
  // landing: una comparativa de "cuál vende más" con una sola landing
  // seleccionada no compara nada. Respeta fecha y producto, ignora el tab.
  const whereRanking = { ...whereBase, landing_id: { [Op.ne]: null } };

  // Filtro por landing. 'SIN_LANDING' es su propio valor y no un "sin filtro":
  // agrupa los pedidos cargados a mano y los anteriores a Envio.landing_id,
  // que no se pueden atribuir a ninguna página (ver migrar-landing-id-envios).
  if (filtros.landing_id && filtros.landing_id !== 'TODAS') {
    whereBase.landing_id = filtros.landing_id === 'SIN_LANDING' ? null : filtros.landing_id;
  }


  // Las landings de la tienda se traen UNA vez y se reparten: las usan el
  // ranking (nombres + universo de visitas) y el selector del dashboard.
  // Antes cada uno hacía su propia consulta, encadenadas: tres viajes para
  // los mismos datos. La promesa arranca acá y se resuelve dentro de la ola
  // grande de abajo, sin agregar una ola propia.
  const landingsTiendaPromise = catalogoCacheado(`landings:${usuario_id}`, () => Landing.findAll({
    where: { tienda_id: { [Op.in]: literal(`(SELECT id FROM tiendas WHERE usuario_id = ${Number(usuario_id)})`) } },
    attributes: ['id', 'nombre', 'slug', 'activo', 'es_home', 'tipo_pagina'],
    order: [['created_at', 'ASC']],
    raw: true,
  }));

  // Catálogo de canales del tenant y tienda del usuario: ninguno depende del
  // otro, así que van en la MISMA ida y vuelta. Encadenar dos `await` sueltos
  // acá costaba ~460 ms contra la base remota, antes de que arrancara
  // cualquier consulta útil (medido: dos olas de ~230 ms).
  const [canalesCatalogo, tiendaDelUsuario] = await Promise.all([
    catalogoCacheado(`canales:${inquilino_id ?? 'base'}`, () => CanalVenta.findAll({
      where: { activo: true, [Op.or]: [{ inquilino_id: null }, { inquilino_id: inquilino_id ?? null }] },
      attributes: ['id', 'nombre', 'slug'],
      order: [['orden', 'ASC'], ['nombre', 'ASC']],
      raw: true,
    })),
    catalogoCacheado(`tienda:${usuario_id}`, () => Tienda.findOne({ where: { usuario_id }, attributes: ['id'], raw: true })),
  ]);
  const tiendaId = tiendaDelUsuario ? tiendaDelUsuario.id : null;


  // Lista de confirmadores únicos disponibles en el inquilino
  const confirmadoresDisponiblesPromise = catalogoCacheado(`confirmadores:${usuario_id}`, () => Envio.findAll({
    where: { usuario_id, confirmador: { [Op.ne]: null } },
    attributes: [[fn('DISTINCT', col('confirmador')), 'confirmador']],
    raw: true,
  }));

  // Una sola lectura de pedidos+ítems, compartida por los tres análisis que
  // la usan. Arranca acá para entrar en la misma ola que el resto.
  const enviosConItemsPromise = getEnviosConItems(whereBase);

  // Ejecución en paralelo con Promise.all()
  const [
    funnel,
    kpisFinancieros,
    rankingProductos,
    ofertasAnalytics,
    confirmadores,
    couriers,
    tendencias,
    rawConf,
    gastosOperativos,
    pagosOnline,
    productosDisponibles,
    aniosDisponibles,
    landingsDisponibles,
    rankingLandings,
  ] = await Promise.all([
    getResumenFunnel(whereBase, canalesCatalogo),
    enviosConItemsPromise.then(getKpisFinancieros),
    enviosConItemsPromise.then(getProductosAnalytics),
    enviosConItemsPromise.then(getOfertasAnalytics),
    getConfirmadoresAnalytics(whereBase),
    getCouriersAnalytics(whereBase, usuario_id),
    getTimelineTendencias(whereBase, desde, hasta),
    confirmadoresDisponiblesPromise,
    getGastosOperativos(usuario_id, desde, hasta),
    getPagosOnlineAnalytics(whereBase),
    catalogoCacheado(`productos:${usuario_id}`, () => getProductosDisponibles(usuario_id)),
    catalogoCacheado(`anios:${usuario_id}`, () => getAniosDisponibles(usuario_id)),
    landingsTiendaPromise.then(getLandingsDisponibles),
    landingsTiendaPromise.then(ls => getRankingLandings(whereRanking, desde, hasta, ls)),
  ]);

  // Prorrateo por producto — por UNIDADES ENTREGADAS, igual que la planilla
  // del comercio (ej. Gs 2.500.000 repartidos entre 130/32/26 unidades
  // sobre un total de 188). Se reparte TODO lo que no está ya atribuido a
  // un producto: envíos, comisión, IVA y los gastos operativos (Meta/Ads +
  // costos fijos).
  // Solo los GASTOS FIJOS se prorratean: alquiler, sueldos, publicidad. Esos
  // no pertenecen a ningún pedido y no hay forma de atribuirlos sin repartir.
  //
  // El envío, la comisión y el IVA YA fueron atribuidos al producto que los
  // generó, dentro de getProductosAnalytics (costo_directo_pedido). Volver a
  // meterlos acá los contaría dos veces.
  const costosAProrratear = gastosOperativos.total;

  const unidadesTotales = rankingProductos.reduce((acc, p) => acc + p.unidades_entregadas, 0);
  let repartido = 0;
  let idxMayor = -1;
  rankingProductos.forEach((p, i) => {
    const pctUnidades = unidadesTotales > 0 ? p.unidades_entregadas / unidadesTotales : 0;
    p.costo_prorrateado = Math.round(costosAProrratear * pctUnidades);
    repartido += p.costo_prorrateado;
    if (idxMayor === -1 || p.unidades_entregadas > rankingProductos[idxMayor].unidades_entregadas) idxMayor = i;
  });

  // El redondeo por producto deja un resto de ±1 Gs: se lo lleva el
  // producto que más unidades vendió, así la suma de los prorrateos da
  // exacto y la tabla cierra en vez de descuadrar por unos guaraníes.
  if (idxMayor >= 0 && rankingProductos[idxMayor].unidades_entregadas > 0) {
    rankingProductos[idxMayor].costo_prorrateado += costosAProrratear - repartido;
  }

  // Contrato de la tabla de productos: venta / costo / ganancia / pérdida.
  // El prorrateo se absorbe dentro de `costo` y no sale al frontend — es
  // mecanismo de cálculo, no información de negocio (el comerciante quiere
  // saber cuánto ganó, no qué fracción de la publicidad le tocó).
  //
  // `perdida` va SEPARADA y no se descuenta del costo ni de la ganancia:
  // restarla otra vez sería contar dos veces la misma plata.
  for (const p of rankingProductos) {
    p.unidades = p.unidades_entregadas;
    p.venta = p.facturacion_total;
    p.costo = Math.round(p.costo_total + p.costo_directo_pedido + p.costo_prorrateado);
    p.ganancia = Math.round(p.venta - p.costo);
    p.perdida = Math.round(p.perdida);
    p.rentabilidad = p.venta > 0 ? Number(((p.ganancia / p.venta) * 100).toFixed(1)) : 0;

    // Se mantienen por compatibilidad con quien ya los consumía.
    p.utilidad_neta = p.ganancia;
    p.pct_rentabilidad = p.rentabilidad;

    // Interno: no forma parte del contrato visual.
    delete p.costo_prorrateado;
    delete p.costo_directo_pedido;
  }

  // Ganancia neta = margen bruto (ya neto de COGS/logística/comisión/IVA por
  // pedido) menos los costos y gastos operativos registrados en el módulo
  // Finanzas → Costos y Gastos (alquiler, salarios, publicidad, etc.).
  const gananciaNetaEstimada = kpisFinancieros.margen_bruto_estimado - gastosOperativos.total;
  const pctMargenNeto = kpisFinancieros.facturacion_entregada > 0
    ? Number(((gananciaNetaEstimada / kpisFinancieros.facturacion_entregada) * 100).toFixed(1))
    : 0;

  kpisFinancieros.gastos_operativos = Math.round(gastosOperativos.gastos_operativos);
  kpisFinancieros.costos_operativos_adicionales = Math.round(gastosOperativos.costos_operativos_adicionales);
  kpisFinancieros.gastos_por_categoria = gastosOperativos.por_categoria;
  kpisFinancieros.ganancia_neta_estimada = Math.round(gananciaNetaEstimada);
  kpisFinancieros.pct_margen_neto = pctMargenNeto;

  const smartInsights = getSmartInsights(funnel, kpisFinancieros, rankingProductos, confirmadores, couriers);
  const confirmadoresDisponibles = rawConf.map(r => r.confirmador).filter(Boolean);

  return {
    rango_fechas: { desde, hasta, periodo: filtros.periodo || 'este_mes' },
    funnel,
    kpis: kpisFinancieros,
    ranking_productos: rankingProductos,
    ofertas: ofertasAnalytics,
    confirmadores,
    couriers,
    tendencias,
    insights: smartInsights,
    confirmadores_disponibles: confirmadoresDisponibles,
    productos_disponibles: productosDisponibles,
    anios_disponibles: aniosDisponibles,
    landings_disponibles: landingsDisponibles,
    ranking_landings: rankingLandings,
    pagos_online: pagosOnline,
    // El catálogo va en la respuesta para que el frontend arme la tabla de
    // canales desde la base, sin hardcodear nombres ni orden.
    canales_disponibles: canalesCatalogo,
  };
};
