'use strict';

const { Transaction, Op } = require('sequelize');
const {
  sequelize, SolicitudAbastecimiento, HistorialSolicitudAbastecimiento,
  Producto, ProductoVariante, Deposito, Usuario, Rol,
} = require('../models');
const { ACTORES, validarTransicion, resolverSiguienteEstadoUnico, ESTADOS_FINALES, errorHttp } = require('./abastecimiento/estadoMachine');
const TarifaDelivery = require('./tarifaDelivery.service');
const ProveedorLogisticoService = require('./proveedorLogistico.service');
const ComprobanteService = require('./comprobante.service');
const parametros = require('./parametros.service');
const Inventario = require('./inventarioUbicacion.service');
const ProductoService = require('./producto.service');

function cantidadValida(cantidad) {
  const value = Number(cantidad);
  if (!Number.isSafeInteger(value) || value <= 0) throw errorHttp('La cantidad debe ser un entero positivo.');
  return value;
}
const { costoParaComerciante, esProductoCargadoPorAdmin } = require('../controllers/envioController');

const TEXTOS = {
  pendiente_pago: 'Solicitud creada, pendiente de pago.',
  pago_enviado: 'El comercio subió el comprobante de transferencia. Pendiente de validación.',
  pago_validado: 'Admin validó el pago.',
  pago_rechazado: 'Admin rechazó el comprobante de pago.',
  proveedor_contactado: 'Admin contactó al proveedor.',
  enviado_por_proveedor: 'El proveedor despachó la mercadería.',
  en_transito_a_gesicomm: 'La mercadería está en tránsito hacia Gesicomm.',
  en_transito_a_deposito_cliente: 'La mercadería está en tránsito hacia el depósito del comercio.',
  recibido_en_gesicomm: 'La mercadería llegó a Gesicomm.',
  preparando_envio_a_deposito_cliente: 'Gesicomm está preparando el envío al depósito del comercio.',
  despachado_a_deposito_cliente: 'Gesicomm despachó la mercadería hacia el depósito del comercio.',
  recibido_en_deposito_cliente: 'El comercio confirmó la recepción en su depósito.',
  disponible_en_gesicomm: 'La mercadería quedó disponible en el centro de Gesicomm.',
  cancelada: 'Solicitud cancelada.',
};

class SolicitudAbastecimientoService {
  static async registrarHistorial(solicitud_id, usuario_id, estado, comentario, t) {
    return HistorialSolicitudAbastecimiento.create({
      solicitud_id, usuario_id: usuario_id || null, estado, comentario,
    }, { transaction: t });
  }

  /** Cotiza el costo logístico de traer `cantidad` unidades a un depósito propio. */
  static async cotizarLogisticaPropia(usuario_id, depositoId, cantidad) {
    const deposito = await Deposito.findOne({ where: { id: depositoId, usuario_id, activo: true } });
    if (!deposito) throw errorHttp('El depósito indicado no existe o está inactivo.');

    const centros = await ProveedorLogisticoService.centrosActivos();
    if (!centros || centros.length === 0) {
      return { cubierto: false, mensaje: 'Gesicomm aún no tiene centros activos.' };
    }

    const cantidadPedida = Math.max(1, Number(cantidad) || 1);
    const opciones = await TarifaDelivery.resolverOpcionesDeRed(
      { centroIds: centros.map((c) => c.id) },
      { paymentMethod: 'efectivo', items: [{ cantidad: cantidadPedida }] },
    );
    const mejor = TarifaDelivery.buscarOpcion(opciones, deposito.ciudad, deposito.departamento);
    if (!mejor) {
      return { cubierto: false, mensaje: 'Actualmente Gesicomm no posee cobertura logística para este depósito.' };
    }
    return {
      cubierto: true,
      costo: Number(mejor.costo),
      tiempo: (mejor.tiempo_entrega_min_hs && mejor.tiempo_entrega_max_hs)
        ? `${mejor.tiempo_entrega_min_hs}–${mejor.tiempo_entrega_max_hs} h`
        : 'A coordinar',
      proveedor: mejor.proveedor_nombre || 'Proveedor Gesicomm',
    };
  }

