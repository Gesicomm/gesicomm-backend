'use strict';

const { sequelize, IngresoInventario, IngresoInventarioItem, HistorialIngresoInventario, InventarioUbicacion, Deposito, Producto, ProductoVariante, Usuario } = require('../models');
const { notificarIngresoConfirmadoSinBloquear } = require('./notificaciones/inventarioNotificaciones.service');

const ESTADOS = {
  BORRADOR: 'BORRADOR',
  PENDIENTE_ENVIO: 'PENDIENTE_ENVIO',
  EN_TRANSITO: 'EN_TRANSITO',
  RECIBIDO: 'RECIBIDO',
  EN_VALIDACION: 'EN_VALIDACION',
  CON_DIFERENCIAS: 'CON_DIFERENCIAS',
  DISPONIBLE: 'DISPONIBLE'
};

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

class IngresoInventarioService {
  /**
   * Registra en el historial de un ingreso de inventario.
   */
  static async registrarHistorial(ingreso_id, usuario_id, estado, comentario, t = null) {
    return HistorialIngresoInventario.create({
      ingreso_id,
      usuario_id,
      estado,
      comentario
    }, { transaction: t });
  }

  /**
   * Crea un borrador de ingreso.
   */
  static async crearBorrador(usuario_id, centro_gesicomm_id, itemsDto) {
    // Validar que el centro sea de Gesicomm
    const centro = await Deposito.findByPk(centro_gesicomm_id);
    if (!centro || !centro.activo || centro.alcance !== 'GESICOMM') {
      throw errorHttp('El depósito destino debe ser un Centro de Fulfillment válido de Gesicomm.', 400);
    }

    const usuario = await Usuario.findByPk(usuario_id);
    if (!usuario) throw errorHttp('Usuario no encontrado', 404);

    // Validar pertenencia de productos (CP-06d y CP-06e)
    const prodIds = [...new Set(itemsDto.map(i => i.producto_id))];
    const productos = await Producto.findAll({ where: { id: prodIds } });
    if (productos.length !== prodIds.length) {
      throw errorHttp('Uno o más productos no existen', 404);
    }
    for (const p of productos) {
      if (p.inquilino_id !== usuario.inquilino_id) {
        throw errorHttp('No tenés permiso para enviar stock de este producto', 403);
      }
    }
    for (const item of itemsDto) {
      if (!Number.isSafeInteger(Number(item.cantidad_declarada)) || Number(item.cantidad_declarada) <= 0) throw errorHttp('Cantidad declarada invalida.');
      if (item.variante_id && !await ProductoVariante.findOne({ where: { id: item.variante_id, producto_id: item.producto_id, activo: true } })) {
        throw errorHttp('La variante del ingreso no pertenece al producto o esta inactiva.');
      }
      if (!item.variante_id && await ProductoVariante.count({ where: { producto_id: item.producto_id, activo: true } })) throw errorHttp('Selecciona la variante del ingreso.');
    }

    return sequelize.transaction(async (t) => {
      const ingreso = await IngresoInventario.create({
        usuario_id,
        centro_gesicomm_id,
        estado: ESTADOS.BORRADOR
      }, { transaction: t });

      const items = itemsDto.map(item => ({
        ingreso_id: ingreso.id,
        producto_id: item.producto_id,
        variante_id: item.variante_id || null,
        cantidad_declarada: item.cantidad_declarada
      }));

      await IngresoInventarioItem.bulkCreate(items, { transaction: t });

      await this.registrarHistorial(ingreso.id, usuario_id, ESTADOS.BORRADOR, 'Borrador creado', t);

      const result = ingreso.toJSON();
      result.items = await IngresoInventarioItem.findAll({ where: { ingreso_id: ingreso.id }, transaction: t });
      return result;
    });
  }

