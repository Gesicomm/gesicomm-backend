'use strict';

/**
 * Servicio de "Vitrina" — catálogo y precios propios del rol 'usuario'.
 *
 * Un usuario con rol 'usuario' ve el mismo catálogo activo que administra
 * el admin (productos + combos), pero puede definir su PROPIO precio de
 * venta para cada uno (pensado para su futura landing), siempre que no
 * caiga por debajo del precio_minimo que fijó el admin.
 *
 * precio_costo NUNCA se expone a este rol. El análisis de sensibilidad
 * sí expone utilidad/margen derivados (pedido explícito de negocio),
 * pero no el costo crudo.
 */

const { Op } = require('sequelize');
const { Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario } = require('../models');
const ComboConfiguracionService = require('./comboConfiguracion.service');
const ComboService = require('./combo.service');
const comboPricing = require('../utils/comboPricing');

class PrecioUsuarioService {

  static async obtenerPrecioPersonalizado(usuario_id, tipo, referencia_id) {
    return PrecioUsuario.findOne({ where: { usuario_id, tipo, referencia_id } });
  }

  /**
   * Adjunta label/severity (comboPricing.RENTABILIDAD_META) a cada fila de
   * sensibilidad. El frontend nunca debe reimplementar este mapeo: lee
   * `label`/`severity` directo de la respuesta.
   */
  static anotarSensibilidad(filas) {
    return filas.map(fila => ({ ...fila, ...comboPricing.RENTABILIDAD_META[fila.status] }));
  }

  static anotarEstado(margin, minimumMarginDecimal) {
    const status = comboPricing.clasificarRentabilidad(margin, minimumMarginDecimal);
    return { status, ...comboPricing.RENTABILIDAD_META[status] };
  }

  // ─── Catálogo combinado (productos + combos) ──────────────────────────────

