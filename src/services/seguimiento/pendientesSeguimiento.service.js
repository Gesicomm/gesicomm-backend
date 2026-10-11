'use strict';

/**
 * En qué mensaje del flujo está cada pedido, y cuándo toca. Alimenta el
 * tablero Kanban de la pestaña Resumen de Pedidos (una columna por fase).
 *
 * En qué fase está un pedido:
 *  - La fase avanza SOLO cuando el operador la marca como completada
 *    ("envié el mensaje"). Abrir WhatsApp no mueve nada: con un enlace wa.me
 *    no se sabe si el mensaje salió, así que lo confirma la persona.
 *  - La fase del pedido es la siguiente a la más avanzada que tiene
 *    completada, dentro del flujo que se viene usando con ese pedido.
 *  - Un recordatorio agendado eligiendo fase manda sobre eso (es lo que el
 *    operador dijo que iba a mandar).
 *  - Un pedido sin nada completado está en la primera fase del flujo
 *    predeterminado para su origen.
 *  - Con todas las fases completadas no queda fase: va a "Flujo terminado".
 * Esto se deriva de seguimiento_contactos; no hay puntero guardado en el
 * pedido. Completar una fase no impide volver a abrirla ni reenviarla.
 *
 * Cuándo:
 *  - ahora      → venció el recordatorio o le llegó la hora, o el pedido
 *                 todavía no tiene ninguna fase completada.
 *  - hoy        → recordatorio para más tarde, hoy.
 *  - despues    → recordatorio para otro día.
 *  - sin_fecha  → ya tiene fases completadas y no quedó recordatorio.
 *
 * El filtrado y la paginación se resuelven acá, nunca en el frontend: el
 * tablero pide cada columna por página y los contadores salen de la misma
 * lista que se pagina, así una columna que dice 37 tiene 37 tarjetas.
 */
const { Op, fn, col, literal } = require('sequelize');
const {
  Envio, EnvioItem, SeguimientoRecordatorio, SeguimientoContacto,
} = require('../../models');
const flujoService = require('./flujo.service');
const {
  ESTADOS_ABIERTOS, ESTADOS_PEDIDO_CERRADO, elegirRecordatorioVigente,
} = require('./seguimientoRecordatorio.service');

const ZONA_HORARIA = 'America/Asuncion';
const ESTADOS_POR_CONFIRMAR = ['Pendiente', 'EnSeguimiento'];
const CUANDO = ['ahora', 'hoy', 'despues', 'sin_fecha'];
// Estado del contacto cuando el operador confirma que mandó el mensaje.
const FASE_COMPLETADA = 'CONFIRMADO_POR_OPERADOR';
const SIN_FASE = 'sin_fase';
// Tope de pedidos abiertos que se evalúan. Si se pasa, la respuesta avisa con
// `truncado` en vez de mostrar números que parecen completos y no lo son.
const LIMITE_PEDIDOS = 2000;
const LIMITE_POR_PAGINA_MAXIMO = 50;

/** Fecha de calendario en Paraguay (YYYY-MM-DD) de un instante. */
function fechaLocal(instante) {
  return new Date(instante).toLocaleDateString('sv-SE', { timeZone: ZONA_HORARIA });
}

function clasificarCuando(recordatorio, ahora) {
  const hora = new Date(recordatorio.ejecutar_en);
  if (recordatorio.estado === 'VENCIDO' || hora.getTime() <= ahora.getTime()) return 'ahora';
  return fechaLocal(hora) === fechaLocal(ahora) ? 'hoy' : 'despues';
}

function fasesOrdenadas(flujo) {
  return [...(flujo?.fases || [])]
    .filter((f) => f.activo !== false)
    .sort((a, b) => a.orden - b.orden);
}

/**
 * La fase siguiente a la más avanzada que ya está completada. Sin ninguna
 * completada, la primera. Con la última completada, null: el flujo terminó.
 */
