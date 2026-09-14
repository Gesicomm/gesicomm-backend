'use strict';

/**
 * Servicio de Combos — Módulo de Pricing y Rentabilidad.
 *
 * Responsabilidades:
 * 1. Resolver datos del catálogo desde la DB (productos, costos).
 * 2. Obtener configuración económica del tenant.
 * 3. Construir el DTO normalizado para el motor de cálculo.
 * 4. Ejecutar comboPricing.calcular() con los datos resueltos.
 * 5. Persistir combos con snapshots económicos.
 * 6. Gestionar el ciclo de vida (BORRADOR → ACTIVO → INACTIVO).
 *
 * El backend NUNCA confía en precios ni costos enviados por el frontend.
 * Solo acepta IDs de productos y porcentajes de descuento configurados por el admin.
 */

const { Op } = require('sequelize');
const { ProductoCombo, ProductoComboItem, ProductoComboImagen, Producto, ProductoImagen, PrecioUsuario } = require('../models');
const comboPricing = require('../utils/comboPricing');
const ComboConfiguracionService = require('./comboConfiguracion.service');
const ImagenService = require('./imagen.service');

class ComboService {
  static serializarImagenesCombo(combo) {
    (combo?.imagenes || []).forEach((imagen) => {
      const data = ImagenService.serializar(imagen);
      if (imagen.setDataValue) imagen.setDataValue('url', data.url);
      else imagen.url = data.url;
    });
    return combo;
  }

  /**
   * Normaliza el precio_minimo recibido del payload: null/undefined/''/0 → null
   * (sin piso configurado), igual que Producto.precio_minimo.
   */
  static parsearPrecioMinimo(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    const num = parseFloat(valor);
    return num > 0 ? num : null;
  }

  /**
   * Misma semántica económica que ve el editor de combos:
   * - Admin: costo interno (precio_costo) y venta mayorista (precio_base).
   * - Usuario tienda: costo = precio_base del catálogo Gesicomm; venta =
   *   PrecioUsuario si existe, o precio_base como punto de partida.
   * Para productos propios de la tienda, precio_costo vuelve a ser su costo
   * real porque no es un costo interno de Gesicomm.
   */
  static economiaProducto(producto, { esAdmin = false, usuario_id = null, preciosUsuario = new Map() } = {}) {
    const precioCosto = parseFloat(producto.precio_costo) || 0;
    const precioBase = parseFloat(producto.precio_base) || 0;
    const precioUsuario = preciosUsuario.has(Number(producto.id)) ? preciosUsuario.get(Number(producto.id)) : null;

    if (esAdmin) {
      return { cost: precioCosto, salePrice: precioBase };
    }

    const esPropio = usuario_id != null && producto.creado_por != null && Number(producto.creado_por) === Number(usuario_id);
    return {
      cost: esPropio && precioCosto > 0 ? precioCosto : precioBase,
      salePrice: precioUsuario !== null ? precioUsuario : precioBase,
    };
  }

  // ─── DTO Mapping ──────────────────────────────────────────────────────────

  /**
   * Convierte datos de Sequelize al DTO que espera el motor de cálculo.
   * Centraliza el mapping para que el motor quede desacoplado de Sequelize.
   *
   * @param {Producto} principal - Instancia Sequelize del producto principal
   * @param {Array<{ producto: Producto, descuento_porcentaje: number }>} upsellsData
   * @param {object} config - Instancia de ComboConfiguracion
   * @returns {object} Input para comboPricing.calcular()
   */
  static toMotorInput(principal, upsellsData, config, contexto = {}) {
    const economiaPrincipal = this.economiaProducto(principal, contexto);
    return {
      principal: {
        id: principal.id,
        name: principal.nombre,
        cost: economiaPrincipal.cost,
        salePrice: economiaPrincipal.salePrice,
      },
      upsells: upsellsData.map(({ producto, descuento_porcentaje }) => {
        const economia = this.economiaProducto(producto, contexto);
        return {
          id: producto.id,
          name: producto.nombre,
          cost: economia.cost,
          salePrice: economia.salePrice,
          discountPercentage: parseFloat(descuento_porcentaje) || 0,
        };
      }),
      costs: ComboConfiguracionService.toMotorCosts(config),
      targetMargins: config.margenes_objetivo || [15, 30, 45],
      minimumMargin: parseFloat(config.margen_minimo) || 10,
      excellentThreshold: parseFloat(config.umbral_excelente) || 50,
      discountScenarios: config.escenarios_descuento || [0, 5, 10, 15, 20, 25, 30, 35],
    };
  }

