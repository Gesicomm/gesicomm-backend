'use strict';

const { Envio, EnvioItem, EnvioItemComponente, Courier, Producto, Usuario, CostoGasto, CategoriaCostoGasto, PaymentTransaction, CanalVenta, Landing, LandingEvento, Tienda, MetodoPago, MetaReporteFila, MetaCampanaInterna, MetaReporteImport } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../config/database');
const { resolverRangoFechas } = require('../utils/rangoFechas');
const MetaReportesService = require('./metaReportes.service');
const { desgloseDelivery } = require('../utils/desgloseDelivery');

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

/**
 * La regla del delivery vive en un solo lugar: la comparte con el motor de
 * rendicion (liquidacion.service.js), que tiene que llegar al mismo numero
 * sobre el mismo pedido. Ver src/utils/desgloseDelivery.js.
 */
const desgloseEnvio = desgloseDelivery;

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
      // Facturación Real = precio de venta del producto × unidades (nunca
      // el flete, esté o no adentro del monto cobrado). "Envíos" abajo es
      // SIEMPRE el costo completo pagado al courier
      // (`costoLogisticoEntregados`), sin excepciones — las dos líneas son
      // independientes, cada una su propia plata, sin repartos cruzados.
      facturacionEntregada += desgloseEnvio(e).venta_producto;
      costoLogisticoEntregados += costoEnvio;
      pedidosEntregadosCount++;

      // Comisión e IVA se calculan sobre el `monto` real del pedido, no sobre
      // la venta de producto: la pasarela y Hacienda cobran sobre lo que
      // efectivamente se facturó, flete incluido si estaba adentro.
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

  // Se resta el flete COMPLETO (costoLogisticoEntregados) siempre: el
  // courier cobra el total, lo haya cubierto el cliente o el negocio.
  // `facturacionEntregada` ya no lo lleva adentro (es puro precio de
  // producto), así que acá no hay pass-through que cancelar: si el
  // cliente pagó de más para cubrir el flete, esa plata no entra a esta
  // cuenta — el flete es siempre y únicamente un costo, en su propia línea.
  const margenBrutoEstimado = facturacionEntregada - costoMercaderiaEntregada - costoComisionTotal - ivaFacturadoTotal - costoLogisticoEntregados;
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
/**
 * Gasto de publicidad que YA está cargado en Ads & Campañas (los CSV
 * importados de Meta Ads Manager), para el período del dashboard.
 *
 * Existe porque el gasto de Meta no se carga a mano en Costos y Gastos: se
 * importa en su propio módulo. Antes el dashboard solo miraba CostoGasto y
 * la línea "Meta (ads)" quedaba en cero (o en lo poco que se hubiera
 * cargado a mano) aunque hubiera millones importados.
 *
 * PRORRATEO POR DÍAS: cada fila del CSV cubre un rango (el del export, que
 * puede ser de meses) y no trae apertura diaria. Se asume gasto uniforme y
 * se toma solo la parte de días que cae dentro del período consultado. Sin
 * esto, mirar "agosto" contaría entero un export de enero-agosto, y la suma
 * de los meses no daría el año.
 *
 * Se aplica el mismo multiplicador de IVA que la sección de Ads, para que
 * las dos pantallas muestren el mismo número.
 */
