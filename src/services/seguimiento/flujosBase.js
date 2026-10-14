'use strict';

/**
 * Las etapas del seguimiento por WhatsApp y el flujo con el que
 * arranca cada una. Toda cuenta tiene siempre un flujo de cada etapa
 * (flujo.service → asegurarFlujosBase): se pueden editar, renombrar o
 * desactivar, y se pueden agregar más, pero no quedarse sin ninguno.
 *
 * A qué etapa pertenece un pedido lo decide su estado, no una persona:
 *   por confirmar            → Confirmación de pedido web, o Venta por
 *                              WhatsApp si el pedido entró por WhatsApp
 *   confirmado … en camino   → Seguimiento de envío
 *   entregado                → Escalamiento de ventas (recompra)
 *   devuelto o perdido       → Recuperación de clientes
 * Cuando el pedido cambia de estado, cambia de etapa solo.
 *
 * Los mensajes son un punto de partida: usan únicamente variables que
 * resuelve plantillaResolver.service.js.
 */

const UN_DIA = 24 * 60;

const ETAPAS = [
  {
    tipo: 'CONFIRMACION_PEDIDO_WEB',
    nombre: 'Confirmación de pedido web',
    descripcion: 'Pedidos nuevos que entraron por la tienda o una landing y todavía no se confirmaron.',
    estados: ['Pendiente', 'EnSeguimiento'],
    fases: [
      { nombre: 'Confirmación', espera: 0, mensaje: 'Hola {cliente_nombre}, te escribimos para confirmar tu pedido #{pedido_id}.\n\nProductos: {productos}\nTotal: {total_gs}\n\n¿Nos confirmás que podemos prepararlo?' },
      { nombre: 'Recordatorio', espera: 4 * 60, mensaje: 'Hola {cliente_nombre}, volvemos a escribirte por tu pedido #{pedido_id}.\n\n¿Nos confirmás si seguimos adelante?' },
      { nombre: 'Último intento', espera: UN_DIA, mensaje: 'Hola {cliente_nombre}, este es nuestro último aviso por tu pedido #{pedido_id}.\n\nSi todavía lo querés recibir, respondé este mensaje y lo preparamos.' },
    ],
  },
  {
    tipo: 'VENTA_WHATSAPP',
    nombre: 'Venta por WhatsApp',
    descripcion: 'Ventas que empezaron en una conversación de WhatsApp y falta cerrarlas.',
    estados: ['Pendiente', 'EnSeguimiento'],
    fases: [
      { nombre: 'Resumen del pedido', espera: 0, mensaje: 'Hola {cliente_nombre}, te paso el resumen de tu pedido #{pedido_id}:\n\n{productos}\nTotal: {total_gs}\n\n¿Lo confirmamos?' },
      { nombre: 'Recordatorio', espera: 4 * 60, mensaje: 'Hola {cliente_nombre}, ¿pudiste ver el resumen de tu pedido #{pedido_id}? Quedamos atentos para confirmarlo.' },
    ],
  },
  {
    tipo: 'SEGUIMIENTO_ENVIO',
    nombre: 'Seguimiento de envío',
    descripcion: 'Pedidos ya confirmados: avisos al cliente mientras se prepara, se despacha y viaja.',
    estados: ['Confirmado', 'Preparado', 'Despachado', 'Reprogramado'],
    fases: [
      { nombre: 'Pedido confirmado', espera: 0, estado_activador: 'Preparado', mensaje: 'Hola {cliente_nombre}, tu pedido #{pedido_id} ha sido confirmado y ahora lo estamos preparando.' },
      { nombre: 'Pedido despachado', espera: 0, estado_activador: 'Despachado', mensaje: 'Hola {cliente_nombre}, tu pedido #{pedido_id} ha sido despachado. Por favor, mantenete atento a tu courier: {courier_nombre}, teléfono {courier_telefono}. Dirección de entrega: {direccion_entrega}.' },
      { nombre: 'Pedido en camino', espera: 0, estado_activador: 'Despachado', mensaje: 'Hola {cliente_nombre}, tu pedido #{pedido_id} está en camino. Tu courier es {courier_nombre}, teléfono {courier_telefono}. Por favor tené el teléfono a mano para coordinar la entrega.' },
    ],
  },
  {
    tipo: 'ESCALAMIENTO_VENTAS',
    nombre: 'Escalamiento de ventas',
    descripcion: 'Pedidos entregados: volver a contactar al cliente para una nueva compra.',
    estados: ['Entregado'],
    // En esta etapa la espera del PRIMER mensaje se cuenta desde la entrega.
    fases: [
      { nombre: '¿Cómo te fue?', espera: 3 * UN_DIA, mensaje: 'Hola {cliente_nombre}, ¿cómo te fue con tu pedido #{pedido_id}? Nos interesa saber si llegó todo bien.' },
      { nombre: 'Nueva compra', espera: 7 * UN_DIA, mensaje: 'Hola {cliente_nombre}, gracias por tu compra. Si querés volver a pedir {productos} u otro producto, escribinos y te lo preparamos.' },
    ],
  },
  {
    tipo: 'RECUPERACION_CLIENTES',
    nombre: 'Recuperación de clientes',
    descripcion: 'Pedidos devueltos o perdidos: atender la incidencia y recuperar la relación con el cliente.',
    estados: ['Devuelto', 'Perdido'],
    fases: [
      { nombre: 'Contacto tras incidencia', espera: 0, mensaje: 'Hola {cliente_nombre}, vimos que hubo un inconveniente con tu pedido #{pedido_id}. ¿Podés contarnos qué pasó para ayudarte?' },
      { nombre: 'Buscar una solución', espera: UN_DIA, mensaje: 'Hola {cliente_nombre}, queremos ayudarte a resolver el inconveniente con tu pedido #{pedido_id}. ¿Cómo te gustaría que sigamos?' },
      { nombre: 'Retomar la compra', espera: 3 * UN_DIA, mensaje: 'Hola {cliente_nombre}, si querés retomar tu compra de {productos}, escribinos y revisamos juntos las opciones disponibles.' },
    ],
  },
];

const TIPOS_DE_ETAPA = ETAPAS.map((e) => e.tipo);
const ETAPA_INICIAL = 'CONFIRMACION_PEDIDO_WEB';

function etapaPorTipo(tipo) {
  return ETAPAS.find((e) => e.tipo === tipo) || null;
}

function esOrigenWhatsapp(origen) {
  return String(origen || '').toUpperCase().includes('WHATSAPP');
}

/** La etapa en la que está un pedido, según su estado (y su origen mientras está por confirmar). */
function etapaDelPedido(pedido) {
  if (['Pendiente', 'EnSeguimiento'].includes(pedido.estado)) {
    return esOrigenWhatsapp(pedido.origen) ? 'VENTA_WHATSAPP' : 'CONFIRMACION_PEDIDO_WEB';
  }
  const etapa = ETAPAS.find((e) => e.tipo !== 'VENTA_WHATSAPP' && e.estados.includes(pedido.estado));
  return etapa ? etapa.tipo : null;
}

module.exports = {
  ETAPAS, TIPOS_DE_ETAPA, ETAPA_INICIAL, etapaPorTipo, etapaDelPedido, esOrigenWhatsapp,
};