  // ─── Simulación ───────────────────────────────────────────────────────────

  /**
   * Simula la rentabilidad de un combo sin persistir nada.
   * El backend obtiene precios/costos reales del catálogo por ID.
   *
   * @param {number} principalId
   * @param {Array<{ productId: number, discountPercentage: number }>} upsells
   * @param {number} inquilino_id
   * @returns {Promise<object>} Resultado del motor de cálculo
   */
  static async simular(principalId, upsells = [], inquilino_id, opciones = {}) {
    const { usuario_id = null, esAdmin = false } = opciones;
    // 1. Validaciones de forma (sin DB) — se rechazan antes de gastar una
    // ida-vuelta a la base en un payload que ya se sabe inválido.
    const upsellIds = upsells.map(u => Number(u.productId));
    const idSet = new Set(upsellIds);
    if (idSet.size !== upsellIds.length) throw new Error('No se pueden agregar productos duplicados al combo.');
    if (idSet.has(Number(principalId))) throw new Error('El producto principal no puede ser upsell de sí mismo.');

    // 2. Principal, upsells y configuración del tenant son independientes
    // entre sí — se resuelven en paralelo en vez de uno atrás del otro.
    const [principal, productosUpsell, config] = await Promise.all([
      Producto.findOne({ where: { id: principalId, inquilino_id, activo: true } }),
      upsellIds.length > 0
        ? Producto.findAll({ where: { id: upsellIds, inquilino_id, activo: true } })
        : Promise.resolve([]),
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
    ]);

    if (!principal) throw new Error('El producto principal no existe o no está activo.');

    const idsMotor = [Number(principalId), ...upsellIds].filter(Boolean);
    const preciosUsuarioRows = (!esAdmin && usuario_id && idsMotor.length)
      ? await PrecioUsuario.findAll({
        where: { usuario_id, tipo: 'producto', referencia_id: { [Op.in]: idsMotor } },
        attributes: ['referencia_id', 'precio'],
      })
      : [];
    const preciosUsuario = new Map(preciosUsuarioRows.map(p => [Number(p.referencia_id), parseFloat(p.precio)]));
    const contextoMotor = { usuario_id, esAdmin, preciosUsuario };

    const economiaPrincipal = this.economiaProducto(principal, contextoMotor);
    if (!(economiaPrincipal.cost > 0)) {
      throw new Error(`El producto "${principal.nombre}" no tiene costo configurado para calcular el combo.`);
    }

    // 3. Resolver upsells del catálogo (nunca confiar en precios del frontend)
    let upsellsData = [];
    if (upsellIds.length > 0) {
      if (productosUpsell.length !== upsellIds.length) {
        throw new Error('Uno o más upsells no existen, no están activos o no pertenecen al catálogo.');
      }

      const productoMap = new Map(productosUpsell.map(p => [p.id, p]));
      upsellsData = upsells.map(u => {
        const producto = productoMap.get(Number(u.productId));
        const economia = this.economiaProducto(producto, contextoMotor);
        if (!(economia.cost > 0)) {
          throw new Error(`El producto "${producto.nombre}" no tiene costo configurado para calcular el combo.`);
        }
        return {
          producto,
          descuento_porcentaje: parseFloat(u.discountPercentage) || 0,
        };
      });
    }

    // 4. Construir DTO y ejecutar motor
    const motorInput = this.toMotorInput(principal, upsellsData, config, contextoMotor);
    const resultado = comboPricing.calcular(motorInput);

    // 5. Agregar advertencias de stock
    const stockWarnings = await this.validarDisponibilidad(principal, upsellsData);
    resultado.warnings = [...resultado.warnings, ...stockWarnings];

    return resultado;
  }