async function getGastoMetaAds(usuario_id, inquilino_id, desde, hasta) {
  if (!inquilino_id || !usuario_id) return { total: 0, sin_atribuir: 0, directo_por_producto: {} };

  const filas = await MetaReporteFila.findAll({
    // Solapamiento de rangos. Las filas sin fechas quedan afuera a
    // propósito: no se pueden atribuir a un período, y contarlas en todos
    // inflaría cada consulta.
    where: {
      inquilino_id,
      fecha_inicio: { [Op.ne]: null, [Op.lte]: hasta },
      fecha_fin: { [Op.ne]: null, [Op.gte]: desde },
    },
    attributes: ['fecha_inicio', 'fecha_fin', 'importe_gastado'],
    // La campaña dice a qué producto(s) pertenece este gasto (ver
    // MetaCampanaInterna.producto_ids). Sin esto, cada guaraní de Meta caía
    // en la bolsa general y se repartía por unidades entre TODOS los
    // productos — incluidos los que jamás tuvieron un peso invertido.
    include: [
      { model: MetaCampanaInterna, as: 'campana', attributes: ['producto_ids'] },
      // El reporte es por usuario: sin este filtro, el gasto de Ads de
      // CUALQUIER usuario del tenant se sumaba al dashboard de todos los
      // demás (bug real: una tienda recién creada, sin campañas propias,
      // mostraba utilidad negativa por el gasto de otra tienda).
      { model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true },
    ],
    raw: true,
  });

  const DIA_MS = 24 * 60 * 60 * 1000;
  const aMs = (ymd) => Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`);
  const diasInclusive = (iniMs, finMs) => Math.floor((finMs - iniMs) / DIA_MS) + 1;

  const desdeMs = aMs(desde);
  const hastaMs = aMs(hasta);
  let total = 0;
  let sinAtribuir = 0;
  const directoPorProducto = {};

  for (const f of filas) {
    const gasto = Number(f.importe_gastado) || 0;
    if (!gasto) continue;

    const iniMs = aMs(f.fecha_inicio);
    const finMs = aMs(f.fecha_fin);
    if (Number.isNaN(iniMs) || Number.isNaN(finMs) || finMs < iniMs) continue;

    const diasFila = diasInclusive(iniMs, finMs);
    const diasSolapados = diasInclusive(Math.max(iniMs, desdeMs), Math.min(finMs, hastaMs));
    if (diasSolapados <= 0) continue;

    const gastoDelPeriodo = gasto * (Math.min(diasSolapados, diasFila) / diasFila) * MetaReportesService.MULTIPLICADOR_IVA;
    total += gastoDelPeriodo;

    // Atribución directa: la campaña puede cubrir más de un producto (el
    // formulario de Ads & Campañas lo permite), y cada uno de esos
    // productos ve el 100% del gasto — no se parte entre ellos. Es la
    // misma regla que ya documentaba el modelo (MetaCampanaInterna): sirve
    // para responder "¿cuánto se invirtió en ads en ESTE producto?", no
    // para que la suma de todos los productos dé el gasto total de Meta.
    //
    // Sin campaña vinculada (hoy, la gran mayoría de las filas del CSV) el
    // gasto queda sin atribuir: no se le carga a ningún producto — solo
    // resta de la Ganancia Neta global, igual que antes.
    const productoIds = f['campana.producto_ids'];
    if (Array.isArray(productoIds) && productoIds.length > 0) {
      for (const pid of productoIds) {
        directoPorProducto[pid] = (directoPorProducto[pid] || 0) + gastoDelPeriodo;
      }
    } else {
      sinAtribuir += gastoDelPeriodo;
    }
  }

  return { total, sin_atribuir: sinAtribuir, directo_por_producto: directoPorProducto };
}

async function getGastosOperativos(usuario_id, desde, hasta, inquilino_id = null) {
  const whereGastos = {
    usuario_id,
    activo: true,
    envio_id: null,
    fecha: { [Op.between]: [desde, hasta] },
  };

  const filas = await CostoGasto.findAll({
    where: whereGastos,
    attributes: ['tipo', [fn('SUM', col('importe')), 'total']],
    group: ['tipo'],
    raw: true,
  });

  const gastos = Number(filas.find(f => f.tipo === 'gasto')?.total || 0);
  const costosAdicionales = Number(filas.find(f => f.tipo === 'costo')?.total || 0);

  // Apertura por DESTINO DE ATRIBUCIÓN, que no es lo mismo que por tipo.
  // De acá sale quién se hace cargo de cada guaraní en la tabla de productos:
  //
  //   producto_id con valor  -> directo, va entero a ESE producto. El usuario
  //                             ya dijo a quién pertenece; repartirlo entre
  //                             todos sería desarmar su decisión.
  //   clasificacion variable -> general variable (comisiones bancarias,
  //                             marketing sin producto puntual). SE
  //                             prorratea por unidades, igual que los fijos,
  //                             pero en su propia línea — no entra al punto
  //                             de equilibrio, que solo usa costos fijos.
  //   fijo o sin clasificar  -> gasto fijo general (alquiler, sueldos).
  //                             Se prorratea por unidades y es lo único que
  //                             alimenta el punto de equilibrio.
  //
  // Los NULL cuentan como fijos a propósito: hoy la clasificación es opcional
  // y está escondida en "Opciones avanzadas", así que la enorme mayoría de los
  // registros reales viene sin clasificar. Tratarlos como no-prorrateables
  // dejaría la línea de gastos de todos los productos en cero y la tabla
  // dejaría de cerrar con la Ganancia Neta. `sin_clasificar` se devuelve
  // aparte para que el frontend pueda empujar al usuario a completarlo.
  const filasAtribucion = await CostoGasto.findAll({
    where: whereGastos,
    attributes: ['producto_id', 'clasificacion', [fn('SUM', col('importe')), 'total']],
    group: ['producto_id', 'clasificacion'],
    raw: true,
  });

  let fijosGenerales = 0;
  let variablesGenerales = 0;
  let sinClasificar = 0;
  const directosPorProducto = {};
  for (const f of filasAtribucion) {
    const importe = Number(f.total || 0);
    if (f.producto_id) {
      directosPorProducto[f.producto_id] = (directosPorProducto[f.producto_id] || 0) + importe;
      continue;
    }
    if (f.clasificacion === 'variable') {
      variablesGenerales += importe;
    } else {
      fijosGenerales += importe;
      if (!f.clasificacion) sinClasificar += importe;
    }
  }

  // Desglose por categoría (Alquiler, Salarios, Publicidad/Meta Ads, etc.) —
  // no existe un concepto fijo de "gasto de Meta Ads" en el sistema: si el
  // usuario carga su gasto publicitario como CostoGasto con esa categoría,
  // este desglose es lo que lo saca a la luz en el dashboard.
  const filasCategoria = await CostoGasto.findAll({
    where: whereGastos,
    attributes: [[fn('SUM', col('importe')), 'total']],
    include: [{ model: CategoriaCostoGasto, as: 'categoria', attributes: ['nombre'] }],
    group: ['categoria.id', 'categoria.nombre'],
    raw: true,
  });
  const porCategoria = filasCategoria
    .map(f => ({ categoria: f['categoria.nombre'] || 'Sin categoría', total: Number(f.total || 0) }))
    .sort((a, b) => b.total - a.total);

  // El gasto de Meta NUNCA se prorratea a ciegas: si la fila vino de una
  // campaña con producto(s) asignado(s) (Ads & Campañas), va 100% directo a
  // esos productos (ver getGastoMetaAds); si no, queda sin atribuir — no hay
  // forma honesta de decidir a qué producto imputar un CSV que no vino de
  // una campaña propia. En ningún caso entra al punto de equilibrio.
  const metaAds = await getGastoMetaAds(usuario_id, inquilino_id, desde, hasta);

  return {
    gastos_operativos: gastos,
    costos_operativos_adicionales: costosAdicionales,
    meta_ads: metaAds.total,
    // total resta de la Ganancia Neta GLOBAL siempre completo, atribuido o
    // no: la plata se gastó igual. Lo que cambia con este reparto es solo
    // qué parte aparece en el costo de CADA producto.
    total: gastos + costosAdicionales + metaAds.total,
    por_categoria: porCategoria,
    fijos_generales: fijosGenerales,
    // Variable general SÍ se prorratea por unidades (misma mecánica que los
    // fijos, en su propia línea) — es plata real del período y no hay razón
    // para esconderla del costo del producto solo porque no está atada a
    // uno puntual. Lo único que NO se prorratea es el gasto de Meta sin
    // campaña vinculada (`meta_sin_atribuir`): ese sí queda fuera de la
    // tabla porque además de no tener producto, suele ser un importe muy
    // grande frente a la venta de un solo producto — prorratearlo lo
    // desfiguraría.
    variables_generales: variablesGenerales,
    // Plata real del período que NO se le carga a ningún producto: solo el
    // gasto de Meta de campañas sin vincular. Sigue restando de la Ganancia
    // Neta (ya está en `total`), pero no aparece en costo_detalle de
    // ninguna fila — por eso la suma de "Ganancia" de la tabla de productos
    // puede dar más alta que la Ganancia Neta de arriba: la diferencia es
    // exactamente este número.
    gastos_generales_sin_atribuir: metaAds.sin_atribuir,
    // {producto_id: monto} — 100% del gasto de Meta de cada campaña que
    // tiene a ese producto en su `producto_ids`, sin partir entre productos
    // aunque la campaña cubra varios (ver getGastoMetaAds).
    meta_directo_por_producto: metaAds.directo_por_producto,
    sin_clasificar: sinClasificar,
    directos_por_producto: directosPorProducto,
  };
}

/**
 * Unidades entregadas por producto en el período, SIN los filtros de la
 * pantalla (producto, confirmador, courier, canal, landing).
 *
 * Es el DENOMINADOR del prorrateo de gastos generales, y existe para que el
 * numerador y el denominador vivan en el mismo universo. Los gastos del
 * módulo Finanzas se consultan por usuario + período y no saben nada de los
 * filtros del dashboard; si el denominador sí los conoce, el reparto se
 * deforma. Filtrando por un producto, ese producto quedaba solo en el
 * ranking y absorbía el alquiler y los sueldos de TODO el mes: las mismas 8
 * unidades pasaban de Gs 1.000.000 a Gs 3.000.000 de "fijos" según si el
 * filtro estaba puesto o no, y la ganancia del producto se multiplicaba por
 * ocho sin que hubiera cambiado un solo dato.
 *
 * La clave de cada fila replica la de getProductosAnalytics (`p_<id>` para
 * los ítems con producto, `name_<nombre>` para los cargados a mano) para que
 * las dos vistas hablen del mismo producto.
 */
async function getUnidadesUniversoPeriodo(whereUniverso) {
  const filas = await EnvioItem.findAll({
    attributes: [
      'producto_id',
      'nombre_producto',
      // COALESCE(NULLIF(...)) replica el `item.cantidad || 1` de
      // getProductosAnalytics: una línea sin cantidad cuenta como una unidad
      // en las dos, si no el denominador quedaría más chico que el numerador.
      [fn('SUM', literal('COALESCE(NULLIF("EnvioItem"."cantidad", 0), 1)')), 'unidades'],
    ],
    include: [{
      model: Envio,
      attributes: [],
      required: true,
      where: { ...whereUniverso, estado: { [Op.iLike]: 'entregado' } },
    }],
    group: ['EnvioItem.producto_id', 'EnvioItem.nombre_producto'],
    raw: true,
  });

  const porClave = new Map();
  let total = 0;
  for (const f of filas) {
    const clave = f.producto_id ? `p_${f.producto_id}` : `name_${f.nombre_producto}`;
    const unidades = Number(f.unidades || 0);
    porClave.set(clave, (porClave.get(clave) || 0) + unidades);
    total += unidades;
  }
  return { porClave, total };
}

/** Misma clave que arma getProductosAnalytics, reconstruida desde el ranking. */
function claveProducto(p) {
  return p.producto_id ? `p_${p.producto_id}` : `name_${p.nombre}`;
}

/**
 * Mismos KPIs, pero del período INMEDIATAMENTE ANTERIOR y de la misma
 * duración: si mirás 7 días, compara contra los 7 días previos; si mirás
 * septiembre, contra agosto. Es lo que convierte "facturé Gs 335.138" en
 * "facturé Gs 335.138, un 12% más que el período pasado" — un número solo no
 * dice si el negocio va bien o mal.
 *
 * Cuando hay filtro por producto, el conjunto de pedidos del período actual
 * (whereBase.id) NO sirve para el anterior: son otros pedidos. Se vuelve a
 * resolver contra el rango viejo, si no la comparativa daría siempre cero.
 */
async function getComparativoPeriodo(whereBase, usuario_id, desde, hasta, productoId, inquilino_id = null) {
  const MS_DIA = 86400000;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const inicio = new Date(`${desde}T00:00:00`);
  const fin = new Date(`${hasta}T00:00:00`);
  const dias = Math.max(1, Math.round((fin - inicio) / MS_DIA) + 1);
  const prevHasta = new Date(inicio.getTime() - MS_DIA);
  const prevDesde = new Date(inicio.getTime() - dias * MS_DIA);
  const pDesde = ymd(prevDesde);
  const pHasta = ymd(prevHasta);

  const wherePrev = {
    ...whereBase,
    [Op.or]: [
      { dispatchedAt: { [Op.between]: [pDesde, pHasta] } },
      { fecha: { [Op.between]: [pDesde, pHasta] } },
    ],
  };
  delete wherePrev.id;

  if (productoId && productoId !== 'TODOS') {
    const conProducto = await Envio.findAll({
      where: wherePrev,
      attributes: ['id'],
      include: [{ model: EnvioItem, as: 'items', attributes: [], where: { producto_id: productoId }, required: true }],
      raw: true,
    });
    wherePrev.id = { [Op.in]: conProducto.length > 0 ? conProducto.map(e => e.id) : [-1] };
  }

  const [envios, gastos] = await Promise.all([
    getEnviosConItems(wherePrev),
    getGastosOperativos(usuario_id, pDesde, pHasta, inquilino_id),
  ]);

  const k = getKpisFinancieros(envios);
  const entregados = envios.filter(e => (e.estado || '').toLowerCase() === 'entregado').length;

  return {
    desde: pDesde,
    hasta: pHasta,
    facturacion_entregada: k.facturacion_entregada,
    ganancia_neta_estimada: Math.round(k.margen_bruto_estimado - gastos.total),
    pedidos_entregados: entregados,
    ticket_promedio: k.ticket_promedio,
  };
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
    let ventaProductoPorItem = null;
    let costoDirectoPorItem = null;
    let comisionPorItem = null;
    let ivaPorItem = null;
    let envioPorItem = null;
    if (isEntregado && e.items && e.items.length > 0) {
      const subtotales = e.items.map(it => Number(it.subtotal || (it.precio_unitario * (it.cantidad || 1)) || 0));
      const sumaSub = subtotales.reduce((a, b) => a + b, 0);
      // Se reparte el MONTO del pedido, igual que la tarjeta de Rentabilidad
      // y el gráfico: los tres tienen que contar la misma plata. Y el envío
      // completo entra como costo, también igual que los otros dos. Antes
      // esta tabla repartía solo la venta de producto y restaba solo el
      // flete "absorbido": daba la misma ganancia, pero con una venta y un
      // costo que no coincidían con los de las otras dos vistas.
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

      // Costos que son DE ESTE PEDIDO: su comisión, su IVA y la parte del
      // flete que puso el negocio. Se reparten entre SUS propios ítems, no
      // en la bolsa común del final.
      //
      // Antes iban todos a un pool global que se repartía por unidades entre
      // todos los productos del período. Eso hacía que un producto cargara
      // el costo de otro. La información de a qué pedido pertenecía cada
      // costo existe — promediarla era perderla.
      //
      // El flete entra COMPLETO: siempre se le paga al courier. Cuando el
      // cliente lo cubrió, esa plata ya está sumada arriba dentro del monto
      // repartido, así que se cancela sola y la ganancia no cambia.
      const montoFacturado = Number(e.monto || 0);
      const comisionPedido = montoFacturado * (Number(e.comision_pct_aplicada || 0) / 100);
      const ivaPedido = e.quiere_factura ? montoFacturado * 0.10 : 0;

      // Comisión e IVA se reparten POR SEPARADO, no como una bolsa "costo
      // directo": el tooltip del dashboard muestra el desglose renglón por
      // renglón, y de una suma ya hecha no se puede volver atrás.
      const repartir = (total) => {
        if (total <= 0) return e.items.map(() => 0);
        const base = facturacionPorItem.reduce((a, b) => a + b, 0);
        const trozos = base > 0
          ? facturacionPorItem.map(f => Math.round((f / base) * total))
          : e.items.map(() => Math.round(total / e.items.length));
        const resto = Math.round(total) - trozos.reduce((a, b) => a + b, 0);
        if (resto !== 0) {
          let mayor = 0;
          for (let i = 1; i < subtotales.length; i++) if (subtotales[i] > subtotales[mayor]) mayor = i;
          trozos[mayor] += resto;
        }
        return trozos;
      };
      comisionPorItem = repartir(comisionPedido);
      ivaPorItem = repartir(ivaPedido);
      envioPorItem = repartir(Number(e.costo_envio || 0));
      costoDirectoPorItem = comisionPorItem.map((c, i) => c + ivaPorItem[i] + envioPorItem[i]);
      // La venta SIN el flete que venía adentro del monto. No entra en la
      // cuenta de la ganancia — se guarda solo para que el Margen Bruto
      // siga midiendo el producto puro y no se infle con el envío.
      ventaProductoPorItem = repartir(desgloseEnvio(e).venta_producto);
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
            // Comisión e IVA de los pedidos donde se vendió este producto.
            // Atribuido, no promediado (ver arriba). El flete no está: lo
            // paga el cliente.
            costo_directo_pedido: 0,
            // Mismo importe, abierto por concepto, para que el dashboard
            // pueda mostrar de qué está hecho el Costo sin recalcular nada.
            costo_comision: 0,
            costo_iva: 0,
            // Envío de los pedidos de este producto, completo. Es costo, sin
            // vueltas: al courier se le paga siempre.
            costo_envio: 0,
            // La venta sin el flete que venía adentro del monto. Fuera de la
            // cuenta de la ganancia: solo alimenta el Margen Bruto, para que
            // ese número siga midiendo el producto y no el envío.
            venta_producto_total: 0,
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
          // "Venta" es precio de producto × cantidad, nunca el flete —
          // reutiliza el mismo reparto que ya se usaba para margen_bruto
          // (ventaProductoPorItem), no el del monto crudo (facturacionPorItem).
          p.facturacion_total += ventaProductoPorItem ? ventaProductoPorItem[idxItem] : 0;
          p.costo_directo_pedido += costoDirectoPorItem ? costoDirectoPorItem[idxItem] : 0;
          p.costo_comision += comisionPorItem ? comisionPorItem[idxItem] : 0;
          p.costo_iva += ivaPorItem ? ivaPorItem[idxItem] : 0;
          p.costo_envio += envioPorItem ? envioPorItem[idxItem] : 0;
          p.venta_producto_total += ventaProductoPorItem ? ventaProductoPorItem[idxItem] : 0;
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

  // `metodo_pago_id` + custodia y `cargo_perdida_courier` son lo que hace
  // falta para la rendición: sin saber quién tiene la plata cobrada, no se
  // puede decir si el courier te transfiere o vos le pagás.
  const envios = await Envio.findAll({
    where: whereBase,
    attributes: ['id', 'courier_id', 'estado', 'monto', 'costo_envio', 'cargo_perdida_courier', 'estado_financiero'],
    include: [{ model: MetodoPago, attributes: ['custodia_cobro'] }],
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
      dinero_en_su_poder: 0,
      cargos_perdida: 0,
      pendiente_liquidar: 0,
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
    dinero_en_su_poder: 0,
    cargos_perdida: 0,
    pendiente_liquidar: 0,
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
        dinero_en_su_poder: 0,
        cargos_perdida: 0,
        pendiente_liquidar: 0,
      };
    }

    const c = mapCouriers[key];
    c.total_asignados += 1;
    c.costo_fletes += Number(e.costo_envio || 0);
    c.cargos_perdida += Number(e.cargo_perdida_courier || 0);
    if (e.estado_financiero === 'pendiente_liquidacion') c.pendiente_liquidar += 1;

    const st = (e.estado || '').toLowerCase();
    if (st === 'entregado') {
      c.entregados += 1;
      c.monto_recaudado += Number(e.monto || 0);
      // Plata que quedó EN MANOS DEL COURIER: solo si el método de pago la
      // deja ahí (efectivo contra entrega con custodia 'courier'). Con POS o
      // transferencia el dinero entra directo al negocio y el courier no
      // tiene nada que rendir — misma regla que liquidacion.service.js, que
      // es el que emite la rendición formal.
      const custodia = e.MetodoPago ? e.MetodoPago.custodia_cobro : 'negocio';
      if (custodia === 'courier') c.dinero_en_su_poder += Number(e.monto || 0);
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

      // Saldo de rendición, MISMA fórmula que liquidacion.service.js:
      //   dinero que tiene él + cargos por pérdida − sus fletes
      // Positivo: te transfiere. Negativo: vos le pagás.
      // Es una previsualización del período elegido, no reemplaza a la
      // liquidación formal (que además marca los pedidos como liquidados).
      const saldo = c.dinero_en_su_poder + c.cargos_perdida - c.costo_fletes;

      return {
        ...c,
        tasa_entrega: tasaEntrega,
        tasa_devolucion: tasaDev,
        saldo_rendicion: Math.round(saldo),
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
        attributes: ['id', 'cantidad', 'producto_id'],
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
      mapTimeline[f] = { fecha: f, pedidos: 0, confirmados: 0, entregados: 0, devueltos: 0, perdidos: 0, cancelados: 0, monto: 0, costo: 0, ganancia: 0, gastos_fijos: 0 };
    }

    const t = mapTimeline[f];
    t.pedidos += 1;

    const st = (e.estado || '').toLowerCase();
    if (['confirmado', 'preparado', 'despachado', 'reprogramado', 'entregado', 'devuelto', 'perdido'].includes(st)) t.confirmados += 1;
    if (st === 'entregado') {
      t.entregados += 1;
      const monto = Number(e.monto || 0);
      const costoEnvioOrden = Number(e.costo_envio || 0);
      const comisionPct = Number(e.comision_pct_aplicada || 0);
      const costoComision = monto * (comisionPct / 100);
      const iva = e.quiere_factura ? monto * 0.10 : 0;
      let costoMercaderia = 0;
      if (e.items && e.items.length > 0) {
        for (const item of e.items) costoMercaderia += costoDeItem(item);
      }
      // MISMA fórmula que getKpisFinancieros: la venta del día es el `monto`
      // tal cual, y el costo resta el flete COMPLETO siempre — sin abrir
      // por quién lo pagó. Si las dos fórmulas se separan, el gráfico
      // dibuja una ganancia y la tarjeta muestra otra para el mismo período.
      const costoOrden = costoMercaderia + costoComision + iva + costoEnvioOrden;

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
    .map(t => ({ ...t, monto: Math.round(t.monto), costo: Math.round(t.costo), ganancia: Math.round(t.ganancia) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  return timeline;
}

// 6b. Pagos Online — cuenta transacciones realmente cobradas (Pagopar u otro
// gateway configurado), respetando los mismos filtros activos (fecha,
// producto, origen, etc.) que el resto del dashboard.
async function getPagosOnlineAnalytics(whereBase) {
  const pagos = await PaymentTransaction.findAll({
    where: { status: 'PAID' },
    attributes: ['id', 'amount', 'payment_reference', 'metadata'],
    include: [{ model: Envio, as: 'envio', attributes: [], where: whereBase, required: true }],
    raw: true,
  });

  const pagosCheckout = pagos.filter((p) => {
    // `payment_transactions` tambien guarda cobros internos de abastecimiento
    // Gesicom. Esos son pagos del comercio al sistema, no pagos del comprador
    // en la tienda, y no deben inflar el embudo "Pago Web".
    const metadata = p.metadata || {};
    const referencia = String(p.payment_reference || '');
    return metadata.tipo !== 'abastecimiento_gesicom' && !referencia.startsWith('ABAST-');
  });

  return {
    pagos_realizados: pagosCheckout.length,
    monto_pagado: pagosCheckout.reduce((acc, p) => acc + Number(p.amount || 0), 0),
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
 * getKpisFinancieros (facturación − mercadería − flete completo − comisión
 * − IVA) pero
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
    // Misma regla que el resto del dashboard: la facturación es el `monto`
    // tal cual, y el costo resta el flete COMPLETO — sin abrir por quién
    // lo pagó, porque al courier se le paga igual.
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

  // Foto de whereBase ANTES de cualquier filtro de pantalla: es el universo
  // del período, el mismo que ven los gastos del módulo Finanzas (que se
  // consultan por usuario + fechas y nada más). Se usa como denominador del
  // prorrateo — ver getUnidadesUniversoPeriodo.
  const whereUniverso = { ...whereBase };

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
    comparativo,
    universoUnidades,
  ] = await Promise.all([
    getResumenFunnel(whereBase, canalesCatalogo),
    enviosConItemsPromise.then(getKpisFinancieros),
    enviosConItemsPromise.then(getProductosAnalytics),
    enviosConItemsPromise.then(getOfertasAnalytics),
    getConfirmadoresAnalytics(whereBase),
    getCouriersAnalytics(whereBase, usuario_id),
    getTimelineTendencias(whereBase, desde, hasta),
    confirmadoresDisponiblesPromise,
    getGastosOperativos(usuario_id, desde, hasta, inquilino_id),
    getPagosOnlineAnalytics(whereBase),
    catalogoCacheado(`productos:${usuario_id}`, () => getProductosDisponibles(usuario_id)),
    catalogoCacheado(`anios:${usuario_id}`, () => getAniosDisponibles(usuario_id)),
    landingsTiendaPromise.then(getLandingsDisponibles),
    landingsTiendaPromise.then(ls => getRankingLandings(whereRanking, desde, hasta, ls)),
    getComparativoPeriodo(whereBase, usuario_id, desde, hasta, filtros.producto_id, inquilino_id),
    getUnidadesUniversoPeriodo(whereUniverso),
  ]);

  // Prorrateo por producto — por UNIDADES ENTREGADAS, igual que la planilla
  // del comercio (ej. Gs 2.500.000 repartidos entre 130/32/26 unidades
  // sobre un total de 188).
  //
  // Los gastos FIJOS y los VARIABLES generales (alquiler, sueldos,
  // comisiones bancarias, marketing sin producto puntual) se prorratean por
  // unidades, cada uno en su propia línea — el fijo alimenta el punto de
  // equilibrio, el variable no. Todo lo demás va DIRECTO al producto que le
  // corresponde, sin repartir:
  //   - envío, comisión e IVA: ya vienen atribuidos desde getProductosAnalytics
  //     (costo_directo_pedido) — volver a meterlos acá los contaría dos veces.
  //   - un CostoGasto con `producto_id`: el usuario ya dijo de quién es.
  //   - gasto de Meta de una campaña con producto(s) asignado(s) (Ads &
  //     Campañas): va 100% a cada uno de esos productos, no se parte.
  // Lo ÚNICO que no entra al costo de ningún producto es el gasto de Meta de
  // campañas SIN vincular (`gastos_generales_sin_atribuir`): no tiene
  // producto, y suele ser un importe grande frente a la venta de un solo
  // producto — prorratearlo lo desfiguraría. Resta de la Ganancia Neta
  // global nada más.
  for (const p of rankingProductos) {
    p.costo_gasto_directo = Math.round(gastosOperativos.directos_por_producto[p.producto_id] || 0);
    p.costo_meta_directo = Math.round(gastosOperativos.meta_directo_por_producto[p.producto_id] || 0);
  }

  // El reparto de fijos y variables se hace SIEMPRE contra las unidades del
  // período completo, nunca contra las del ranking filtrado. Es lo que hace
  // que la parte que le toca a un producto sea la misma lo mires como lo
  // mires: con 8 de 24 unidades, EarPlugs se lleva 8/24 del alquiler tanto
  // en la tabla completa como al filtrar por EarPlugs.
  const unidadesUniverso = universoUnidades.total;
  const unidadesRanking = rankingProductos.reduce((acc, p) => acc + p.unidades_entregadas, 0);

  let repartidoFijo = 0;
  let repartidoVariable = 0;
  let idxMayor = -1;
  rankingProductos.forEach((p, i) => {
    // Las unidades del universo mandan sobre las del ranking: con filtro de
    // producto los pedidos entran enteros, así que un pedido que mezcla dos
    // productos aporta unidades que el universo ya contabilizó igual.
    const unidadesProducto = universoUnidades.porClave.get(claveProducto(p)) ?? p.unidades_entregadas;
    const pctUnidades = unidadesUniverso > 0 ? unidadesProducto / unidadesUniverso : 0;
    p.costo_fijo_prorrateado = Math.round(gastosOperativos.fijos_generales * pctUnidades);
    p.costo_variable_prorrateado = Math.round(gastosOperativos.variables_generales * pctUnidades);
    repartidoFijo += p.costo_fijo_prorrateado;
    repartidoVariable += p.costo_variable_prorrateado;
    if (idxMayor === -1 || p.unidades_entregadas > rankingProductos[idxMayor].unidades_entregadas) idxMayor = i;
  });

  // El redondeo por producto deja un resto de ±1 Gs: se lo lleva el
  // producto que más unidades vendió, así la suma de los prorrateos da
  // exacto y la tabla cierra en vez de descuadrar por unos guaraníes.
  //
  // Solo corresponde cuando el ranking ES el universo. Con un filtro puesto
  // la suma de los prorrateos tiene que quedar POR DEBAJO del total del
  // período — esa diferencia es justamente la parte que les toca a los
  // productos que el filtro dejó afuera. Volcarle el resto al más grande
  // ahí adentro sería reintroducir el mismo bug por la puerta de atrás.
  const rankingEsElUniverso = unidadesUniverso > 0 && unidadesRanking === unidadesUniverso;
  if (rankingEsElUniverso && idxMayor >= 0 && rankingProductos[idxMayor].unidades_entregadas > 0) {
    rankingProductos[idxMayor].costo_fijo_prorrateado += gastosOperativos.fijos_generales - repartidoFijo;
    rankingProductos[idxMayor].costo_variable_prorrateado += gastosOperativos.variables_generales - repartidoVariable;
  }

  for (const p of rankingProductos) {
    p.costo_prorrateado = p.costo_fijo_prorrateado + p.costo_variable_prorrateado;
  }

  // Contrato de la tabla de productos: venta / costo / ganancia / pérdida,
  // MÁS el desglose de `costo` abierto por concepto (`costo_detalle`).
  //
  // El desglose existe porque "Costo Gs 232.752" era una caja negra: el
  // comerciante veía el número, no le cerraba, y no tenía forma de saber de
  // qué estaba hecho. Ahora el dashboard lo abre al pasar el mouse.
  //
  // `perdida` va SEPARADA y no se descuenta del costo ni de la ganancia:
  // restarla otra vez sería contar dos veces la misma plata.
  for (const p of rankingProductos) {
    p.unidades = p.unidades_entregadas;
    p.venta = p.facturacion_total;
    p.costo = Math.round(p.costo_total + p.costo_directo_pedido + p.costo_gasto_directo + p.costo_meta_directo + p.costo_prorrateado);
    p.ganancia = Math.round(p.venta - p.costo);
    p.perdida = Math.round(p.perdida);
    p.rentabilidad = p.venta > 0 ? Number(((p.ganancia / p.venta) * 100).toFixed(1)) : 0;

    // Margen bruto = precio del producto − mercadería, SIN el envío de por
    // medio. Se calcula sobre `venta_producto_total` y no sobre `venta`,
    // porque `venta` puede traer adentro el flete que se le cobró al
    // cliente: mezclarlo inflaría el margen y dejaría de responder la
    // pregunta que importa — "¿este producto está bien pescado?".
    const ventaProducto = Math.round(p.venta_producto_total);
    p.margen_bruto = Math.round(ventaProducto - p.costo_total);
    p.pct_margen_bruto = ventaProducto > 0 ? Number(((p.margen_bruto / ventaProducto) * 100).toFixed(1)) : 0;

    // Cinco orígenes distintos, cinco renglones distintos. Meterlos en uno
    // solo escondía que adentro convivían el alquiler, una comisión
    // bancaria del mes entero, la publicidad de una campaña propia y un
    // gasto que el usuario había atado a mano a ese producto.
    p.costo_detalle = {
      mercaderia: Math.round(p.costo_total),
      envio: Math.round(p.costo_envio),
      comision: Math.round(p.costo_comision),
      iva: Math.round(p.costo_iva),
      fijos: Math.round(p.costo_fijo_prorrateado),
      variables: Math.round(p.costo_variable_prorrateado),
      publicidad_directa: Math.round(p.costo_meta_directo),
      gastos_directos: Math.round(p.costo_gasto_directo),
    };

    // Bandera para que el frontend no tenga que decidir con qué umbral
    // pintar la alerta: un producto que se vende sin margen bruto es un
    // problema de precio, y hay que verlo antes de seguir vendiéndolo.
    p.alerta = ventaProducto > 0 && p.margen_bruto <= 0
      ? 'sin_margen'
      : (p.ganancia < 0 ? 'ganancia_negativa' : null);

    // Se mantienen por compatibilidad con quien ya los consumía.
    p.utilidad_neta = p.ganancia;
    p.pct_rentabilidad = p.rentabilidad;

    // Interno: no forma parte del contrato visual.
    delete p.costo_prorrateado;
    delete p.costo_fijo_prorrateado;
    delete p.costo_variable_prorrateado;
    delete p.costo_meta_directo;
    delete p.costo_gasto_directo;
    delete p.costo_directo_pedido;
    delete p.costo_comision;
    delete p.costo_iva;
    delete p.costo_envio;
    delete p.venta_producto_total;
  }

  // Con un producto filtrado, la tarjeta de Rentabilidad deja de hablar del
  // negocio entero y pasa a hablar de ESE producto: Fijos, Variables y Meta
  // muestran la parte que YA se le prorrateó en costo_detalle (la misma
  // cuenta de la tabla "Más Vendidos"), no el total del período. Sin
  // filtro, siguen siendo el total del período — el negocio entero.
  //
  // El filtro se resuelve a nivel de PEDIDO (ver whereBase.id más arriba):
  // un pedido que mezcla este producto con otro sigue entrando entero, así
  // que rankingProductos puede traer más de un producto igual. Por eso se
  // busca el que coincide con filtros.producto_id, no "el primero" ni "se
  // suman todos" — eso mezclaría el costo de un producto ajeno.
  const productoFiltrado = (filtros.producto_id && filtros.producto_id !== 'TODOS')
    ? rankingProductos.find(p => String(p.producto_id) === String(filtros.producto_id))
    : null;

  const fijosMostrados = productoFiltrado ? productoFiltrado.costo_detalle.fijos : gastosOperativos.fijos_generales;
  const variablesMostrados = productoFiltrado ? productoFiltrado.costo_detalle.variables : gastosOperativos.variables_generales;
  const metaMostrado = productoFiltrado ? productoFiltrado.costo_detalle.publicidad_directa : gastosOperativos.meta_ads;

  // Ganancia neta = margen bruto (ya neto de COGS/logística/comisión/IVA por
  // pedido) menos los costos y gastos operativos que le corresponden: el
  // total del negocio sin filtro, o solo lo prorrateado + lo atado a mano a
  // ESTE producto cuando hay uno filtrado — mismo criterio que
  // fijosMostrados/variablesMostrados/metaMostrado.
  const gastosADescontar = productoFiltrado
    ? fijosMostrados + variablesMostrados + metaMostrado + productoFiltrado.costo_detalle.gastos_directos
    : gastosOperativos.total;
  const gananciaNetaEstimada = kpisFinancieros.margen_bruto_estimado - gastosADescontar;
  const pctMargenNeto = kpisFinancieros.facturacion_entregada > 0
    ? Number(((gananciaNetaEstimada / kpisFinancieros.facturacion_entregada) * 100).toFixed(1))
    : 0;

  kpisFinancieros.gastos_operativos = Math.round(gastosOperativos.gastos_operativos);
  kpisFinancieros.costos_operativos_adicionales = Math.round(gastosOperativos.costos_operativos_adicionales);
  kpisFinancieros.gastos_por_categoria = gastosOperativos.por_categoria;
  // Gasto de Meta: el total del período sin filtro, o el 100% de lo que le
  // toca a ESTE producto (ver getGastoMetaAds) cuando hay uno filtrado.
  kpisFinancieros.gasto_meta_ads = Math.round(metaMostrado);

  // Sin filtro, Fijos y Variables son SIEMPRE el total del período y no se
  // acotan al producto: el alquiler se paga igual, mires lo que mires. Con
  // un producto filtrado, muestran la parte prorrateada de ESE producto.
  kpisFinancieros.gastos_fijos_generales = Math.round(fijosMostrados);
  kpisFinancieros.gastos_variables_generales = Math.round(variablesMostrados);
  // Plata real del período que resta de la Ganancia Neta pero no aparece en
  // el costo de ningún producto: solo el gasto de Meta de campañas sin
  // vincular (ver comentario en getGastosOperativos). Los variables
  // generales SÍ se prorratean y aparecen en costo_detalle.variables.
  kpisFinancieros.gastos_sin_atribuir_a_producto = Math.round(gastosOperativos.gastos_generales_sin_atribuir);
  kpisFinancieros.gastos_directos_a_producto = Math.round(
    Object.values(gastosOperativos.directos_por_producto).reduce((acc, v) => acc + v, 0)
  );
  kpisFinancieros.gastos_sin_clasificar = Math.round(gastosOperativos.sin_clasificar);
  kpisFinancieros.ganancia_neta_estimada = Math.round(gananciaNetaEstimada);
  kpisFinancieros.pct_margen_neto = pctMargenNeto;

  // Punto de equilibrio: cuánto hay que facturar para que los gastos fijos
  // queden cubiertos y el período cierre en cero.
  //
  //   margen de contribución % = (facturación − mercadería − comisión − IVA) / facturación
  //   punto de equilibrio      = gastos fijos / margen de contribución %
  //
  // Sin gastos fijos cargados el punto de equilibrio es 0 (ya estás en
  // equilibrio); sin margen de contribución positivo NO existe — vendiendo
  // a pérdida, facturar más aleja del equilibrio en vez de acercarlo, y
  // devolver un número ahí sería mentir. Por eso `null` y no un infinito.
  const pctContribucion = kpisFinancieros.facturacion_entregada > 0
    ? kpisFinancieros.margen_bruto_estimado / kpisFinancieros.facturacion_entregada
    : 0;
  kpisFinancieros.pct_contribucion = Number((pctContribucion * 100).toFixed(1));
  //
  // Divide por los gastos FIJOS, no por el total: los variables se mueven
  // con las ventas, así que ya están adentro del margen de contribución y
  // volver a cargarlos acá arriba inflaba el número. Sin filtro es el fijo
  // del negocio entero; con un producto filtrado, la parte que YA se le
  // prorrateó a ese producto — mismo criterio que el resto de la tarjeta.
  const gastosFijosDelPeriodo = fijosMostrados;
  kpisFinancieros.punto_equilibrio = gastosFijosDelPeriodo <= 0
    ? 0
    : (pctContribucion > 0 ? Math.round(gastosFijosDelPeriodo / pctContribucion) : null);
  kpisFinancieros.falta_para_equilibrio = kpisFinancieros.punto_equilibrio === null
    ? null
    : Math.max(0, kpisFinancieros.punto_equilibrio - kpisFinancieros.facturacion_entregada);

  // Los gastos fijos son del PERÍODO, no de un día. Para que la línea de
  // Ganancia del gráfico signifique lo mismo que la Utilidad Neta de la
  // tarjeta, se reparten entre los días proporcionalmente a lo que facturó
  // cada uno: el día que más vendió absorbe más publicidad y más alquiler.
  //
  // Antes el gráfico dibujaba margen bruto y la tarjeta mostraba utilidad
  // neta, las dos rotuladas "ganancia": con gastos cargados eran dos cifras
  // distintas para el mismo día, sin nada que lo explicara.
  //
  // Si no facturó ningún día, no hay entre qué repartir y las líneas quedan
  // como están: inventar un reparto sobre cero no agregaría información.
  const facturacionTimeline = tendencias.reduce((acc, t) => acc + t.monto, 0);
  if (gastosOperativos.total > 0 && facturacionTimeline > 0) {
    let repartidoGastos = 0;
    let idxMayorDia = 0;
    tendencias.forEach((t, i) => {
      t.gastos_fijos = Math.round((t.monto / facturacionTimeline) * gastosOperativos.total);
      t.costo += t.gastos_fijos;
      t.ganancia -= t.gastos_fijos;
      repartidoGastos += t.gastos_fijos;
      if (t.monto > tendencias[idxMayorDia].monto) idxMayorDia = i;
    });
    // El resto del redondeo va al día que más facturó, para que la suma de
    // los días dé exactamente la Utilidad Neta de la tarjeta.
    const restoGastos = gastosOperativos.total - repartidoGastos;
    if (restoGastos !== 0) {
      tendencias[idxMayorDia].gastos_fijos += restoGastos;
      tendencias[idxMayorDia].costo += restoGastos;
      tendencias[idxMayorDia].ganancia -= restoGastos;
    }
  }

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
    comparativo,
    pagos_online: pagosOnline,
    // El catálogo va en la respuesta para que el frontend arme la tabla de
    // canales desde la base, sin hardcodear nombres ni orden.
    canales_disponibles: canalesCatalogo,
  };
};
