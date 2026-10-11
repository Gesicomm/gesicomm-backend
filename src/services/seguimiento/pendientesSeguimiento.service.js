'use strict';

/**
 * Qué mensaje de WhatsApp le toca a cada pedido, y cuándo. Alimenta la
 * pestaña Resumen de Pedidos ("mensajes por enviar", agrupados por fase).
 *
 * Una sola función arma la lista (`armarPendientes`) y de esa misma lista
 * salen los números del tablero (`resumirPorFase`): la tarjeta que dice
 * "Fase 2 · 5 para enviar ahora" y la cola que se abre al tocarla no pueden
 * dar números distintos porque no hay dos cálculos.
 *
 * De dónde sale la fase de cada pedido:
 *  1. Del recordatorio abierto, si se agendó eligiendo fase (`fase_id`).
 *  2. Si no, se deriva del historial: la fase siguiente a la más avanzada que
 *     ya se abrió en el flujo que se venía usando con ese pedido.
 *  3. Un pedido que nunca se contactó arranca en la primera fase del flujo
 *     predeterminado para su origen.
 * No hay ninguna "fase actual" guardada en el pedido: esto es una sugerencia
 * de qué mandar, no un estado. La fase se puede reenviar igual.
 *
 * Cuándo:
 *  - ahora      → el recordatorio venció o le llegó la hora, o el pedido es
 *                 nuevo y todavía no se le escribió nunca.
 *  - hoy        → recordatorio para más tarde, hoy.
 *  - despues    → recordatorio para otro día.
 *  - sin_fecha  → ya se le escribió y no quedó ningún recordatorio agendado.
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
// Tope de pedidos que entran al tablero. Si se pasa, la respuesta avisa con
// `truncado` en vez de mostrar un número que parece completo y no lo es.
const LIMITE_PEDIDOS = 500;

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
 * La fase siguiente a la más avanzada que ya se abrió. Sin ninguna abierta,
 * la primera. Con la última ya abierta, null: el flujo se terminó y lo que
 * sigue lo decide el operador.
 */
