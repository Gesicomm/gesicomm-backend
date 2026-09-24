'use strict';

const { Usuario, Notificacion } = require('../../models');
const { UniqueConstraintError } = require('sequelize');
const { idsDeAdministradores, notificarEnApp } = require('./pedidosNotificaciones.service');
const { logger } = require('../../utils/logger');

/**
 * Avisa in-app a los administradores cuando un comercio confirma el envio de
 * un ingreso de inventario (BORRADOR -> PENDIENTE_ENVIO). Antes de esto
 * nada le avisaba a Gesicomm que habia un ingreso nuevo esperando ser
 * recibido — la bandeja /fulfillment/ingresos existia pero nadie sabia
 * cuando revisarla.
 *
 * Mismo patron que pedidosNotificaciones.service.js: la unique
 * (usuario_id, tipo, entidad_tipo, entidad_id) evita duplicar el aviso si
 * este metodo se llama mas de una vez para el mismo ingreso (reintentos,
 * doble click, etc.), y notificarEnApp ya absorbe ese choque sin romper el
 * fan-out al resto de los admins.
 */
async function notificarIngresoConfirmado(ingreso) {
  const usuario = await Usuario.findByPk(ingreso.usuario_id, { attributes: ['id', 'nombre', 'inquilino_id'] });
  if (!usuario) return;

  const adminIds = await idsDeAdministradores(usuario.inquilino_id);
  const totalUnidades = (ingreso.items || []).reduce((acc, it) => acc + (Number(it.cantidad_declarada) || 0), 0);
  const nombreComercio = usuario.nombre || `Usuario #${usuario.id}`;

  await notificarEnApp(adminIds, {
    tipo: 'INGRESO_INVENTARIO_CONFIRMADO',
    entidad_tipo: 'ingreso_inventario',
    entidad_id: ingreso.id,
    titulo: 'Nuevo ingreso de stock a preparar',
    mensaje: `${nombreComercio} confirmó el envío de ING-${String(ingreso.id).padStart(4, '0')} (${totalUnidades} u.) hacia un centro de Gesicomm.`,
  });
}

function notificarIngresoConfirmadoSinBloquear(ingreso) {
  setImmediate(() => {
    notificarIngresoConfirmado(ingreso).catch((error) => {
      logger.error({
        mensaje: '[InventarioNotificaciones] Error notificando ingreso confirmado.',
        ingresoId: ingreso?.id,
        error: error.message,
      });
    });
  });
}

/**
 * Avisa a los administradores cuando el comercio sube el comprobante de una
 * solicitud de abastecimiento (Camino 3: producto del catalogo Gesicomm
 * hacia deposito propio o Centro Gesicomm). Tipo propio y distinto del de
 * ingresos/comprobantes de pedidos: nunca reusar un tipo generico para
 * varios eventos, o el constraint unico bloquearia avisos legitimos
 * posteriores sobre la misma solicitud.
 */
async function notificarSolicitudAbastecimientoComprobanteSubido(solicitud) {
  const usuario = await Usuario.findByPk(solicitud.usuario_id, { attributes: ['id', 'nombre', 'inquilino_id'] });
  if (!usuario) return;

  const adminIds = await idsDeAdministradores(usuario.inquilino_id);
  const nombreComercio = usuario.nombre || `Usuario #${usuario.id}`;
  const total = (Number(solicitud.costo_producto) || 0) + (Number(solicitud.costo_logistico) || 0);

  await notificarEnApp(adminIds, {
    tipo: 'SOLICITUD_ABASTECIMIENTO_COMPROBANTE_SUBIDO',
    entidad_tipo: 'solicitud_abastecimiento',
    entidad_id: solicitud.id,
    titulo: 'Nuevo pago de abastecimiento a validar',
    mensaje: `${nombreComercio} envió el comprobante de la solicitud #${solicitud.id} por Gs. ${Math.round(total).toLocaleString('es-PY')}.`,
  });
}

function notificarSolicitudAbastecimientoComprobanteSubidoSinBloquear(solicitud) {
  setImmediate(() => {
    notificarSolicitudAbastecimientoComprobanteSubido(solicitud).catch((error) => {
      logger.error({
        mensaje: '[InventarioNotificaciones] Error notificando comprobante de solicitud de abastecimiento.',
        solicitudId: solicitud?.id,
        error: error.message,
      });
    });
  });
}

/** Avisa in-app al comercio dueño de la solicitud cuando el admin rechaza el comprobante. */
async function notificarSolicitudAbastecimientoRechazada(solicitud, motivo) {
  try {
    await Notificacion.create({
      usuario_id: solicitud.usuario_id,
      tipo: 'SOLICITUD_ABASTECIMIENTO_PAGO_RECHAZADO',
      entidad_tipo: 'solicitud_abastecimiento',
      entidad_id: solicitud.id,
      titulo: 'Comprobante de pago rechazado',
      mensaje: `Tu solicitud de abastecimiento #${solicitud.id}: ${motivo}`,
    });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
  }
}

function notificarSolicitudAbastecimientoRechazadaSinBloquear(solicitud, motivo) {
  setImmediate(() => {
    notificarSolicitudAbastecimientoRechazada(solicitud, motivo).catch((error) => {
      logger.error({
        mensaje: '[InventarioNotificaciones] Error notificando rechazo de solicitud de abastecimiento.',
        solicitudId: solicitud?.id,
        error: error.message,
      });
    });
  });
}

module.exports = {
  notificarIngresoConfirmado,
  notificarIngresoConfirmadoSinBloquear,
  notificarSolicitudAbastecimientoComprobanteSubido,
  notificarSolicitudAbastecimientoComprobanteSubidoSinBloquear,
  notificarSolicitudAbastecimientoRechazada,
  notificarSolicitudAbastecimientoRechazadaSinBloquear,
};
