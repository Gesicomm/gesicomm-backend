'use strict';

function estadoActivadorDeFase(fase, tipo) {
  return fase?.estado_activador || fase?.transicion_estado_hasta
    || (fase?.accion_operativa === 'PREPARAR_PEDIDO' ? 'Preparado'
      : ['DESPACHAR_PEDIDO', 'AVISO_EN_CAMINO'].includes(fase?.accion_operativa) ? 'Despachado'
        : tipo === 'ESCALAMIENTO_VENTAS' ? 'Entregado' : null);
}

function faseDisponibleParaPedido(fase, pedido, tipo) {
  if (tipo === 'RECUPERACION_CLIENTES' && !['Devuelto', 'Perdido'].includes(pedido.estado)) return false;
  if (tipo === 'ESCALAMIENTO_VENTAS' && pedido.estado !== 'Entregado') return false;
  if (tipo === 'SEGUIMIENTO_ENVIO' && !['Preparado', 'Despachado', 'Reprogramado'].includes(pedido.estado)) return false;
  const requerido = estadoActivadorDeFase(fase, tipo);
  if (!requerido) return true;
  if (requerido === 'Preparado') return pedido.estado === 'Preparado';
  if (requerido === 'Despachado') return ['Despachado', 'Reprogramado'].includes(pedido.estado);
  return pedido.estado === requerido;
}

function faseSuperadaPorLogistica(fase, pedido, tipo) {
  return tipo === 'SEGUIMIENTO_ENVIO' && estadoActivadorDeFase(fase) === 'Preparado'
    && ['Despachado', 'Reprogramado'].includes(pedido?.estado);
}

module.exports = { estadoActivadorDeFase, faseDisponibleParaPedido, faseSuperadaPorLogistica };
