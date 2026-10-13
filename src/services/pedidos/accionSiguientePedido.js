'use strict';

/**
 * La próxima acción operativa de un pedido según su estado: es lo que la
 * bandeja muestra como botón principal de cada fila.
 *
 * Función pura, sin acceso a la base. El circuito es directo
 * (Pendiente → Confirmado → Preparado → Despachado → Entregado → Rendido):
 * el abastecimiento Gesicom por pedido ya no existe (2026-10-11), así que
 * un pedido confirmado se prepara sin pagar ni esperar nada. Las columnas
 * abastecimiento_* de los pedidos viejos no se miran acá a propósito.
 */
function accionSiguientePedido(envioLike) {
  const envio = typeof envioLike.toJSON === 'function' ? envioLike.toJSON() : envioLike;

  // "En seguimiento" es un pendiente al que ya se le escribió: sigue estando
  // por confirmar, y la bandeja tiene que seguir ofreciendo confirmarlo.
  if (envio.estado === 'Pendiente' || envio.estado === 'EnSeguimiento') {
    return {
      tipo: 'confirmar',
      titulo: 'Confirmar pedido',
      descripcion: 'Validar datos, dirección y disponibilidad antes de mover stock.',
      cta: 'Completar datos',
      tono: 'warning',
      siguiente_estado: 'Confirmado',
      prioridad: 10,
    };
  }

  if (envio.estado === 'Confirmado') {
    return {
      tipo: 'preparar',
      titulo: 'Preparar pedido',
      descripcion: 'Separar, embalar y dejar listo para enviar.',
      cta: 'Preparar',
      tono: 'info',
      siguiente_estado: 'Preparado',
      prioridad: 40,
    };
  }

  if (envio.estado === 'Preparado') {
    return {
      tipo: 'despachar',
      titulo: 'Despachar pedido',
      descripcion: 'Asignar salida con courier o entrega propia.',
      cta: 'Despachar',
      tono: 'info',
      siguiente_estado: 'Despachado',
      prioridad: 50,
    };
  }

  if (envio.estado === 'Despachado' || envio.estado === 'Reprogramado') {
    return {
      tipo: 'resultado_entrega',
      titulo: 'Gestionar resultado de entrega',
      descripcion: 'Marcar entregado, reprogramado, devuelto o perdido segun corresponda.',
      cta: 'Actualizar resultado',
      tono: 'warning',
      prioridad: 60,
    };
  }

  if (envio.estado === 'Entregado' && envio.estado_financiero === 'pendiente_liquidacion') {
    return {
      tipo: 'rendir',
      titulo: 'Rendir dinero del pedido',
      descripcion: 'Cerrar la liquidacion pendiente.',
      cta: 'Rendir',
      tono: 'success',
      prioridad: 70,
    };
  }

  return {
    tipo: 'cerrado',
    titulo: 'Sin acciones pendientes',
    descripcion: 'El pedido no requiere una accion operativa ahora.',
    cta: null,
    tono: 'neutral',
    prioridad: 999,
  };
}

module.exports = { accionSiguientePedido };
