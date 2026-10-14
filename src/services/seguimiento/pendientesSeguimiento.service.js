'use strict';
const { numeroPedidoVisible } = require('../../utils/pedidoNumero');
const { adjuntarIdentificadores } = require('../pedidoIdentificador.service');

/**
 * En qué mensaje del flujo está cada pedido, y cuándo toca. Alimenta el
 * tablero Kanban de la pestaña Resumen de Pedidos.
 *
 * Dos niveles:
 *
 * 1. ETAPA (confirmación web, venta por WhatsApp, seguimiento de envío,
 *    escalamiento de ventas, recuperación). La decide el ESTADO del pedido, nunca una
 *    persona: cuando el pedido se confirma pasa solo de "confirmación" a
 *    "seguimiento de envío", y cuando se entrega, a "escalamiento de ventas"
 *    (ver flujosBase.js). Cada etapa trabaja con los flujos de su tipo.
 *
 * 2. MENSAJE dentro del flujo (las columnas del tablero):
 *  - Avanza SOLO cuando el operador marca el mensaje como enviado. Abrir
 *    WhatsApp no mueve nada: con un enlace wa.me no se sabe si salió.
 *  - El pedido está en el mensaje siguiente al más avanzado que tiene
 *    completado en el flujo que se viene usando con él en esa etapa.
 *  - Un recordatorio agendado eligiendo mensaje manda sobre eso.
 *  - Sin nada completado, el primer mensaje del flujo predeterminado.
 *  - Con todos completados no queda mensaje: va a "Flujo terminado"
 *    (salvo en escalamiento de ventas, donde el pedido sale del tablero).
 * Esto se deriva de seguimiento_contactos; no hay puntero guardado en el
 * pedido. Completar un mensaje no impide volver a abrirlo ni reenviarlo.
 *
 * Cuándo:
 *  - ahora      → venció el recordatorio o le llegó la hora, o el pedido
 *                 acaba de entrar a la etapa y no se le mandó nada.
 *  - hoy        → toca más tarde, hoy.
 *  - despues    → toca otro día.
 *  - sin_fecha  → ya tiene mensajes completados y no quedó recordatorio.
 *
 * VENCIDO es un caso particular de "ahora": había un recordatorio, ya le
 * pasó la hora y el mensaje sigue sin marcarse como enviado. Se cuenta
 * aparte (columna, tablero y pestaña de cada etapa) y tiene su propio
 * filtro, porque es lo primero que el operador tiene que atender.
 *
 * En escalamiento de ventas la espera del PRIMER mensaje se cuenta desde la
 * entrega: con "3 días" el pedido aparece agendado y pasa a "ahora" al
 * tercer día. Ese número se edita en el flujo.
 *
 * El filtrado y la paginación se resuelven acá, nunca en el frontend.
 */
const { Op, fn, col, literal } = require('sequelize');
const {
  Envio, EnvioItem, EnvioHistorial, SeguimientoRecordatorio, SeguimientoContacto,
} = require('../../models');
const flujoService = require('./flujo.service');
const { ESTADOS_ABIERTOS, elegirRecordatorioVigente } = require('./seguimientoRecordatorio.service');
const { ETAPAS, ETAPA_INICIAL, etapaPorTipo, etapaDelPedido } = require('./flujosBase');
const { estadoActivadorDeFase, faseDisponibleParaPedido, faseSuperadaPorLogistica } = require('./faseActivacion');

const ZONA_HORARIA = 'America/Asuncion';
const CUANDO = ['ahora', 'hoy', 'despues', 'sin_fecha'];
// Estado del contacto cuando el operador confirma que mandó el mensaje.
const FASE_COMPLETADA = 'CONFIRMADO_POR_OPERADOR';
const SIN_FASE = 'sin_fase';
const ETAPA_RECOMPRA = 'ESCALAMIENTO_VENTAS';
// Tope de pedidos que se evalúan por etapa. Si se pasa, la respuesta avisa
// con `truncado` en vez de mostrar números que parecen completos y no lo son.
const LIMITE_PEDIDOS = 2000;
const LIMITE_POR_PAGINA_MAXIMO = 50;
// Un pedido entregado hace más que esto ya no entra a escalamiento de
// ventas: sin este corte, el primer día aparecerían todos los entregados de
// la historia como "para enviar ahora".
const VENTANA_RECOMPRA_DIAS = 60;
const ES_WHATSAPP = `(UPPER(COALESCE("Envio"."origen", '')) LIKE '%WHATSAPP%')`;
// Mismo criterio que elegirRecordatorioVigente + clasificarCuando, en SQL:
// el recordatorio que manda es el PENDIENTE si hay uno; si no, el VENCIDO.
const TIENE_RECORDATORIO_VENCIDO = `(
  EXISTS (SELECT 1 FROM seguimiento_recordatorios sr
          WHERE sr.envio_id = "Envio"."id" AND sr.estado = 'PENDIENTE' AND sr.ejecutar_en <= NOW())
  OR (
    EXISTS (SELECT 1 FROM seguimiento_recordatorios sr
            WHERE sr.envio_id = "Envio"."id" AND sr.estado = 'VENCIDO')
    AND NOT EXISTS (SELECT 1 FROM seguimiento_recordatorios sr
                    WHERE sr.envio_id = "Envio"."id" AND sr.estado = 'PENDIENTE')
  )
)`;

