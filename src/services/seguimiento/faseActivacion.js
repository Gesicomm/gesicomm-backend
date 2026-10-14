'use strict';
const { estadoParaSeguimiento } = require('./estadoPedido');

function estadoActivadorDeFase(fase, tipo) {
  const configurado = fase?.estado_activador || fase?.transicion_estado_hasta
    || (fase?.accion_operativa === 'PREPARAR_PEDIDO' ? 'Preparado'
      : ['DESPACHAR_PEDIDO', 'AVISO_EN_CAMINO'].includes(fase?.accion_operativa) ? 'Despachado'
        : tipo === 'ESCALAMIENTO_VENTAS' ? 'Entregado' : null);
  if (configurado) return configurado;
  // Flujos anteriores al estado activador: reconocer los avisos base sin
  // depender de que la reparación de sus filas ya haya sido persistida.
  if ((tipo || fase?.flujo?.tipo) !== 'SEGUIMIENTO_ENVIO') return null;
  const nombre = String(fase?.nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/confirm|prepar/.test(nombre)) return 'Preparado';
  if (/despach|camino/.test(nombre)) return 'Despachado';
  return null;
}

function faseDisponibleParaPedido(fase, pedido, tipo) {
  const estado = estadoParaSeguimiento(pedido);
  if (tipo === 'RECUPERACION_CLIENTES' && !['Devuelto', 'Perdido'].includes(estado)) return false;
  if (tipo === 'ESCALAMIENTO_VENTAS' && estado !== 'Entregado') return false;
  if (tipo === 'SEGUIMIENTO_ENVIO' && !['Preparado', 'Despachado', 'Reprogramado'].includes(estado)) return false;
  const requerido = estadoActivadorDeFase(fase, tipo);
  if (!requerido) return true;
  if (requerido === 'Preparado') return estado === 'Preparado';
  if (requerido === 'Despachado') return ['Despachado', 'Reprogramado'].includes(estado);
  return estado === requerido;
}

function faseSuperadaPorLogistica(fase, pedido, tipo) {
  return tipo === 'SEGUIMIENTO_ENVIO' && estadoActivadorDeFase(fase, tipo) === 'Preparado'
    && ['Despachado', 'Reprogramado'].includes(estadoParaSeguimiento(pedido));
}

module.exports = { estadoActivadorDeFase, faseDisponibleParaPedido, faseSuperadaPorLogistica };