  /** Cotización completa que ve el comercio antes de confirmar la solicitud. */
  static async cotizar({ usuario_id, producto_id, variante_id, cantidad, tipoLogistica, depositoId }) {
    const prod = await Producto.findByPk(producto_id, {
      include: [{ model: Usuario, as: 'Creador', include: [Rol] }],
    });
    if (!prod) throw errorHttp('Producto no encontrado.', 404);
    if (!esProductoCargadoPorAdmin(prod)) {
      throw errorHttp('Este producto es propio del comercio: el abastecimiento es solo para productos del catálogo Gesicomm.');
    }

    const cant = cantidadValida(cantidad);
    const tieneVariantes = await ProductoVariante.count({ where: { producto_id, activo: true } });
    if (tieneVariantes && !variante_id) throw errorHttp('Selecciona la variante del producto.');
    if (variante_id && !await ProductoVariante.findOne({ where: { id: variante_id, producto_id, activo: true } })) {
      throw errorHttp('La variante indicada no pertenece al producto o esta inactiva.');
    }
    const costoProducto = Math.max(0, Math.round(costoParaComerciante(prod, usuario_id) * cant));

    if (tipoLogistica === 'GESICOMM') {
      return { costoProducto, costoLogistico: 0, total: costoProducto, cubierto: true, proveedor: 'Red Gesicomm', tiempo: null };
    }
    if (tipoLogistica === 'PROPIA') {
      const logistica = await this.cotizarLogisticaPropia(usuario_id, depositoId, cant);
      if (!logistica.cubierto) return { costoProducto, costoLogistico: 0, total: costoProducto, cubierto: false, mensaje: logistica.mensaje };
      return {
        costoProducto,
        costoLogistico: logistica.costo,
        total: costoProducto + logistica.costo,
        cubierto: true,
        proveedor: logistica.proveedor,
        tiempo: logistica.tiempo,
      };
    }
    throw errorHttp('tipoLogistica inválido.');
  }

  /** Crea la solicitud ya con la cotización resuelta (mismo cálculo de `cotizar`, snapshot). */
  static async crear({ usuario_id, producto_id, variante_id, cantidad, tipoLogistica, depositoId }) {
    const cant = cantidadValida(cantidad);
    if (variante_id) {
      const variante = await ProductoVariante.findOne({ where: { id: variante_id, producto_id } });
      if (!variante) throw errorHttp('La variante indicada no pertenece a este producto.');
    }

    const cotizacion = await this.cotizar({ usuario_id, producto_id, variante_id, cantidad: cant, tipoLogistica, depositoId });
    if (!cotizacion.cubierto) {
      throw errorHttp(cotizacion.mensaje || 'No hay cobertura logística para este destino.');
    }

    return sequelize.transaction(async (t) => {
      const solicitud = await SolicitudAbastecimiento.create({
        usuario_id,
        producto_id,
        variante_id: variante_id || null,
        cantidad: cant,
        tipo_logistica: tipoLogistica,
        deposito_destino_id: tipoLogistica === 'PROPIA' ? depositoId : null,
        costo_producto: cotizacion.costoProducto,
        costo_logistico: cotizacion.costoLogistico,
        estado: 'pendiente_pago',
      }, { transaction: t });

      await this.registrarHistorial(solicitud.id, usuario_id, 'pendiente_pago', TEXTOS.pendiente_pago, t);
      return solicitud;
    });
  }