/** Fecha de calendario en Paraguay (YYYY-MM-DD) de un instante. */
function fechaLocal(instante) {
  return new Date(instante).toLocaleDateString('sv-SE', { timeZone: ZONA_HORARIA });
}

/** ahora / hoy / despues según a qué hora toca. */
function cuandoToca(instante, ahora) {
  const hora = new Date(instante);
  if (hora.getTime() <= ahora.getTime()) return 'ahora';
  return fechaLocal(hora) === fechaLocal(ahora) ? 'hoy' : 'despues';
}

function clasificarCuando(recordatorio, ahora) {
  if (recordatorio.estado === 'VENCIDO') return 'ahora';
  return cuandoToca(recordatorio.ejecutar_en, ahora);
}

function fasesOrdenadas(flujo) {
  return [...(flujo?.fases || [])]
    .filter((f) => f.activo !== false)
    .sort((a, b) => a.orden - b.orden);
}

/**
 * El mensaje siguiente al más avanzado que ya está completado. Sin ninguno
 * completado, el primero. Con el último completado, null: el flujo terminó.
 */
function proximaFaseDerivada(flujo, faseIdsCompletadas, pedido = null) {
  const fases = fasesOrdenadas(flujo);
  let mayorOrdenCompletado = 0;
  for (const fase of fases) {
    if (faseIdsCompletadas.has(Number(fase.id))) mayorOrdenCompletado = Math.max(mayorOrdenCompletado, fase.orden);
  }
  return fases.find((f) => f.orden > mayorOrdenCompletado && !faseSuperadaPorLogistica(f, pedido, flujo?.tipo)) || null;
}

/** El flujo con el que arranca un pedido en su etapa. */
function flujoPredeterminado(flujosDeLaEtapa) {
  return flujosDeLaEtapa.find((f) => f.predeterminado) || flujosDeLaEtapa[0] || null;
}

function nombreCliente(pedido) {
  return [pedido.nombre_cliente, pedido.apellido_cliente].filter(Boolean).join(' ').trim()
    || pedido.cliente
    || 'Cliente';
}

function resumenProductos(items) {
  if (!items || items.length === 0) return '';
  return items
    .map((i) => `${i.nombre_producto}${Number(i.cantidad) > 1 ? ` x${i.cantidad}` : ''}`)
    .join(', ');
}

/**
 * Arma un ítem por pedido de UNA etapa. Función pura: recibe filas planas y
 * no toca la base, para poder probar las reglas de arriba sin ella.
 *
 * @param {string}   etapa          tipo de flujo de la etapa
 * @param {object[]} pedidos        los que están en esa etapa
 * @param {object[]} recordatorios  solo los abiertos (PENDIENTE / VENCIDO)
 * @param {object[]} contactos      agrupados: { envio_id, flujo_id, fase_id, estado, veces, ultimo }
 * @param {object[]} flujos         activos, con sus fases (de cualquier tipo: acá se filtran)
 * @param {Map}      entregas       envio_id → fecha de entrega (solo escalamiento de ventas)
 */