  // ─── Validación de disponibilidad ─────────────────────────────────────────

  /**
   * Verifica stock y estado de los productos del combo.
   * Retorna warnings — no lanza excepciones.
   *
   * @param {Producto} principal
   * @param {Array<{ producto: Producto }>} upsellsData
   * @returns {string[]} Array de advertencias
   */
  static async validarDisponibilidad(principal, upsellsData) {
    const warnings = [];

    if (principal.estado_venta === 'fuera_de_stock') {
      warnings.push(`"${principal.nombre}" está fuera de stock.`);
    } else if (principal.estado_venta === 'no_disponible') {
      warnings.push(`"${principal.nombre}" no está disponible para la venta.`);
    } else if (principal.cantidad_disponible === 0) {
      warnings.push(`"${principal.nombre}" no tiene stock disponible.`);
    }

    for (const { producto } of upsellsData) {
      if (producto.estado_venta === 'fuera_de_stock') {
        warnings.push(`El upsell "${producto.nombre}" está fuera de stock.`);
      } else if (producto.estado_venta === 'no_disponible') {
        warnings.push(`El upsell "${producto.nombre}" no está disponible para la venta.`);
      } else if (producto.cantidad_disponible === 0) {
        warnings.push(`El upsell "${producto.nombre}" no tiene stock disponible.`);
      }
    }

    return warnings;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /**
   * Lista todos los combos del tenant con sus upsells.
   *
   * @param {number} inquilino_id
   * @param {{ estado?: string, texto?: string }} filtros
   */
  static async listar(inquilino_id, filtros = {}) {
    const where = { inquilino_id };
    if (filtros.estado) where.estado = filtros.estado;

    const combos = await ProductoCombo.findAll({
      where,
      attributes: { exclude: ['descripcion', 'fecha_inicio', 'fecha_fin', 'sobre_este_producto', 'propuesta_valor', 'beneficios', 'confianza', 'preguntas_frecuentes', 'ficha_datos'] }, // La vista del combo no hace falta en el listado
      include: [
        {
          model: Producto,
          as: 'producto_padre',
          attributes: ['id', 'nombre'],
        },
        {
          model: ProductoComboItem,
          as: 'items',
          attributes: ['id', 'descuento_porcentaje'],
          include: [{
            model: Producto,
            as: 'producto_incluido',
            attributes: ['id', 'nombre'],
          }],
        },
        {
          model: ProductoComboImagen,
          as: 'imagenes',
          attributes: ['id', 'url', 'storage_key', 'es_principal', 'orden'],
        },
      ],
      order: [['created_at', 'DESC'], [{ model: ProductoComboImagen, as: 'imagenes' }, 'orden', 'ASC']],
    });
    combos.forEach(combo => this.serializarImagenesCombo(combo));
    return combos;
  }

  /**
   * Obtiene un combo por ID del tenant.
   *
   * @param {number} comboId
   * @param {number} inquilino_id
   */
  static async obtener(comboId, inquilino_id, opciones = {}) {
    const { usuario_id = null, esAdmin = false } = opciones;
    const combo = await ProductoCombo.findOne({
      where: { id: comboId, inquilino_id },
      include: [
        {
          model: Producto,
          as: 'producto_padre',
          attributes: ['id', 'nombre', 'precio_base', 'precio_costo', 'sku', 'estado_venta', 'cantidad_disponible', 'creado_por', 'beneficios'],
          include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }],
        },
        {
          model: ProductoComboItem,
          as: 'items',
          include: [{
            model: Producto,
            as: 'producto_incluido',
            attributes: ['id', 'nombre', 'precio_base', 'precio_costo', 'sku', 'estado_venta', 'cantidad_disponible', 'creado_por', 'beneficios'],
            include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }],
          }],
          order: [['orden', 'ASC']],
        },
        {
          model: ProductoComboImagen,
          as: 'imagenes',
          attributes: ['id', 'url', 'storage_key', 'es_principal', 'orden'],
        },
      ],
      order: [[{ model: ProductoComboImagen, as: 'imagenes' }, 'orden', 'ASC']],
    });
    if (!combo) throw new Error('Combo no encontrado.');
    this.serializarImagenesCombo(combo);

    // El editor de combos reutiliza productos de la vitrina. Para un usuario
    // tienda, el costo es lo que le cobra Gesicomm (Producto.precio_base) y el
    // precio de venta es su PrecioUsuario si ya lo configuró en "Mi catálogo".
    // Sin este DTO enriquecido, al reabrir un combo el frontend solo recibía
    // precio_base y terminaba mostrando "precio de venta = costo tienda".
    if (!esAdmin && usuario_id) {
      const idsProducto = [
        combo.producto_id,
        ...(combo.items || []).map(i => i.producto_incluido_id),
      ].filter(Boolean);

      const precios = idsProducto.length
        ? await PrecioUsuario.findAll({
          where: { usuario_id, tipo: 'producto', referencia_id: { [Op.in]: idsProducto } },
          attributes: ['referencia_id', 'precio'],
        })
        : [];
      const preciosPorProducto = new Map(precios.map(p => [Number(p.referencia_id), parseFloat(p.precio)]));

      const aplicarPrecioTienda = (producto) => {
        if (!producto) return;
        const data = producto.toJSON ? producto.toJSON() : producto;
        const precioBase = parseFloat(data.precio_base) || 0;
        const precioUsuario = preciosPorProducto.has(Number(data.id)) ? preciosPorProducto.get(Number(data.id)) : null;
        producto.setDataValue('costo_tienda', precioBase);
        producto.setDataValue('precio_usuario', precioUsuario);
        producto.setDataValue('precio_efectivo', precioUsuario !== null ? precioUsuario : precioBase);
      };

      aplicarPrecioTienda(combo.producto_padre);
      (combo.items || []).forEach(item => aplicarPrecioTienda(item.producto_incluido));
    }

    return combo;
  }

  /**
   * Crea un nuevo combo con sus upsells y snapshot económico.
   *
   * @param {object} payload - { nombre, descripcion, precio_total, principalProductId, upsells[], fecha_inicio?, fecha_fin? }
   * @param {number} inquilino_id
   * @param {object} transaction
   */
  /**
   * Campos de "Vista del combo" — mismo criterio que Producto: solo se
   * incluyen las claves presentes en el payload, para no pisar lo guardado
   * con `undefined` en actualizaciones parciales.
   */
  static camposVistaCombo(payload) {
    const campos = {};
    if ('sobre_este_producto' in payload) campos.sobre_este_producto = payload.sobre_este_producto?.trim() || null;
    if ('propuesta_valor' in payload) campos.propuesta_valor = payload.propuesta_valor?.trim() || null;
    if ('beneficios' in payload) campos.beneficios = Array.isArray(payload.beneficios) ? payload.beneficios : [];
    if ('confianza' in payload) campos.confianza = Array.isArray(payload.confianza) ? payload.confianza : [];
    if ('preguntas_frecuentes' in payload) campos.preguntas_frecuentes = Array.isArray(payload.preguntas_frecuentes) ? payload.preguntas_frecuentes : [];
    if ('faq_titulo' in payload) campos.faq_titulo = payload.faq_titulo?.trim() || null;
    if ('relacionados_titulo' in payload) campos.relacionados_titulo = payload.relacionados_titulo?.trim() || null;
    if ('ficha_rubro' in payload) campos.ficha_rubro = payload.ficha_rubro || null;
    if ('ficha_datos' in payload) campos.ficha_datos = (payload.ficha_datos && typeof payload.ficha_datos === 'object') ? payload.ficha_datos : {};
    return campos;
  }

  static async crear(payload, inquilino_id, transaction, opciones = {}) {
    const { nombre, descripcion, precio_total, principalProductId, upsells = [], fecha_inicio, fecha_fin } = payload;

    if (!nombre?.trim()) throw new Error('El nombre del combo es obligatorio.');
    if (!principalProductId) throw new Error('El producto principal es obligatorio.');
    if (parseFloat(precio_total) < 0) throw new Error('El precio del combo no puede ser negativo.');

    const precioTotalNum = parseFloat(precio_total) || 0;
    const precioMinimoNum = this.parsearPrecioMinimo(payload.precio_minimo);
    if (precioMinimoNum && precioTotalNum < precioMinimoNum) {
      throw new Error(`El precio del combo (${precioTotalNum}) no puede ser menor al precio mínimo configurado (${precioMinimoNum}).`);
    }

    // Ejecutar simulación para obtener snapshot
    const resultado = await this.simular(principalProductId, upsells, inquilino_id, opciones);

    const comboInstancia = await ProductoCombo.create({
      inquilino_id,
      producto_id: principalProductId,
      nombre: nombre.trim(),
      descripcion: descripcion?.trim() || null,
      precio_total: precioTotalNum,
      precio_minimo: precioMinimoNum,
      estado: 'BORRADOR',
      activo: false, // BORRADOR no está activo
      fecha_inicio: fecha_inicio || null,
      fecha_fin: fecha_fin || null,
      // Snapshot económico
      ...this.buildSnapshot(resultado, await ComboConfiguracionService.obtenerOCrear(inquilino_id)),
      // Vista del combo
      ...this.camposVistaCombo(payload),
    }, { transaction });

    await this.sincronizarUpsells(comboInstancia.id, upsells, resultado, transaction);

    return comboInstancia;
  }

  /**
   * Actualiza un combo existente.
   * Recalcula y actualiza el snapshot económico.
   *
   * @param {number} comboId
   * @param {object} payload
   * @param {number} inquilino_id
   * @param {object} transaction
   */
  static async actualizar(comboId, payload, inquilino_id, transaction, opciones = {}) {
    const combo = await ProductoCombo.findOne({
      where: { id: comboId, inquilino_id },
      transaction,
    });
    if (!combo) throw new Error('Combo no encontrado.');

    const { nombre, descripcion, precio_total, principalProductId, precio_minimo, upsells = [], fecha_inicio, fecha_fin } = payload;
    const hasPrecioMinimo = 'precio_minimo' in payload;

    const pId = principalProductId || combo.producto_id;
    const upsList = upsells;

    if (parseFloat(precio_total) < 0) throw new Error('El precio del combo no puede ser negativo.');

    // Resolver valores efectivos (el payload puede ser parcial) para validar
    // el piso de venta con los datos que realmente van a quedar guardados.
    const precioTotalEfectivo = precio_total !== undefined ? parseFloat(precio_total) || 0 : parseFloat(combo.precio_total);
    const precioMinimoEfectivo = hasPrecioMinimo
      ? this.parsearPrecioMinimo(precio_minimo)
      : (combo.precio_minimo !== null ? parseFloat(combo.precio_minimo) : null);
      
    if (precioMinimoEfectivo && precioTotalEfectivo < precioMinimoEfectivo) {
      throw new Error(`El precio del combo (${precioTotalEfectivo}) no puede ser menor al precio mínimo configurado (${precioMinimoEfectivo}).`);
    }

    // Recalcular snapshot con valores actuales del catálogo
    const resultado = await this.simular(pId, upsList, inquilino_id, opciones);
    const config = await ComboConfiguracionService.obtenerOCrear(inquilino_id);

    const updates = {
      ...(nombre !== undefined && { nombre: nombre.trim() }),
      ...(descripcion !== undefined && { descripcion: descripcion?.trim() || null }),
      ...(precio_total !== undefined && { precio_total: parseFloat(precio_total) }),
      ...(hasPrecioMinimo && { precio_minimo: precioMinimoEfectivo }),
      ...(principalProductId !== undefined && { producto_id: principalProductId }),
      ...(fecha_inicio !== undefined && { fecha_inicio }),
      ...(fecha_fin !== undefined && { fecha_fin }),
      ...this.buildSnapshot(resultado, config),
      ...this.camposVistaCombo(payload),
    };

    await combo.update(updates, { transaction });
    await this.sincronizarUpsells(combo.id, upsList, resultado, transaction);

    return combo;
  }

  /**
   * Cambia el estado del combo (BORRADOR → ACTIVO → INACTIVO).
   * Sincroniza el campo legacy `activo` para compatibilidad.
   *
   * @param {number} comboId
   * @param {'BORRADOR'|'ACTIVO'|'INACTIVO'} nuevoEstado
   * @param {number} inquilino_id
   * @param {object} transaction
   */
  static async cambiarEstado(comboId, nuevoEstado, inquilino_id, transaction) {
    const estadosValidos = ['BORRADOR', 'ACTIVO', 'INACTIVO'];
    if (!estadosValidos.includes(nuevoEstado)) {
      throw new Error(`Estado inválido. Valores permitidos: ${estadosValidos.join(', ')}.`);
    }

    const combo = await ProductoCombo.findOne({
      where: { id: comboId, inquilino_id },
      transaction,
    });
    if (!combo) throw new Error('Combo no encontrado.');

    await combo.update({
      estado: nuevoEstado,
      activo: nuevoEstado === 'ACTIVO', // Sincronización con campo legacy
    }, { transaction });

    return combo;
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Construye el objeto de snapshot a partir del resultado del motor y la configuración.
   */
  static buildSnapshot(motorResult, config) {
    return {
      snapshot_cpa_porcentaje: parseFloat(config.cpa_porcentaje),
      snapshot_costo_envio: parseFloat(config.costo_envio),
      snapshot_costo_confirmacion: parseFloat(config.costo_confirmacion),
      snapshot_costo_empaque: parseFloat(config.costo_empaque),
      snapshot_precio_original: motorResult.combo.originalPrice,
      snapshot_precio_final: motorResult.combo.finalPrice,
      snapshot_costo_total: motorResult.combo.totalCost,
      snapshot_utilidad: motorResult.combo.profit,
      snapshot_margen: motorResult.combo.margin,
    };
  }

  /**
   * Sincroniza los upsells del combo con la DB.
   * Crea nuevos, actualiza existentes, elimina los que ya no están.
   * Guarda snapshots de precios del catálogo actual.
   *
   * @param {number} combo_id
   * @param {Array<{ productId, discountPercentage }>} upsellsPayload
   * @param {object} motorResult - Resultado del motor para snapshots
   * @param {object} transaction
   */
  static async sincronizarUpsells(combo_id, upsellsPayload, motorResult, transaction) {
    const actuales = await ProductoComboItem.findAll({
      where: { combo_id },
      transaction,
    });

    const mapaActuales = new Map(actuales.map(i => [i.producto_incluido_id, i]));
    const idsRecibidos = new Set();

    for (let idx = 0; idx < upsellsPayload.length; idx++) {
      const u = upsellsPayload[idx];
      const pId = Number(u.productId);
      const descPct = parseFloat(u.discountPercentage) || 0;
      const upsellResult = motorResult.upsells[idx];

      idsRecibidos.add(pId);
      const existente = mapaActuales.get(pId);

      const snapshotData = upsellResult ? {
        snapshot_costo: upsellResult.cost,
        snapshot_precio_base: upsellResult.originalPrice,
        snapshot_precio_final: upsellResult.finalPrice,
      } : {};

      if (existente) {
        await existente.update({
          descuento_porcentaje: descPct,
          orden: idx,
          ...snapshotData,
        }, { transaction });
      } else {
        await ProductoComboItem.create({
          combo_id,
          producto_incluido_id: pId,
          cantidad: 1,
          descuento_porcentaje: descPct,
          orden: idx,
          ...snapshotData,
        }, { transaction });
      }
    }

    // Eliminar upsells que ya no están
    for (const actual of actuales) {
      if (!idsRecibidos.has(actual.producto_incluido_id)) {
        await actual.destroy({ transaction });
      }
    }
  }

  // ─── Compatibilidad — rutas originales de producto ────────────────────────

  /**
   * @deprecated Usar listar() con filtros en su lugar.
   * Mantenido para compatibilidad con /api/productos/:id/combos
   */
  static async listarPorProducto(producto_id, inquilino_id) {
    return ProductoCombo.findAll({
      where: { producto_id, inquilino_id },
      include: [{
        model: ProductoComboItem,
        as: 'items',
        include: [{
          model: Producto,
          as: 'producto_incluido',
          attributes: ['id', 'nombre', 'precio_base', 'sku'],
        }],
      }],
      order: [['created_at', 'DESC']],
    });
  }
}

module.exports = ComboService;