  /**
   * Comercio confirma el envío (pasa a PENDIENTE_ENVIO).
   */
  static async confirmarEnvio(ingreso_id, usuario_id) {
    const ingreso = await sequelize.transaction(async (t) => {
      const ingreso = await IngresoInventario.findOne({
        where: { id: ingreso_id, usuario_id },
        include: [{ model: IngresoInventarioItem, as: 'items' }],
        transaction: t,
      });
      if (!ingreso) throw errorHttp('Ingreso no encontrado', 404);
      if (ingreso.estado !== ESTADOS.BORRADOR) throw errorHttp('Solo se puede confirmar envíos en estado BORRADOR');

      ingreso.estado = ESTADOS.PENDIENTE_ENVIO;
      await ingreso.save({ transaction: t });
      await this.registrarHistorial(ingreso.id, usuario_id, ESTADOS.PENDIENTE_ENVIO, 'El comercio confirmó el envío.', t);

      return ingreso;
    });

    // Fuera de la transaccion, a proposito: si la notificacion fallara nunca
    // debe revertir la confirmacion del envio (mismo criterio que el resto
    // de los '...SinBloquear' del proyecto).
    notificarIngresoConfirmadoSinBloquear(ingreso);

    return ingreso;
  }

  /**
   * Comercio o Admin marca como en tránsito.
   */
  static async marcarEnTransito(ingreso_id, usuario_id, datosEnvio, esAdmin = false) {
    return sequelize.transaction(async (t) => {
      const ingreso = await IngresoInventario.findOne({ where: { id: ingreso_id, ...(esAdmin ? {} : { usuario_id }) }, transaction: t, lock: t.LOCK.UPDATE });
      if (!ingreso) throw errorHttp('Ingreso no encontrado', 404);
      if (ingreso.estado !== ESTADOS.PENDIENTE_ENVIO) throw errorHttp('El ingreso debe estar pendiente de envío.');

      ingreso.estado = ESTADOS.EN_TRANSITO;
      ingreso.fecha_envio = new Date();
      if (datosEnvio.transportista) ingreso.transportista = datosEnvio.transportista;
      if (datosEnvio.numero_seguimiento) ingreso.numero_seguimiento = datosEnvio.numero_seguimiento;
      if (datosEnvio.observacion) ingreso.observacion = datosEnvio.observacion;

      await ingreso.save({ transaction: t });
      await this.registrarHistorial(ingreso.id, usuario_id, ESTADOS.EN_TRANSITO, 'El stock está en tránsito hacia Gesicomm.', t);

      return ingreso;
    });
  }

  /**
   * Admin recibe físicamente las cajas.
   */
  static async recepcionFisica(ingreso_id, admin_id) {
    return sequelize.transaction(async (t) => {
      const ingreso = await IngresoInventario.findByPk(ingreso_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!ingreso) throw errorHttp('Ingreso no encontrado', 404);
      if (ingreso.estado !== ESTADOS.EN_TRANSITO && ingreso.estado !== ESTADOS.PENDIENTE_ENVIO) {
        throw errorHttp('El ingreso no está en estado válido para recepción.');
      }

      ingreso.estado = ESTADOS.RECIBIDO;
      ingreso.fecha_recepcion = new Date();
      await ingreso.save({ transaction: t });
      await this.registrarHistorial(ingreso.id, admin_id, ESTADOS.RECIBIDO, 'Ingreso recibido en la red Gesicomm.', t);

      return ingreso;
    });
  }