function armarPendientes({
  etapa = ETAPA_INICIAL, pedidos, recordatorios, contactos, flujos, entregas = new Map(), ahora = new Date(),
}) {
  const agrupar = (filas, clave) => filas.reduce((mapa, fila) => {
    const k = Number(fila[clave]);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(fila);
    return mapa;
  }, new Map());

  const recordatoriosPorPedido = agrupar(recordatorios, 'envio_id');
  const contactosPorPedido = agrupar(contactos, 'envio_id');
  const flujosPorUsuario = agrupar(flujos.filter((f) => f.tipo === etapa), 'usuario_id');
  const esRecompra = etapa === ETAPA_RECOMPRA;

  const items = [];
  for (const pedido of pedidos) {
    const flujosDeLaEtapa = flujosPorUsuario.get(Number(pedido.usuario_id)) || [];
    const flujoPorId = new Map(flujosDeLaEtapa.map((f) => [Number(f.id), f]));
    // Solo cuenta lo que pasó en flujos de ESTA etapa: los mensajes de
    // confirmación no adelantan nada en el seguimiento de envío.
    const delPedido = (contactosPorPedido.get(Number(pedido.id)) || []).filter((c) => flujoPorId.has(Number(c.flujo_id)));
    const completados = delPedido.filter((c) => c.estado === FASE_COMPLETADA);
    const recordatoriosDeLaEtapa = (recordatoriosPorPedido.get(Number(pedido.id)) || []).filter((r) => {
      const faseDelRecordatorio = flujosDeLaEtapa.flatMap(fasesOrdenadas).find((f) => Number(f.id) === Number(r.fase_id));
      if (faseSuperadaPorLogistica(faseDelRecordatorio, pedido, etapa)) return false;
      return r.flujo_id
        ? flujoPorId.has(Number(r.flujo_id))
        : !r.fase_id || Boolean(faseDelRecordatorio);
    });
    const recordatorio = elegirRecordatorioVigente(recordatoriosDeLaEtapa);

    let flujo = null;
    let fase = null;
    let faseOrigen = null;

    // El mensaje que se eligió al agendar manda, si es de esta etapa.
    if (recordatorio?.fase_id) {
      for (const candidato of flujosDeLaEtapa) {
        const encontrada = fasesOrdenadas(candidato).find((f) => Number(f.id) === Number(recordatorio.fase_id));
        if (encontrada) { flujo = candidato; fase = encontrada; faseOrigen = 'recordatorio'; break; }
      }
    }

    // Si no, el siguiente al último completado (o el primero del flujo).
    if (!fase) {
      const ultimoContacto = [...delPedido].sort((a, b) => new Date(b.ultimo) - new Date(a.ultimo))[0];
      flujo = flujoPorId.get(Number(recordatorio?.flujo_id))
        || flujoPorId.get(Number(ultimoContacto?.flujo_id))
        || flujoPredeterminado(flujosDeLaEtapa);
      if (flujo) {
        const completadasDelFlujo = new Set(
          completados.filter((c) => Number(c.flujo_id) === Number(flujo.id)).map((c) => Number(c.fase_id)),
        );
        fase = proximaFaseDerivada(flujo, completadasDelFlujo, pedido);
        faseOrigen = fase ? 'derivada' : null;
      }
    }

    // En escalamiento de ventas, quien ya recibió todos los mensajes sale
    // del tablero: no hay nada más que hacer con ese pedido.
    if (esRecompra && flujo && !fase) continue;

    // WhatsApp abierto en el mensaje actual y todavía sin marcar como enviado.
    const abiertaSinCompletar = fase
      ? delPedido.find((c) => Number(c.fase_id) === Number(fase.id) && c.estado !== FASE_COMPLETADA)
      : null;

    const entregadoEn = esRecompra ? (entregas.get(Number(pedido.id)) || pedido.updated_at || null) : null;
    let cuando;
    let motivo;
    let tocaEn = null;
    const esperandoEstado = fase && !faseDisponibleParaPedido(fase, pedido, etapa);
    if (esperandoEstado) {
      cuando = 'sin_fecha';
      motivo = 'esperando_estado';
    } else if (recordatorio) {
      cuando = clasificarCuando(recordatorio, ahora);
      motivo = cuando === 'ahora' ? 'vencido' : 'programado';
      tocaEn = recordatorio.ejecutar_en;
    } else if (completados.length === 0) {
      // Recién entra a la etapa. En escalamiento de ventas el primer mensaje
      // espera los días configurados desde la entrega.
      const esperaMinutos = esRecompra && fase?.orden === 1 ? Number(fase.espera_sugerida_minutos) || 0 : 0;
      if (esperaMinutos > 0 && entregadoEn) {
        tocaEn = new Date(new Date(entregadoEn).getTime() + esperaMinutos * 60 * 1000).toISOString();
        cuando = cuandoToca(tocaEn, ahora);
        motivo = cuando === 'ahora' ? 'nuevo' : 'programado';
      } else {
        cuando = 'ahora';
        motivo = 'nuevo';
      }
    } else if (estadoActivadorDeFase(fase)) {
      cuando = 'ahora';
      motivo = 'estado_logistico';
    } else {
      cuando = 'sin_fecha';
      motivo = 'sin_agendar';
    }

    const ultimaCompletada = completados.reduce(
      (max, c) => (!max || new Date(c.ultimo) > new Date(max) ? c.ultimo : max), null,
    );

    items.push({
      envio_id: pedido.id,
      numero_pedido: numeroPedidoVisible(pedido),
      numero_pedido_visible: numeroPedidoVisible(pedido),
      estado: pedido.estado,
      etapa,
      cliente: nombreCliente(pedido),
      telefono: pedido.telefono || null,
      ciudad: pedido.ciudad || null,
      monto: Number(pedido.monto) || 0,
      productos: '',
      creado_en: pedido.created_at || pedido.createdAt || null,
      entregado_en: entregadoEn,
      flujo_id: flujo ? flujo.id : null,
      flujo_nombre: flujo ? flujo.nombre : null,
      fase_id: fase?.id || null,
      fase_orden: fase?.orden || null,
      fase_nombre: fase?.nombre || null,
      fase_origen: faseOrigen,
      fase_abierta_en: abiertaSinCompletar?.ultimo || null,
      cuando,
      motivo,
      estado_requerido: esperandoEstado ? (estadoActivadorDeFase(fase) || 'Preparado') : null,
      toca_en: tocaEn,
      recordatorio: recordatorio ? {
        id: recordatorio.id,
        estado: recordatorio.estado,
        ejecutar_en: recordatorio.ejecutar_en,
        nota: recordatorio.nota || null,
      } : null,
      ultima_fase_completada_en: ultimaCompletada,
    });
  }

  // Lo más urgente primero; dentro de cada grupo, lo que hace más que espera.
  const referencia = (item) => new Date(item.toca_en || item.ultima_fase_completada_en || item.entregado_en || item.creado_en || 0).getTime();
  return items.sort((a, b) => (
    CUANDO.indexOf(a.cuando) - CUANDO.indexOf(b.cuando) || referencia(a) - referencia(b)
  ));
}