  static async obtener(solicitud_id, { usuario_id, esAdmin } = {}) {
    const where = { id: solicitud_id };
    if (!esAdmin) where.usuario_id = usuario_id;
    const solicitud = await SolicitudAbastecimiento.findOne({
      where,
      include: [
        { model: Usuario, attributes: ['id', 'nombre', 'correo_electronico'] },
        { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'sku'] },
        { model: ProductoVariante, as: 'variante', attributes: ['id', 'nombre', 'sku_variante'] },
        { model: Deposito, as: 'depositoDestino', attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'] },
        { model: Deposito, as: 'centroGesicomm', attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'] },
        { model: HistorialSolicitudAbastecimiento, as: 'historial', order: [['created_at', 'ASC']] },
      ],
    });
    if (!solicitud) throw errorHttp('Solicitud no encontrada.', 404);
    const salida = solicitud.toJSON();
    salida.datos_transferencia = await this.obtenerDatosTransferencia(salida);
    return salida;
  }

  static async obtenerDatosTransferencia(solicitud) {
    const claves = [
      'ABASTECIMIENTO_BANCO_NOMBRE',
      'ABASTECIMIENTO_BANCO_TITULAR',
      'ABASTECIMIENTO_BANCO_CI_RUC',
      'ABASTECIMIENTO_BANCO_NUMERO_CUENTA',
      'ABASTECIMIENTO_ALIAS_TIPO',
      'ABASTECIMIENTO_ALIAS_VALOR',
      'ABASTECIMIENTO_TRANSFERENCIA_NOTA',
    ];
    const valores = await parametros.obtenerVarios(claves);
    const producto = solicitud.producto?.nombre || `Producto #${solicitud.producto_id}`;
    const variante = solicitud.variante?.nombre ? ` - ${solicitud.variante.nombre}` : '';
    const referencia = `SOL-${solicitud.id} - ${producto}${variante} - ${solicitud.cantidad}u`;
    const nota = valores.ABASTECIMIENTO_TRANSFERENCIA_NOTA || null;
    const configurado = Boolean(
      valores.ABASTECIMIENTO_BANCO_NOMBRE
      || valores.ABASTECIMIENTO_BANCO_TITULAR
      || valores.ABASTECIMIENTO_BANCO_NUMERO_CUENTA
      || valores.ABASTECIMIENTO_ALIAS_VALOR
    );

    return {
      configurado,
      banco: valores.ABASTECIMIENTO_BANCO_NOMBRE,
      titular: valores.ABASTECIMIENTO_BANCO_TITULAR,
      ci_ruc: valores.ABASTECIMIENTO_BANCO_CI_RUC,
      numero_cuenta: valores.ABASTECIMIENTO_BANCO_NUMERO_CUENTA,
      alias_tipo: valores.ABASTECIMIENTO_ALIAS_TIPO,
      alias_valor: valores.ABASTECIMIENTO_ALIAS_VALOR,
      nota,
      referencia,
      descripcion: referencia,
      monto: Math.max(0, Math.round((Number(solicitud.costo_producto) || 0) + (Number(solicitud.costo_logistico) || 0))),
    };
  }

  static async listar({
    usuario_id, esAdmin, estado, texto, tipoLogistica, page, limit,
  } = {}) {
    const where = {};
    if (!esAdmin) where.usuario_id = usuario_id;
    if (estado && estado !== 'TODOS') where.estado = estado;
    if (tipoLogistica && tipoLogistica !== 'TODOS') where.tipo_logistica = tipoLogistica;
    if (texto) {
      const q = String(texto).trim();
      const condiciones = [
        { '$producto.nombre$': { [Op.iLike]: `%${q}%` } },
        { '$variante.nombre$': { [Op.iLike]: `%${q}%` } },
        { '$depositoDestino.nombre$': { [Op.iLike]: `%${q}%` } },
        { '$centroGesicomm.nombre$': { [Op.iLike]: `%${q}%` } },
      ];
      const id = Number(q.replace(/\D/g, ''));
      if (id) condiciones.push({ id });
      where[Op.or] = condiciones;
    }

    const include = [
      { model: Usuario, attributes: ['id', 'nombre', 'correo_electronico'] },
      { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'sku'] },
      { model: ProductoVariante, as: 'variante', attributes: ['id', 'nombre', 'sku_variante'] },
      { model: Deposito, as: 'depositoDestino', attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'] },
      { model: Deposito, as: 'centroGesicomm', attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'] },
    ];

    const paginar = page != null || limit != null;
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
    const pageNum = Math.max(1, Number(page) || 1);
    const consulta = {
      where,
      include,
      order: [['created_at', 'DESC']],
      distinct: true,
      subQuery: false,
    };
    if (paginar) {
      consulta.limit = limitNum;
      consulta.offset = (pageNum - 1) * limitNum;
    }

    const resultado = paginar
      ? await SolicitudAbastecimiento.findAndCountAll(consulta)
      : { rows: await SolicitudAbastecimiento.findAll(consulta), count: null };

    const solicitudes = resultado.rows.map((s) => s.toJSON());

    if (!paginar) return solicitudes;
    return {
      total: resultado.count,
      pagina: pageNum,
      total_paginas: Math.ceil(resultado.count / limitNum),
      solicitudes,
    };
  }

  static async aplicarTransicion({ solicitud_id, actor, usuario_id, nuevoEstado, comentario = null, extraUpdate = {} }) {
    return sequelize.transaction(async (t) => {
      const solicitud = await SolicitudAbastecimiento.findByPk(solicitud_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (!solicitud) throw errorHttp('Solicitud no encontrada.', 404);
      if (actor === ACTORES.USUARIO && solicitud.usuario_id !== usuario_id) {
        throw errorHttp('No autorizado.', 403);
      }

      validarTransicion(solicitud.estado, actor, nuevoEstado, solicitud.tipo_logistica);

      await solicitud.update({ estado: nuevoEstado, ...extraUpdate }, { transaction: t });
      await this.registrarHistorial(solicitud.id, usuario_id, nuevoEstado, comentario || TEXTOS[nuevoEstado] || nuevoEstado, t);

      return solicitud;
    });
  }

  static async subirComprobante({ solicitud_id, usuario_id, fileData }) {
    const solicitud = await SolicitudAbastecimiento.findOne({ where: { id: solicitud_id, usuario_id } });
    if (!solicitud) throw errorHttp('Solicitud no encontrada.', 404);
    if (!['pendiente_pago', 'pago_rechazado'].includes(solicitud.estado)) {
      throw errorHttp('El comprobante solo puede subirse mientras el pago está pendiente o fue rechazado.');
    }

    const resultado = await ComprobanteService.procesarComprobanteParaR2(fileData, solicitud.id, 'solicitud-abastecimiento-comprobantes');

    const actualizada = await this.aplicarTransicion({
      solicitud_id: solicitud.id,
      actor: ACTORES.USUARIO,
      usuario_id,
      nuevoEstado: 'pago_enviado',
      extraUpdate: {
        comprobante_url: resultado.url,
        comprobante_storage_key: resultado.storage_key,
        rechazo_motivo: null,
      },
    });

    const InventarioNotificaciones = require('./notificaciones/inventarioNotificaciones.service');
    InventarioNotificaciones.notificarSolicitudAbastecimientoComprobanteSubidoSinBloquear(actualizada);

    return actualizada;
  }

  static async validarPago({ solicitud_id, usuario_id }) {
    return this.aplicarTransicion({ solicitud_id, actor: ACTORES.ADMIN, usuario_id, nuevoEstado: 'pago_validado' });
  }

  static async rechazarPago({ solicitud_id, usuario_id, motivo }) {
    if (!motivo) throw errorHttp('El motivo de rechazo es obligatorio.');
    const actualizada = await this.aplicarTransicion({
      solicitud_id, actor: ACTORES.ADMIN, usuario_id, nuevoEstado: 'pago_rechazado',
      comentario: `${TEXTOS.pago_rechazado}: ${motivo}`,
      extraUpdate: { rechazo_motivo: motivo },
    });

    const InventarioNotificaciones = require('./notificaciones/inventarioNotificaciones.service');
    InventarioNotificaciones.notificarSolicitudAbastecimientoRechazadaSinBloquear(actualizada, motivo);

    return actualizada;
  }

  /** Único paso siguiente del tramo operativo del admin, sin que el frontend elija estado. */
  static async avanzar({ solicitud_id, usuario_id, centroGesicommId }) {
    const solicitud = await SolicitudAbastecimiento.findByPk(solicitud_id);
    if (!solicitud) throw errorHttp('Solicitud no encontrada.', 404);
    const nuevoEstado = resolverSiguienteEstadoUnico(solicitud.estado, ACTORES.ADMIN, solicitud.tipo_logistica);

    // Este es el paso donde efectivamente se acredita el stock en el
    // centro Gesicomm — nunca antes, para no mostrar disponible algo que
    // todavía no llegó fisicamente.
    if (nuevoEstado === 'disponible_en_gesicomm') {
      if (!centroGesicommId) throw errorHttp('Falta indicar a qué Centro Gesicomm llegó la mercadería.');
      return sequelize.transaction(async (t) => {
        const fila = await SolicitudAbastecimiento.findByPk(solicitud_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
        validarTransicion(fila.estado, ACTORES.ADMIN, nuevoEstado, fila.tipo_logistica);

        await Inventario.acreditar({ usuario_id: fila.usuario_id, producto_id: fila.producto_id,
          variante_id: fila.variante_id, deposito_id: centroGesicommId, cantidad: fila.cantidad, alcance: 'GESICOMM' }, t);

        await fila.update({ estado: nuevoEstado, centro_gesicomm_id: centroGesicommId }, { transaction: t });
        await this.registrarHistorial(fila.id, usuario_id, nuevoEstado, TEXTOS.disponible_en_gesicomm, t);
        return fila;
      });
    }

    return this.aplicarTransicion({ solicitud_id, actor: ACTORES.ADMIN, usuario_id, nuevoEstado });
  }

  /**
   * El comercio confirma que le llegó la mercadería a su propio depósito.
   * Acredita en DOS lugares con roles distintos:
   *   - Producto.stock_deposito/cantidad_disponible: sigue siendo, sin
   *     excepción, la única fuente de verdad de cuánto hay para vender.
   *   - InventarioUbicacion (deposito_destino_id): libro de ubicación, para
   *     que el motor de fulfillment (resolverPlanFulfillment en
   *     envioController) sepa que ESTA unidad está en ESE depósito
   *     específico, y pueda detectar pedidos mezclados con otro origen.
   *     Nunca compite con el número de arriba ni lo duplica.
   */
  static async confirmarRecepcionPropia({ solicitud_id, usuario_id }) {
    return sequelize.transaction(async (t) => {
      const solicitud = await SolicitudAbastecimiento.findOne({
        where: { id: solicitud_id, usuario_id }, transaction: t, lock: Transaction.LOCK.UPDATE,
      });
      if (!solicitud) throw errorHttp('Solicitud no encontrada.', 404);
      validarTransicion(solicitud.estado, ACTORES.USUARIO, 'recibido_en_deposito_cliente', solicitud.tipo_logistica);

      const prod = await Producto.findByPk(solicitud.producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (!prod) throw errorHttp('Producto no encontrado.', 404);
      if (solicitud.variante_id) {
        const variante = await ProductoVariante.findOne({ where: { id: solicitud.variante_id, producto_id: prod.id, activo: true },
          transaction: t, lock: Transaction.LOCK.UPDATE });
        if (!variante) throw errorHttp('Variante no disponible para recepcion.');
        await variante.update({ stock_deposito: variante.stock_deposito + solicitud.cantidad,
          stock: variante.stock + solicitud.cantidad }, { transaction: t });
        await ProductoService.recalcularStockPadre(prod.id, t);
      } else {
        await prod.update({
          stock_deposito: (parseInt(prod.stock_deposito) || 0) + solicitud.cantidad,
          cantidad_disponible: (parseInt(prod.cantidad_disponible) || 0) + solicitud.cantidad,
        }, { transaction: t });
      }

      await Inventario.acreditar({ usuario_id: solicitud.usuario_id, producto_id: solicitud.producto_id,
        variante_id: solicitud.variante_id, deposito_id: solicitud.deposito_destino_id,
        cantidad: solicitud.cantidad, alcance: 'PROPIO' }, t);

      await solicitud.update({ estado: 'recibido_en_deposito_cliente' }, { transaction: t });
      await this.registrarHistorial(solicitud.id, usuario_id, 'recibido_en_deposito_cliente', TEXTOS.recibido_en_deposito_cliente, t);
      return solicitud;
    });
  }
}

module.exports = SolicitudAbastecimientoService;