function proximaFaseDerivada(flujo, faseIdsCompletadas) {
  const fases = fasesOrdenadas(flujo);
  let mayorOrdenCompletado = 0;
  for (const fase of fases) {
    if (faseIdsCompletadas.has(Number(fase.id))) mayorOrdenCompletado = Math.max(mayorOrdenCompletado, fase.orden);
  }
  return fases.find((f) => f.orden > mayorOrdenCompletado) || null;
}

/** Mismo criterio que usa la bandeja para rotular el flujo de un pedido. */
function tipoDeFlujoPorOrigen(origen) {
  return String(origen || '').toUpperCase().includes('WHATSAPP') ? 'VENTA_WHATSAPP' : 'CONFIRMACION_PEDIDO_WEB';
}

function flujoPredeterminado(flujos, origen) {
  const tipo = tipoDeFlujoPorOrigen(origen);
  return flujos.find((f) => f.predeterminado && f.tipo === tipo)
    || flujos.find((f) => f.tipo === tipo)
    || flujos.find((f) => f.predeterminado)
    || flujos[0]
    || null;
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
 * Arma un ítem por pedido. Función pura: recibe filas planas y no toca la
 * base, para poder probar las reglas de arriba sin ella.
 *
 * @param {object[]} pedidos
 * @param {object[]} recordatorios  solo los abiertos (PENDIENTE / VENCIDO)
 * @param {object[]} contactos      agrupados: { envio_id, flujo_id, fase_id, estado, veces, ultimo }
 * @param {object[]} flujos         activos, con sus fases
 */
function armarPendientes({ pedidos, recordatorios, contactos, flujos, ahora = new Date() }) {
  const agrupar = (filas, clave) => filas.reduce((mapa, fila) => {
    const k = Number(fila[clave]);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(fila);
    return mapa;
  }, new Map());

  const recordatoriosPorPedido = agrupar(recordatorios, 'envio_id');
  const contactosPorPedido = agrupar(contactos, 'envio_id');
  const flujosPorUsuario = agrupar(flujos, 'usuario_id');

  const items = pedidos.map((pedido) => {
    const recordatorio = elegirRecordatorioVigente(recordatoriosPorPedido.get(Number(pedido.id)) || []);
    const delPedido = contactosPorPedido.get(Number(pedido.id)) || [];
    const completados = delPedido.filter((c) => c.estado === FASE_COMPLETADA);
    const flujosDelUsuario = flujosPorUsuario.get(Number(pedido.usuario_id)) || [];
    const flujoPorId = new Map(flujosDelUsuario.map((f) => [Number(f.id), f]));

    let flujo = null;
    let fase = null;
    let faseOrigen = null;

    // La fase que se eligió al agendar manda.
    if (recordatorio?.fase_id) {
      for (const candidato of flujosDelUsuario) {
        const encontrada = fasesOrdenadas(candidato).find((f) => Number(f.id) === Number(recordatorio.fase_id));
        if (encontrada) { flujo = candidato; fase = encontrada; faseOrigen = 'recordatorio'; break; }
      }
    }

    // Si no, la siguiente a la última completada (o la primera del flujo).
    if (!fase) {
      const ultimoContacto = [...delPedido].sort((a, b) => new Date(b.ultimo) - new Date(a.ultimo))[0];
      flujo = flujoPorId.get(Number(recordatorio?.flujo_id))
        || flujoPorId.get(Number(ultimoContacto?.flujo_id))
        || flujoPredeterminado(flujosDelUsuario, pedido.origen);
      if (flujo) {
        const completadasDelFlujo = new Set(
          completados.filter((c) => Number(c.flujo_id) === Number(flujo.id)).map((c) => Number(c.fase_id)),
        );
        fase = proximaFaseDerivada(flujo, completadasDelFlujo);
        faseOrigen = fase ? 'derivada' : null;
      }
    }

    // WhatsApp abierto en la fase actual y todavía sin marcar como completada.
    const abiertaSinCompletar = fase
      ? delPedido.find((c) => Number(c.fase_id) === Number(fase.id) && c.estado !== FASE_COMPLETADA)
      : null;

    let cuando;
    let motivo;
    if (recordatorio) {
      cuando = clasificarCuando(recordatorio, ahora);
      motivo = cuando === 'ahora' ? 'vencido' : 'programado';
    } else if (completados.length === 0) {
      cuando = 'ahora';
      motivo = 'nuevo';
    } else {
      cuando = 'sin_fecha';
      motivo = 'sin_agendar';
    }

    const ultimaCompletada = completados.reduce(
      (max, c) => (!max || new Date(c.ultimo) > new Date(max) ? c.ultimo : max), null,
    );

    return {
      envio_id: pedido.id,
      numero_pedido: pedido.numero_pedido || pedido.id,
      estado: pedido.estado,
      cliente: nombreCliente(pedido),
      telefono: pedido.telefono || null,
      ciudad: pedido.ciudad || null,
      monto: Number(pedido.monto) || 0,
      productos: '',
      creado_en: pedido.created_at || pedido.createdAt || null,
      flujo_id: flujo ? flujo.id : null,
      flujo_nombre: flujo ? flujo.nombre : null,
      fase_id: fase?.id || null,
      fase_orden: fase?.orden || null,
      fase_nombre: fase?.nombre || null,
      fase_origen: faseOrigen,
      fase_abierta_en: abiertaSinCompletar?.ultimo || null,
      cuando,
      motivo,
      recordatorio: recordatorio ? {
        id: recordatorio.id,
        estado: recordatorio.estado,
        ejecutar_en: recordatorio.ejecutar_en,
        nota: recordatorio.nota || null,
      } : null,
      ultima_fase_completada_en: ultimaCompletada,
    };
  });

  // Lo más urgente primero; dentro de cada grupo, lo que hace más que espera.
  const referencia = (item) => new Date(item.recordatorio?.ejecutar_en || item.ultima_fase_completada_en || item.creado_en || 0).getTime();
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
    || String(item.numero_pedido) === sinNumeral
    || (soloDigitos.length >= 4 && String(item.telefono || '').replace(/\D/g, '').includes(soloDigitos));
}

/** Filtros que llegan del frontend, aplicados en el servidor. */
function filtrar(items, { flujo_id, fase, cuando, busqueda } = {}) {
  return items.filter((item) => {
    if (flujo_id && Number(item.flujo_id) !== Number(flujo_id)) return false;
    if (fase !== undefined && fase !== null && fase !== '' && claveDeColumna(item) !== String(fase)) return false;
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
 * El tablero de un flujo: una columna por fase (más "Flujo terminado" si hay
 * pedidos ahí), cada una con su propia página.
 *
 * Los filtros `cuando` y `busqueda` achican las tarjetas de las columnas;
 * `conteo` de cada columna y `totales` son siempre sobre todo lo pendiente
 * del flujo, para que el encabezado no cambie al filtrar.
 */
function armarTablero(items, flujos, { flujo_id, cuando, busqueda, paginas = {}, limit } = {}) {
  const conPendientes = new Set(items.map((i) => Number(i.flujo_id)).filter(Boolean));
  const elegido = flujos.find((f) => Number(f.id) === Number(flujo_id))
    || flujos.find((f) => conPendientes.has(Number(f.id)))
    || flujoPredeterminado(flujos, null);

  // Los pedidos sin flujo (cuenta sin flujos) no entran en ningún tablero.
  const delFlujo = elegido ? items.filter((i) => Number(i.flujo_id) === Number(elegido.id)) : [];
  const filtrados = filtrar(delFlujo, { cuando, busqueda });

  const columna = (clave, datos) => {
    const todos = delFlujo.filter((i) => claveDeColumna(i) === clave);
    const visibles = filtrados.filter((i) => claveDeColumna(i) === clave);
    return { clave, ...datos, conteo: contar(todos), ...paginar(visibles, { page: paginas[clave], limit }) };
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
      pendientes: items.filter((i) => Number(i.flujo_id) === Number(f.id)).length,
    })),
    flujo_id: elegido?.id || null,
    totales: contar(delFlujo),
    columnas,
  };
}

/**
 * Pedidos que entran al seguimiento: los que todavía están por confirmar y
 * cualquier otro que tenga un recordatorio abierto, siempre que el pedido no
 * haya cerrado. `whereBase` trae el alcance (cuenta + tienda activa) ya
 * resuelto por el controller.
 */
async function cargarPendientes({ whereBase, usuarioId, esAdmin, ahora = new Date() }) {
  const filas = await Envio.findAll({
    where: {
      ...whereBase,
      [Op.and]: [
        ...(whereBase[Op.and] || []),
        { estado: { [Op.notIn]: ESTADOS_PEDIDO_CERRADO } },
        {
          [Op.or]: [
            { estado: { [Op.in]: ESTADOS_POR_CONFIRMAR } },
            literal(`EXISTS (
              SELECT 1 FROM seguimiento_recordatorios sr
              WHERE sr.envio_id = "Envio"."id" AND sr.estado IN ('PENDIENTE', 'VENCIDO')
            )`),
          ],
        },
      ],
    },
    attributes: [
      'id', 'numero_pedido', 'usuario_id', 'estado', 'origen', 'monto',
      'nombre_cliente', 'apellido_cliente', 'cliente', 'telefono', 'ciudad', 'created_at',
    ],
    order: [['id', 'DESC']],
    limit: LIMITE_PEDIDOS + 1,
    raw: true,
  });

  const truncado = filas.length > LIMITE_PEDIDOS;
  const pedidos = truncado ? filas.slice(0, LIMITE_PEDIDOS) : filas;
  const ids = pedidos.map((p) => p.id);

  const flujos = (await flujoService.listarFlujos({ usuarioId, esAdmin, soloActivos: true }))
    .map((f) => (typeof f.toJSON === 'function' ? f.toJSON() : f));

  if (ids.length === 0) return { items: [], flujos, truncado: false };

  const [recordatorios, contactos] = await Promise.all([
    SeguimientoRecordatorio.findAll({
      where: { envio_id: { [Op.in]: ids }, estado: { [Op.in]: ESTADOS_ABIERTOS } },
      attributes: ['id', 'envio_id', 'estado', 'ejecutar_en', 'nota', 'flujo_id', 'fase_id'],
      raw: true,
    }),
    SeguimientoContacto.findAll({
      where: { envio_id: { [Op.in]: ids }, fase_id: { [Op.ne]: null } },
      attributes: [
        'envio_id', 'flujo_id', 'fase_id', 'estado',
        [fn('COUNT', col('id')), 'veces'],
        [fn('MAX', col('created_at')), 'ultimo'],
      ],
      group: ['envio_id', 'flujo_id', 'fase_id', 'estado'],
      raw: true,
    }),
  ]);

  return { items: armarPendientes({ pedidos, recordatorios, contactos, flujos, ahora }), flujos, truncado };
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

/** POST /envios/seguimiento/tablero */
async function tableroDeSeguimiento({ whereBase, usuarioId, esAdmin, filtros = {}, ahora }) {
  const { items, flujos, truncado } = await cargarPendientes({ whereBase, usuarioId, esAdmin, ahora });
  const tablero = armarTablero(items, flujos, filtros);
  await completarProductos(tablero.columnas.flatMap((c) => c.data));
  return { ...tablero, truncado };
}

/** POST /envios/seguimiento/pendientes — lista paginada, sin separar por columna. */
async function pendientesPaginados({ whereBase, usuarioId, esAdmin, filtros = {}, ahora }) {
  const { items, truncado } = await cargarPendientes({ whereBase, usuarioId, esAdmin, ahora });
  const pagina = paginar(filtrar(items, filtros), filtros);
  await completarProductos(pagina.data);
  return { ...pagina, truncado };
}

/** Solo los totales, para el encabezado del Resumen. */
async function totalesDeSeguimiento({ whereBase, usuarioId, esAdmin, ahora }) {
  const { items, truncado } = await cargarPendientes({ whereBase, usuarioId, esAdmin, ahora });
  return { totales: contar(items), truncado };
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
  clasificarCuando,
  proximaFaseDerivada,
  armarPendientes,
  filtrar,
  paginar,
  armarTablero,
  agruparVentas,
  tableroDeSeguimiento,
  pendientesPaginados,
  totalesDeSeguimiento,
  ventasDelPeriodo,
};