const contadorVacio = () => ({ ahora: 0, hoy: 0, despues: 0, sin_fecha: 0 });

function contar(items) {
  const conteo = contadorVacio();
  for (const item of items) conteo[item.cuando] += 1;
  return conteo;
}

const estaVencido = (item) => item.motivo === 'vencido';
const contarVencidos = (items) => items.filter(estaVencido).length;

/** Clave de la columna del tablero en la que cae un ítem. */
function claveDeColumna(item) {
  return item.fase_id ? String(item.fase_id) : SIN_FASE;
}

function coincideBusqueda(item, busqueda) {
  const texto = String(busqueda || '').trim().toLowerCase();
  if (!texto) return true;
  const sinNumeral = texto.replace(/^#/, '');
  const soloDigitos = texto.replace(/\D/g, '');
  return item.cliente.toLowerCase().includes(texto)
    || String(item.numero_pedido_visible || item.numero_pedido).toLowerCase().includes(sinNumeral)
    || (soloDigitos.length >= 4 && String(item.telefono || '').replace(/\D/g, '').includes(soloDigitos));
}

/** Filtros que llegan del frontend, aplicados en el servidor. */
function filtrar(items, { flujo_id, fase, cuando, busqueda } = {}) {
  return items.filter((item) => {
    if (flujo_id && Number(item.flujo_id) !== Number(flujo_id)) return false;
    if (fase !== undefined && fase !== null && fase !== '' && claveDeColumna(item) !== String(fase)) return false;
    // 'vencido' no es un cuándo más: es el subconjunto de "ahora" que tenía
    // recordatorio y se pasó.
    if (cuando === 'vencido' && !estaVencido(item)) return false;
    if (cuando && CUANDO.includes(cuando) && item.cuando !== cuando) return false;
    return coincideBusqueda(item, busqueda);
  });
}

function normalizarPaginacion(page, limit, total) {
  const porPagina = Math.min(LIMITE_POR_PAGINA_MAXIMO, Math.max(1, parseInt(limit, 10) || 10));
  const totalPages = Math.max(1, Math.ceil(total / porPagina));
  const pagina = Math.min(totalPages, Math.max(1, parseInt(page, 10) || 1));
  return { page: pagina, limit: porPagina, totalPages, desde: (pagina - 1) * porPagina };
}

function paginar(items, { page, limit } = {}) {
  const { page: pagina, limit: porPagina, totalPages, desde } = normalizarPaginacion(page, limit, items.length);
  return { data: items.slice(desde, desde + porPagina), total: items.length, page: pagina, totalPages, limit: porPagina };
}

/**
 * El tablero de un flujo de la etapa: una columna por mensaje (más "Flujo
 * terminado" si hay pedidos ahí), cada una con su propia página.
 *
 * `flujos` son los de la etapa. Los filtros `cuando` y `busqueda` achican
 * las tarjetas de las columnas; `conteo` de cada columna y `totales` son
 * siempre sobre todo lo pendiente del flujo, para que el encabezado no
 * cambie al filtrar.
 */
function armarTablero(items, flujos, { flujo_id, cuando, busqueda, paginas = {}, limit } = {}) {
  const conPendientes = new Set(items.map((i) => Number(i.flujo_id)).filter(Boolean));
  const elegido = flujos.find((f) => Number(f.id) === Number(flujo_id))
    || flujos.find((f) => conPendientes.has(Number(f.id)))
    || flujoPredeterminado(flujos);

  const delFlujo = elegido ? items.filter((i) => Number(i.flujo_id) === Number(elegido.id)) : [];
  const filtrados = filtrar(delFlujo, { cuando, busqueda });

  const columna = (clave, datos) => {
    const todos = delFlujo.filter((i) => claveDeColumna(i) === clave);
    const visibles = filtrados.filter((i) => claveDeColumna(i) === clave);
    return {
      clave, ...datos,
      conteo: contar(todos),
      vencidos: contarVencidos(todos),
      ...paginar(visibles, { page: paginas[clave], limit }),
    };
  };

  const columnas = fasesOrdenadas(elegido).map((fase) => columna(String(fase.id), {
    fase_id: fase.id,
    orden: fase.orden,
    nombre: fase.nombre,
    espera_sugerida_minutos: fase.espera_sugerida_minutos || 0,
  }));
  if (delFlujo.some((i) => !i.fase_id)) {
    columnas.push(columna(SIN_FASE, { fase_id: null, orden: null, nombre: 'Flujo terminado', espera_sugerida_minutos: 0 }));
  }

  return {
    flujos: flujos.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      predeterminado: !!f.predeterminado,
      pendientes: items.filter((i) => Number(i.flujo_id) === Number(f.id)).length,
    })),
    flujo_id: elegido?.id || null,
    totales: contar(delFlujo),
    vencidos: contarVencidos(delFlujo),
    columnas,
  };
}