  /**
   * Admin cuenta las cantidades e informa diferencias o pasa a validación.
   */
  static async resolverDiferencias(ingreso_id, admin_id, conteos) {
    return sequelize.transaction(async (t) => {
      const ingreso = await IngresoInventario.findByPk(ingreso_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!ingreso) throw errorHttp('Ingreso no encontrado', 404);
      if (![ESTADOS.RECIBIDO, ESTADOS.EN_VALIDACION, ESTADOS.CON_DIFERENCIAS].includes(ingreso.estado)) {
        throw errorHttp('El ingreso no está en estado de validación.');
      }

      let hayDiferencia = false;

      for (const conteo of conteos) {
        const item = await IngresoInventarioItem.findOne({ where: { id: conteo.item_id, ingreso_id }, transaction: t });
        if (!item) throw errorHttp('El item contado no pertenece al ingreso.');
        const recibida = Number(conteo.cantidad_recibida);
        const aceptada = conteo.cantidad_aceptada === undefined ? recibida : Number(conteo.cantidad_aceptada);
        if (!Number.isSafeInteger(recibida) || recibida < 0 || !Number.isSafeInteger(aceptada) || aceptada < 0 || aceptada > recibida) {
          throw errorHttp('El conteo debe ser entero no negativo y lo aceptado no puede superar lo recibido.');
        }

        item.cantidad_recibida = recibida;
        item.cantidad_aceptada = aceptada;
        item.observacion_recepcion = conteo.observacion || null;
        await item.save({ transaction: t });

        if (item.cantidad_aceptada !== item.cantidad_declarada) {
          hayDiferencia = true;
        }
      }

      ingreso.estado = hayDiferencia ? ESTADOS.CON_DIFERENCIAS : ESTADOS.EN_VALIDACION;
      await ingreso.save({ transaction: t });
      await this.registrarHistorial(ingreso.id, admin_id, ingreso.estado, hayDiferencia ? 'Se detectaron diferencias en el conteo.' : 'Conteo validado sin diferencias.', t);

      return ingreso;
    });
  }

  /**
   * Admin aprueba el ingreso, actualiza InventarioUbicacion transaccionalmente y lo marca DISPONIBLE.
   */
  static async habilitarStock(ingreso_id, admin_id) {
    return sequelize.transaction(async (t) => {
      // 1. Lockear el ingreso para evitar doble procesamiento (idempotencia base)
      const ingreso = await IngresoInventario.findByPk(ingreso_id, {
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!ingreso) throw errorHttp('Ingreso no encontrado', 404);
      
      // 2. Si ya está disponible, salimos sin error pero no duplicamos stock (Idempotencia)
      if (ingreso.estado === ESTADOS.DISPONIBLE) {
        return ingreso;
      }

      if (ingreso.estado !== ESTADOS.EN_VALIDACION && ingreso.estado !== ESTADOS.CON_DIFERENCIAS) {
        throw errorHttp('El ingreso debe estar validado antes de habilitar el stock.');
      }

      const items = await IngresoInventarioItem.findAll({ where: { ingreso_id }, transaction: t });
      if (!ingreso.fecha_recepcion || !items.length || items.some(item => item.cantidad_recibida == null || item.cantidad_aceptada == null)) {
        throw errorHttp('Confirma la recepcion fisica y cuenta todos los items antes de habilitar stock.');
      }

      // 3. Incrementar el InventarioUbicacion para cada item
      for (const item of items) {
        const cantidad_agregar = item.cantidad_aceptada !== null ? item.cantidad_aceptada : item.cantidad_recibida;
        if (!cantidad_agregar || cantidad_agregar <= 0) continue;

        await require('./inventarioUbicacion.service').acreditar({ usuario_id: ingreso.usuario_id,
          producto_id: item.producto_id, variante_id: item.variante_id,
          deposito_id: ingreso.centro_gesicomm_id, cantidad: cantidad_agregar, alcance: 'GESICOMM' }, t);
      }

      // 5. Marcar ingreso como DISPONIBLE
      ingreso.estado = ESTADOS.DISPONIBLE;
      await ingreso.save({ transaction: t });
      await this.registrarHistorial(ingreso.id, admin_id, ESTADOS.DISPONIBLE, 'Stock habilitado y sumado al inventario de Gesicomm.', t);

      return ingreso;
    });
  }
}

module.exports = { IngresoInventarioService, ESTADOS };