function proximaFaseDerivada(flujo, faseIdsAbiertas) {
  const fases = fasesOrdenadas(flujo);
  let mayorOrdenAbierto = 0;
  for (const fase of fases) {
    if (faseIdsAbiertas.has(fase.id)) mayorOrdenAbierto = Math.max(mayorOrdenAbierto, fase.orden);
  }
  return fases.find((f) => f.orden > mayorOrdenAbierto) || null;
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
 * @param {object[]} aperturas      { envio_id, flujo_id, fase_id, veces, ultimo }
 * @param {object[]} itemsPedido    { envio_id, nombre_producto, cantidad }
 * @param {object[]} flujos         activos, con sus fases
 */
function armarPendientes({ pedidos, recordatorios, aperturas, itemsPedido = [], flujos, ahora = new Date() }) {
  const agrupar = (filas, clave) => filas.reduce((mapa, fila) => {
    const k = Number(fila[clave]);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(fila);
    return mapa;
  }, new Map());

  const recordatoriosPorPedido = agrupar(recordatorios, 'envio_id');
  const aperturasPorPedido = agrupar(aperturas, 'envio_id');
  const itemsPorPedido = agrupar(itemsPedido, 'envio_id');
  const flujosPorUsuario = agrupar(flujos, 'usuario_id');

  const items = pedidos.map((pedido) => {
    const recordatorio = elegirRecordatorioVigente(recordatoriosPorPedido.get(Number(pedido.id)) || []);
    const abiertas = aperturasPorPedido.get(Number(pedido.id)) || [];
    const flujosDelUsuario = flujosPorUsuario.get(Number(pedido.usuario_id)) || [];
    const flujoPorId = new Map(flujosDelUsuario.map((f) => [Number(f.id), f]));

    let flujo = null;
    let fase = null;
    let faseOrigen = null;

    // 1. La fase que se eligió al agendar.
    if (recordatorio?.fase_id) {
      for (const candidato of flujosDelUsuario) {
        const encontrada = fasesOrdenadas(candidato).find((f) => Number(f.id) === Number(recordatorio.fase_id));
        if (encontrada) { flujo = candidato; fase = encontrada; faseOrigen = 'recordatorio'; break; }
      }
    }

    // 2. y 3. Derivada del historial, o la primera del flujo predeterminado.
    if (!fase) {
      const ultimaApertura = [...abiertas].sort((a, b) => new Date(b.ultimo) - new Date(a.ultimo))[0];
      flujo = flujoPorId.get(Number(recordatorio?.flujo_id))
        || flujoPorId.get(Number(ultimaApertura?.flujo_id))
        || flujoPredeterminado(flujosDelUsuario, pedido.origen);
      if (flujo) {
        const abiertasDelFlujo = new Set(
          abiertas.filter((a) => Number(a.flujo_id) === Number(flujo.id)).map((a) => Number(a.fase_id)),
        );
        fase = proximaFaseDerivada(flujo, abiertasDelFlujo);
        faseOrigen = fase ? 'derivada' : null;
      }
    }

    let cuando;
    let motivo;
    if (recordatorio) {
      cuando = clasificarCuando(recordatorio, ahora);
      motivo = cuando === 'ahora' ? 'vencido' : 'programado';
    } else if (abiertas.length === 0) {
      cuando = 'ahora';
      motivo = 'nuevo';
    } else {
      cuando = 'sin_fecha';
      motivo = 'sin_agendar';
    }

    const ultimoContacto = abiertas.reduce(
      (max, a) => (!max || new Date(a.ultimo) > new Date(max) ? a.ultimo : max), null,
    );

    return {
      envio_id: pedido.id,
      numero_pedido: pedido.numero_pedido || pedido.id,
      estado: pedido.estado,
      cliente: nombreCliente(pedido),
      telefono: pedido.telefono || null,
      ciudad: pedido.ciudad || null,
      monto: Number(pedido.monto) || 0,
      productos: resumenProductos(itemsPorPedido.get(Number(pedido.id))),
      creado_en: pedido.created_at || pedido.createdAt || null,
      flujo_id: flujo && fase ? flujo.id : null,
      flujo_nombre: flujo && fase ? flujo.nombre : null,
      fase_id: fase?.id || null,
      fase_orden: fase?.orden || null,
      fase_nombre: fase?.nombre || null,
      fase_origen: faseOrigen,
      cuando,
      motivo,
      recordatorio: recordatorio ? {
        id: recordatorio.id,
        estado: recordatorio.estado,
        ejecutar_en: recordatorio.ejecutar_en,
        nota: recordatorio.nota || null,
      } : null,
      ultimo_contacto_en: ultimoContacto,
      aperturas: abiertas.reduce((acc, a) => acc + Number(a.veces || 0), 0),
    };
  });

  // Lo más urgente primero; dentro de cada grupo, lo que hace más que espera.
  const referencia = (item) => new Date(item.recordatorio?.ejecutar_en || item.ultimo_contacto_en || item.creado_en || 0).getTime();
  return items.sort((a, b) => (
    CUANDO.indexOf(a.cuando) - CUANDO.indexOf(b.cuando) || referencia(a) - referencia(b)
  ));
}

const contadorVacio = () => ({ ahora: 0, hoy: 0, despues: 0, sin_fecha: 0 });

/**
 * Los números del tablero, contados sobre la MISMA lista que después se
 * muestra como cola. Devuelve los flujos que tienen algo pendiente; si no
 * hay nada pendiente en ninguno, el predeterminado con sus fases en cero
 * para que el tablero no quede vacío.
 */
function resumirPorFase(items, flujos) {
  const totales = contadorVacio();
  const sinFase = contadorVacio();
  const porFase = new Map();

  for (const item of items) {
    totales[item.cuando] += 1;
    if (!item.fase_id) { sinFase[item.cuando] += 1; continue; }
    if (!porFase.has(Number(item.fase_id))) porFase.set(Number(item.fase_id), contadorVacio());
    porFase.get(Number(item.fase_id))[item.cuando] += 1;
  }

  const conPendientes = new Set(items.map((i) => Number(i.flujo_id)).filter(Boolean));
  let visibles = flujos.filter((f) => conPendientes.has(Number(f.id)));
  if (visibles.length === 0) {
    const porDefecto = flujoPredeterminado(flujos, null);
    visibles = porDefecto ? [porDefecto] : [];
  }

  return {
    totales,
    sin_fase: sinFase,
    flujos: visibles.map((flujo) => ({
      id: flujo.id,
      nombre: flujo.nombre,
      fases: fasesOrdenadas(flujo).map((fase) => ({
        id: fase.id,
        orden: fase.orden,
        nombre: fase.nombre,
        espera_sugerida_minutos: fase.espera_sugerida_minutos || 0,
        ...(porFase.get(Number(fase.id)) || contadorVacio()),
      })),
    })),
  };
}

/**
 * Pedidos que entran al tablero: los que todavía están por confirmar y
 * cualquier otro que tenga un recordatorio abierto, siempre que el pedido no
 * haya cerrado. `whereBase` trae el alcance (cuenta + tienda activa) ya
 * resuelto por el controller.
 */
async function pendientesDeSeguimiento({ whereBase, usuarioId, esAdmin, ahora = new Date() }) {
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

  if (ids.length === 0) {
    return { ...resumirPorFase([], flujos), items: [], truncado: false };
  }

  const [recordatorios, aperturas, itemsPedido] = await Promise.all([
    SeguimientoRecordatorio.findAll({
      where: { envio_id: { [Op.in]: ids }, estado: { [Op.in]: ESTADOS_ABIERTOS } },
      attributes: ['id', 'envio_id', 'estado', 'ejecutar_en', 'nota', 'flujo_id', 'fase_id'],
      raw: true,
    }),
    SeguimientoContacto.findAll({
      where: { envio_id: { [Op.in]: ids }, fase_id: { [Op.ne]: null } },
      attributes: [
        'envio_id', 'flujo_id', 'fase_id',
        [fn('COUNT', col('id')), 'veces'],
        [fn('MAX', col('created_at')), 'ultimo'],
      ],
      group: ['envio_id', 'flujo_id', 'fase_id'],
      raw: true,
    }),
    EnvioItem.findAll({
      where: { envio_id: { [Op.in]: ids } },
      attributes: ['envio_id', 'nombre_producto', 'cantidad'],
      order: [['id', 'ASC']],
      raw: true,
    }),
  ]);

  const items = armarPendientes({ pedidos, recordatorios, aperturas, itemsPedido, flujos, ahora });
  return { ...resumirPorFase(items, flujos), items, truncado };
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
  LIMITE_PEDIDOS,
  clasificarCuando,
  proximaFaseDerivada,
  armarPendientes,
  resumirPorFase,
  agruparVentas,
  pendientesDeSeguimiento,
  ventasDelPeriodo,
};