/** Qué pedidos están en la etapa: lo decide su estado (y el origen, mientras están por confirmar). */
function whereDeEtapa(tipo, ahora) {
  const etapa = etapaPorTipo(tipo);
  const condiciones = [{ estado: { [Op.in]: etapa.estados } }];
  if (tipo === 'CONFIRMACION_PEDIDO_WEB') condiciones.push(literal(`NOT ${ES_WHATSAPP}`));
  if (tipo === 'VENTA_WHATSAPP') condiciones.push(literal(ES_WHATSAPP));
  if (tipo === ETAPA_RECOMPRA) {
    // Corte grueso en SQL: un entregado no pudo modificarse por última vez
    // antes de entregarse. La fecha fina de entrega se revisa después.
    condiciones.push({ updated_at: { [Op.gte]: new Date(ahora.getTime() - VENTANA_RECOMPRA_DIAS * 86400e3) } });
  }
  return condiciones;
}

/**
 * Cuándo se entregó cada pedido. El pedido no guarda esa fecha: sale del
 * historial ("… → Entregado"). Cuando la entrega la marcó el courier o
 * llegó por integración no queda esa línea, y se usa la última modificación
 * del pedido como aproximación.
 */
async function fechasDeEntrega(ids) {
  if (ids.length === 0) return new Map();
  const filas = await EnvioHistorial.findAll({
    where: {
      envio_id: { [Op.in]: ids },
      [Op.or]: [{ estado_nuevo: 'Entregado' }, { detalle: { [Op.like]: '%→ Entregado%' } }],
    },
    attributes: ['envio_id', [fn('MAX', col('created_at')), 'entregado_en']],
    group: ['envio_id'],
    raw: true,
  });
  return new Map(filas.map((f) => [Number(f.envio_id), f.entregado_en]));
}

/**
 * Los pedidos de una etapa con el mensaje que le toca a cada uno.
 * `whereBase` trae el alcance (cuenta + tienda activa) ya resuelto por el
 * controller.
 */
async function cargarPendientes({ whereBase, usuarioId, esAdmin, etapa, ahora = new Date() }) {
  const filas = await Envio.findAll({
    where: { ...whereBase, [Op.and]: [...(whereBase[Op.and] || []), ...whereDeEtapa(etapa, ahora)] },
    attributes: [
      'id', 'numero_pedido', 'numero_pedido_tienda', 'tienda_id', 'usuario_id', 'estado', 'origen', 'monto',
      'nombre_cliente', 'apellido_cliente', 'cliente', 'telefono', 'ciudad', 'created_at', 'updated_at',
    ],
    order: [['id', 'DESC']],
    limit: LIMITE_PEDIDOS + 1,
    raw: true,
  });

  const truncado = filas.length > LIMITE_PEDIDOS;
  let pedidos = truncado ? filas.slice(0, LIMITE_PEDIDOS) : filas;
  pedidos = await adjuntarIdentificadores(pedidos);

  const flujos = (await flujoService.listarFlujos({ usuarioId, esAdmin, soloActivos: true }))
    .map((f) => (typeof f.toJSON === 'function' ? f.toJSON() : f))
    .filter((f) => f.tipo === etapa);

  let entregas = new Map();
  if (etapa === ETAPA_RECOMPRA && pedidos.length > 0) {
    entregas = await fechasDeEntrega(pedidos.map((p) => p.id));
    const corte = ahora.getTime() - VENTANA_RECOMPRA_DIAS * 86400e3;
    pedidos = pedidos.filter((p) => new Date(entregas.get(Number(p.id)) || p.updated_at).getTime() >= corte);
  }

  const ids = pedidos.map((p) => p.id);
  if (ids.length === 0 || flujos.length === 0) return { items: [], flujos, truncado: false };

  const [recordatorios, contactos] = await Promise.all([
    SeguimientoRecordatorio.findAll({
      where: { envio_id: { [Op.in]: ids }, estado: { [Op.in]: ESTADOS_ABIERTOS } },
      attributes: ['id', 'envio_id', 'estado', 'ejecutar_en', 'nota', 'flujo_id', 'fase_id'],
      raw: true,
    }),
    SeguimientoContacto.findAll({
      where: {
        envio_id: { [Op.in]: ids },
        fase_id: { [Op.ne]: null },
        flujo_id: { [Op.in]: flujos.map((f) => f.id) },
      },
      attributes: [
        'envio_id', 'flujo_id', 'fase_id', 'estado',
        [fn('COUNT', col('id')), 'veces'],
        [fn('MAX', col('created_at')), 'ultimo'],
      ],
      group: ['envio_id', 'flujo_id', 'fase_id', 'estado'],
      raw: true,
    }),
  ]);

  const items = armarPendientes({ etapa, pedidos, recordatorios, contactos, flujos, entregas, ahora });
  return { items, flujos, truncado };
}