  static async listarCatalogo(usuario_id, inquilino_id) {
    // productos/combos/precios son independientes entre sí — se resuelven en
    // paralelo en vez de uno atrás de otro para no acumular latencia de red
    // por cada ida-vuelta a la base.
    const [productos, combos, precios] = await Promise.all([
      Producto.findAll({
        where: { inquilino_id, activo: true, estado_venta: 'en_venta' },
        attributes: ['id', 'nombre', 'descripcion_corta', 'descripcion_larga', 'precio_base', 'precio_minimo'],
        order: [['nombre', 'ASC']],
      }),
      ProductoCombo.findAll({
        where: { inquilino_id, estado: 'ACTIVO' },
        attributes: ['id', 'nombre', 'descripcion', 'precio_total', 'precio_minimo', 'producto_id'],
        include: [{
          model: ProductoComboItem,
          as: 'items',
          attributes: ['id'],
          include: [{ model: Producto, as: 'producto_incluido', attributes: ['id', 'nombre'] }],
        }],
        order: [['nombre', 'ASC']],
      }),
      PrecioUsuario.findAll({ where: { usuario_id } }),
    ]);

    const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, parseFloat(p.precio)]));

    // Depende de los IDs de productos recién resueltos, no se puede paralelizar con lo anterior.
    const productIds = productos.map(p => p.id);
    const imgMap = new Map();
    if (productIds.length > 0) {
      const imagenes = await ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: productIds }, es_principal: true },
        attributes: ['producto_id', 'url'],
      });
      imagenes.forEach(img => imgMap.set(img.producto_id, img.url));
    }

    const productosDto = productos.map(p => {
      const precioUsuario = mapaPrecios.has(`producto:${p.id}`) ? mapaPrecios.get(`producto:${p.id}`) : null;
      const precioBase = parseFloat(p.precio_base);
      return {
        id: p.id,
        tipo: 'producto',
        nombre: p.nombre,
        descripcion: p.descripcion_corta,
        descripcion_larga: p.descripcion_larga,
        precio_base: precioBase,
        precio_minimo: p.precio_minimo !== null ? parseFloat(p.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        imagen: imgMap.get(p.id) || null,
      };
    });

    const combosDto = combos.map(c => {
      const precioUsuario = mapaPrecios.has(`combo:${c.id}`) ? mapaPrecios.get(`combo:${c.id}`) : null;
      const precioBase = parseFloat(c.precio_total);
      return {
        id: c.id,
        tipo: 'combo',
        nombre: c.nombre,
        descripcion: c.descripcion,
        precio_base: precioBase,
        precio_minimo: c.precio_minimo !== null ? parseFloat(c.precio_minimo) : null,
        precio_usuario: precioUsuario,
        precio_efectivo: precioUsuario !== null ? precioUsuario : precioBase,
        productos_incluidos: (c.items || []).map(i => i.producto_incluido?.nombre).filter(Boolean),
      };
    });

    return { productos: productosDto, combos: combosDto };
  }

  // ─── Guardar precio propio ─────────────────────────────────────────────────

  static async guardarPrecioProducto(usuario_id, inquilino_id, producto_id, precio) {
    const producto = await Producto.findOne({ where: { id: producto_id, inquilino_id, activo: true } });
    if (!producto) throw new Error('Producto no encontrado.');
    return this._guardar(usuario_id, inquilino_id, 'producto', producto.id, precio, producto.precio_minimo);
  }

  static async guardarPrecioCombo(usuario_id, inquilino_id, combo_id, precio) {
    const combo = await ProductoCombo.findOne({ where: { id: combo_id, inquilino_id, estado: 'ACTIVO' } });
    if (!combo) throw new Error('Combo no encontrado.');
    return this._guardar(usuario_id, inquilino_id, 'combo', combo.id, precio, combo.precio_minimo);
  }

  static async _guardar(usuario_id, inquilino_id, tipo, referencia_id, precio, precioMinimo) {
    const precioNum = parseFloat(precio);
    if (isNaN(precioNum) || precioNum <= 0) {
      throw new Error('El precio debe ser un número mayor a cero.');
    }

    const minimo = precioMinimo !== null && precioMinimo !== undefined ? parseFloat(precioMinimo) : null;
    if (minimo && precioNum < minimo) {
      throw new Error(`El precio (${precioNum}) no puede ser menor al precio mínimo (${minimo}).`);
    }

    const [registro] = await PrecioUsuario.findOrCreate({
      where: { usuario_id, tipo, referencia_id },
      defaults: { usuario_id, inquilino_id, tipo, referencia_id, precio: precioNum },
    });

    if (parseFloat(registro.precio) !== precioNum) {
      registro.precio = precioNum;
      await registro.save();
    }

    return { tipo, referencia_id, precio: precioNum };
  }

  // ─── Análisis de sensibilidad ───────────────────────────────────────────────

  static async analizarSensibilidadProducto(usuario_id, inquilino_id, producto_id) {
    const producto = await Producto.findOne({ where: { id: producto_id, inquilino_id, activo: true } });
    if (!producto) throw new Error('Producto no encontrado.');
    if (!producto.precio_costo) throw new Error('Este producto no tiene análisis de rentabilidad configurado.');

    // config y precioPersonalizado no dependen entre sí — en paralelo.
    const [config, precioPersonalizado] = await Promise.all([
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'producto', producto.id),
    ]);
    const costs = ComboConfiguracionService.toMotorCosts(config);
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(producto.precio_base);

    const principalResult = comboPricing.calcularPrincipal(
      { cost: parseFloat(producto.precio_costo), salePrice: precioEfectivo },
      costs,
    );

    const sensitivity = this.anotarSensibilidad(comboPricing.calcularSensibilidad(
      { finalPrice: precioEfectivo, totalCost: principalResult.totalCosts },
      config.escenarios_descuento || undefined,
      { minimumMargin: minimumMarginDecimal },
    ));

    return {
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        precio_base: parseFloat(producto.precio_base),
        precio_minimo: producto.precio_minimo !== null ? parseFloat(producto.precio_minimo) : null,
        precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
        precio_efectivo: precioEfectivo,
      },
      profit: principalResult.profit,
      margin: principalResult.margin,
      estado: this.anotarEstado(principalResult.margin, minimumMarginDecimal),
      sensitivity,
    };
  }

  static async analizarSensibilidadCombo(usuario_id, inquilino_id, combo_id) {
    const combo = await ProductoCombo.findOne({
      where: { id: combo_id, inquilino_id, estado: 'ACTIVO' },
      include: [{ model: ProductoComboItem, as: 'items' }],
    });
    if (!combo) throw new Error('Combo no encontrado.');

    const upsellsPayload = combo.items.map(i => ({
      productId: i.producto_incluido_id,
      discountPercentage: parseFloat(i.descuento_porcentaje) || 0,
    }));

    // Reutiliza el motor de combos: resuelve costos reales del catálogo,
    // nunca confía en precios enviados por el cliente. Ninguna de estas tres
    // llamadas depende del resultado de las otras (todas parten de `combo`,
    // ya resuelto arriba), así que van en paralelo — antes pedían la
    // configuración económica del tenant DOS veces (una adentro de
    // ComboService.simular y otra acá) de forma innecesariamente secuencial.
    const [resultado, config, precioPersonalizado] = await Promise.all([
      ComboService.simular(combo.producto_id, upsellsPayload, inquilino_id),
      ComboConfiguracionService.obtenerOCrear(inquilino_id),
      this.obtenerPrecioPersonalizado(usuario_id, 'combo', combo.id),
    ]);
    const minimumMarginDecimal = (parseFloat(config.margen_minimo) || 10) / 100;

    const precioEfectivo = precioPersonalizado ? parseFloat(precioPersonalizado.precio) : parseFloat(combo.precio_total);

    const totalCost = resultado.combo.totalCost;
    const profit = Math.round((precioEfectivo - totalCost) * 100) / 100;
    const margin = precioEfectivo > 0 ? Math.round((profit / precioEfectivo) * 10000) / 10000 : 0;

    const sensitivity = this.anotarSensibilidad(comboPricing.calcularSensibilidad(
      { finalPrice: precioEfectivo, totalCost },
      config.escenarios_descuento || undefined,
      { minimumMargin: minimumMarginDecimal },
    ));

    return {
      combo: {
        id: combo.id,
        nombre: combo.nombre,
        precio_base: parseFloat(combo.precio_total),
        precio_minimo: combo.precio_minimo !== null ? parseFloat(combo.precio_minimo) : null,
        precio_usuario: precioPersonalizado ? parseFloat(precioPersonalizado.precio) : null,
        precio_efectivo: precioEfectivo,
      },
      profit,
      margin,
      estado: this.anotarEstado(margin, minimumMarginDecimal),
      comparison: resultado.comparison,
      sensitivity,
      warnings: resultado.warnings,
    };
  }
}

module.exports = PrecioUsuarioService;