/** Cuántos pedidos hay en cada etapa, para el selector. Dos consultas, sin traer filas. */
async function conteoPorEtapa({ whereBase, ahora = new Date() }) {
  const estadosVivos = ETAPAS.filter((e) => e.tipo !== ETAPA_RECOMPRA).flatMap((e) => e.estados);
  const [porEstado, entregados] = await Promise.all([
    Envio.findAll({
      where: { ...whereBase, estado: { [Op.in]: [...new Set(estadosVivos)] } },
      attributes: ['estado', [literal(ES_WHATSAPP), 'es_whatsapp'], [fn('COUNT', col('id')), 'cantidad']],
      group: ['estado', literal(ES_WHATSAPP)],
      raw: true,
    }),
    Envio.count({
      where: { ...whereBase, [Op.and]: [...(whereBase[Op.and] || []), ...whereDeEtapa(ETAPA_RECOMPRA, ahora)] },
    }),
  ]);

  const conteo = Object.fromEntries(ETAPAS.map((e) => [e.tipo, 0]));
  for (const fila of porEstado) {
    const cantidad = Number(fila.cantidad) || 0;
    const esWhatsapp = fila.es_whatsapp === true || fila.es_whatsapp === 't' || fila.es_whatsapp === 1;
    const tipo = etapaDelPedido({ estado: fila.estado, origen: esWhatsapp ? 'WHATSAPP' : 'landing' });
    if (tipo) conteo[tipo] += cantidad;
  }
  conteo[ETAPA_RECOMPRA] = entregados;
  return conteo;
}

/**
 * Cuántos pedidos de cada etapa tienen un recordatorio vencido, para marcar
 * en rojo la pestaña. Una sola consulta agrupada, sin traer filas.
 *
 * Es un conteo en SQL, así que puede diferir por algún pedido del cálculo
 * fino del tablero (p. ej. un entregado que ya terminó su flujo). Por eso
 * la etapa que se está mirando NO usa este número: tableroDeSeguimiento lo
 * reemplaza por el del tablero, y lo que dice la pestaña abierta coincide
 * siempre con las tarjetas que se ven.
 */
async function vencidosPorEtapa({ whereBase, ahora = new Date() }) {
  const todosLosEstados = [...new Set(ETAPAS.flatMap((e) => e.estados))];
  const corteRecompra = new Date(ahora.getTime() - VENTANA_RECOMPRA_DIAS * 86400e3);
  const filas = await Envio.findAll({
    where: {
      ...whereBase,
      [Op.and]: [
        ...(whereBase[Op.and] || []),
        { estado: { [Op.in]: todosLosEstados } },
        { [Op.or]: [{ estado: { [Op.ne]: 'Entregado' } }, { updated_at: { [Op.gte]: corteRecompra } }] },
        literal(TIENE_RECORDATORIO_VENCIDO),
      ],
    },
    attributes: ['estado', [literal(ES_WHATSAPP), 'es_whatsapp'], [fn('COUNT', col('id')), 'cantidad']],
    group: ['estado', literal(ES_WHATSAPP)],
    raw: true,
  });

  const vencidos = Object.fromEntries(ETAPAS.map((e) => [e.tipo, 0]));
  for (const fila of filas) {
    const cantidad = Number(fila.cantidad) || 0;
    const esWhatsapp = fila.es_whatsapp === true || fila.es_whatsapp === 't' || fila.es_whatsapp === 1;
    const tipo = etapaDelPedido({ estado: fila.estado, origen: esWhatsapp ? 'WHATSAPP' : 'landing' });
    if (tipo) vencidos[tipo] += cantidad;
  }
  return vencidos;
}

/** Los productos solo se buscan para las tarjetas que efectivamente se devuelven. */
async function completarProductos(items) {
  const ids = items.map((i) => i.envio_id);
  if (ids.length === 0) return items;
  const filas = await EnvioItem.findAll({
    where: { envio_id: { [Op.in]: ids } },
    attributes: ['envio_id', 'nombre_producto', 'cantidad'],
    order: [['id', 'ASC']],
    raw: true,
  });
  const porPedido = new Map();
  for (const fila of filas) {
    const k = Number(fila.envio_id);
    if (!porPedido.has(k)) porPedido.set(k, []);
    porPedido.get(k).push(fila);
  }
  for (const item of items) item.productos = resumenProductos(porPedido.get(Number(item.envio_id)));
  return items;
}

function etapaValida(tipo) {
  return etapaPorTipo(tipo) ? tipo : ETAPA_INICIAL;
}

/** POST /envios/seguimiento/tablero */
async function tableroDeSeguimiento({ whereBase, usuarioId, esAdmin, filtros = {}, ahora = new Date() }) {
  const etapa = etapaValida(filtros.etapa);
  // Cada etapa tiene que tener siempre su flujo.
  await flujoService.asegurarFlujosBase({ usuarioId });

  const [{ items, flujos, truncado }, conteo, vencidos] = await Promise.all([
    cargarPendientes({ whereBase, usuarioId, esAdmin, etapa, ahora }),
    conteoPorEtapa({ whereBase, ahora }),
    vencidosPorEtapa({ whereBase, ahora }),
  ]);
  const tablero = armarTablero(items, flujos, filtros);
  await completarProductos(tablero.columnas.flatMap((c) => c.data));
  // La pestaña que se está mirando dice lo mismo que sus tarjetas.
  vencidos[etapa] = contarVencidos(items);

  return {
    etapa,
    etapas: ETAPAS.map((e) => ({
      tipo: e.tipo,
      nombre: e.nombre,
      descripcion: e.descripcion,
      pedidos: conteo[e.tipo] || 0,
      vencidos: vencidos[e.tipo] || 0,
    })),
    ventana_recompra_dias: VENTANA_RECOMPRA_DIAS,
    ...tablero,
    truncado,
  };
}

/** POST /envios/seguimiento/pendientes — lista paginada de una etapa, sin separar por columna. */
async function pendientesPaginados({ whereBase, usuarioId, esAdmin, filtros = {}, ahora = new Date() }) {
  const etapa = etapaValida(filtros.etapa);
  await flujoService.asegurarFlujosBase({ usuarioId });
  const { items, truncado } = await cargarPendientes({ whereBase, usuarioId, esAdmin, etapa, ahora });
  const pagina = paginar(filtrar(items, filtros), filtros);
  await completarProductos(pagina.data);
  return { etapa, ...pagina, truncado };
}

/**
 * El mensaje que le toca a cada pedido de una lista ya cargada (la página de
 * la bandeja de Pedidos), con la misma regla que el tablero: armarPendientes.
 * A diferencia del tablero, los pedidos llegan mezclados de todas las etapas.
 *
 * Devuelve Map envio_id → resumen. No hay entrada para los pedidos que no
 * tienen nada que enviar: cancelados,
 * cuentas sin flujo para esa etapa, o entregados fuera de la ventana de
 * recompra.
 */
async function seguimientoDePedidos({ pedidos, usuarioId, esAdmin, ahora = new Date() }) {
  const resultado = new Map();
  const porEtapa = new Map();
  for (const pedido of pedidos) {
    const etapa = etapaDelPedido(pedido);
    if (!etapa) continue;
    if (!porEtapa.has(etapa)) porEtapa.set(etapa, []);
    porEtapa.get(etapa).push(pedido);
  }
  if (porEtapa.size === 0) return resultado;

  await flujoService.asegurarFlujosBase({ usuarioId });
  const flujos = (await flujoService.listarFlujos({ usuarioId, esAdmin, soloActivos: true }))
    .map((f) => (typeof f.toJSON === 'function' ? f.toJSON() : f))
    .filter((f) => porEtapa.has(f.tipo));
  if (flujos.length === 0) return resultado;

  const ids = [...porEtapa.values()].flat().map((p) => p.id);
  const entregados = porEtapa.get(ETAPA_RECOMPRA) || [];
  const [recordatorios, contactos, entregas] = await Promise.all([
    SeguimientoRecordatorio.findAll({
      where: { envio_id: { [Op.in]: ids }, estado: { [Op.in]: ESTADOS_ABIERTOS } },
      attributes: ['id', 'envio_id', 'estado', 'ejecutar_en', 'nota', 'flujo_id', 'fase_id'],
      raw: true,
    }),
    SeguimientoContacto.findAll({
      where: {
        envio_id: { [Op.in]: ids },
        fase_id: { [Op.ne]: null },
        flujo_id: { [Op.in]: flujos.map((f) => f.id) },
      },
      attributes: [
        'envio_id', 'flujo_id', 'fase_id', 'estado',
        [fn('COUNT', col('id')), 'veces'],
        [fn('MAX', col('created_at')), 'ultimo'],
      ],
      group: ['envio_id', 'flujo_id', 'fase_id', 'estado'],
      raw: true,
    }),
    fechasDeEntrega(entregados.map((p) => p.id)),
  ]);

  const corteRecompra = ahora.getTime() - VENTANA_RECOMPRA_DIAS * 86400e3;
  for (const [etapa, lista] of porEtapa) {
    const esRecompra = etapa === ETAPA_RECOMPRA;
    const deLaEtapa = esRecompra
      ? lista.filter((p) => new Date(entregas.get(Number(p.id)) || p.updated_at).getTime() >= corteRecompra)
      : lista;
    const nombreEtapa = etapaPorTipo(etapa).nombre;
    const fasesPorFlujo = new Map(flujos.map((f) => [Number(f.id), fasesOrdenadas(f)]));
    const resumen = (item) => {
      const fasesDelFlujo = fasesPorFlujo.get(Number(item.flujo_id)) || [];
      return {
        etapa,
        etapa_nombre: nombreEtapa,
        flujo_id: item.flujo_id,
        flujo_nombre: item.flujo_nombre,
        fase_id: item.fase_id,
        fase_nombre: item.fase_nombre,
        // "Mensaje 2 de 3": la posición entre los mensajes activos, no el campo orden.
        fase_posicion: item.fase_id ? fasesDelFlujo.findIndex((f) => Number(f.id) === Number(item.fase_id)) + 1 : null,
        total_fases: fasesDelFlujo.length,
        terminado: !item.fase_id,
        cuando: item.fase_id ? item.cuando : null,
        motivo: item.fase_id ? item.motivo : null,
        estado_requerido: item.estado_requerido,
        toca_en: item.toca_en,
        fase_abierta_en: item.fase_abierta_en,
        entregado_en: item.entregado_en,
      };
    };

    const items = armarPendientes({ etapa, pedidos: deLaEtapa, recordatorios, contactos, flujos, entregas, ahora });
    for (const item of items) {
      if (item.flujo_id) resultado.set(Number(item.envio_id), resumen(item));
    }

    // En escalamiento de ventas armarPendientes deja afuera a quien ya
    // recibió todos los mensajes; en la bandeja el pedido sigue estando, y
    // lo que corresponde decir es que su flujo terminó.
    if (esRecompra) {
      const conFlujo = new Set(flujos.filter((f) => f.tipo === etapa).map((f) => Number(f.usuario_id)));
      for (const pedido of deLaEtapa) {
        if (resultado.has(Number(pedido.id)) || !conFlujo.has(Number(pedido.usuario_id))) continue;
        resultado.set(Number(pedido.id), {
          ...resumen({ entregado_en: entregas.get(Number(pedido.id)) || pedido.updated_at || null }),
          flujo_id: null, flujo_nombre: null, fase_id: null, fase_nombre: null,
          toca_en: null, fase_abierta_en: null,
        });
      }
    }
  }
  return resultado;
}

// Cada estado cae en exactamente un grupo: la suma de los grupos es el total
// de pedidos recibidos, sin pedidos contados dos veces ni perdidos.
const GRUPOS_DE_VENTA = {
  por_confirmar: ['Pendiente', 'EnSeguimiento'],
  en_curso: ['Confirmado', 'Preparado', 'Despachado', 'Reprogramado'],
  entregados: ['Entregado'],
  cancelados: ['Cancelado'],
  devueltos_perdidos: ['Devuelto', 'Perdido'],
};

function agruparVentas(filasPorEstado) {
  const vacio = () => ({ cantidad: 0, monto: 0 });
  const ventas = { recibidos: vacio(), otros: vacio() };
  for (const grupo of Object.keys(GRUPOS_DE_VENTA)) ventas[grupo] = vacio();

  for (const fila of filasPorEstado) {
    const cantidad = Number(fila.cantidad) || 0;
    const monto = Number(fila.monto) || 0;
    const grupo = Object.keys(GRUPOS_DE_VENTA).find((g) => GRUPOS_DE_VENTA[g].includes(fila.estado)) || 'otros';
    ventas[grupo].cantidad += cantidad;
    ventas[grupo].monto += monto;
    ventas.recibidos.cantidad += cantidad;
    ventas.recibidos.monto += monto;
  }
  return ventas;
}

/**
 * Pedidos del período agrupados por en qué quedaron. El rango se aplica
 * sobre `dispatchedAt`, la misma columna que filtra la bandeja: si acá dice
 * 12 pedidos, el Tablero con las mismas fechas muestra 12.
 */
async function ventasDelPeriodo({ whereBase, fecha_desde, fecha_hasta }) {
  const where = { ...whereBase };
  if (fecha_desde && fecha_hasta) where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
  else if (fecha_desde) where.dispatchedAt = { [Op.gte]: fecha_desde };
  else if (fecha_hasta) where.dispatchedAt = { [Op.lte]: fecha_hasta };

  const filas = await Envio.findAll({
    where,
    attributes: [
      'estado',
      [fn('COUNT', col('id')), 'cantidad'],
      [fn('COALESCE', fn('SUM', col('monto')), 0), 'monto'],
    ],
    group: ['estado'],
    raw: true,
  });
  return agruparVentas(filas);
}

module.exports = {
  FASE_COMPLETADA,
  SIN_FASE,
  LIMITE_PEDIDOS,
  VENTANA_RECOMPRA_DIAS,
  clasificarCuando,
  proximaFaseDerivada,
  armarPendientes,
  filtrar,
  paginar,
  armarTablero,
  agruparVentas,
  conteoPorEtapa,
  vencidosPorEtapa,
  tableroDeSeguimiento,
  pendientesPaginados,
  seguimientoDePedidos,
  ventasDelPeriodo,
};
