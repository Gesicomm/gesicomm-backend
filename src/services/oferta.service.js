'use strict';

/**
 * Servicio de Ofertas comerciales — precio + receta de stock por producto.
 *
 * A diferencia de ProductoCombo (motor de márgenes CPA para bundles
 * principal+upsells), este servicio es deliberadamente simple: una Oferta
 * es "precio X vendido, receta Y descontada de stock". El backend nunca
 * confía en costos/márgenes calculados por el frontend — solo se muestran
 * a partir del catálogo real (precio_costo) al listar.
 */

const { Oferta, OfertaComponente, Producto } = require('../models');

const TIPOS_CONTENIDO = ['pack', 'combo'];
const ESTRATEGIAS = ['normal', 'order_bump', 'upsell'];

class OfertaService {

  /**
   * Normaliza y fusiona componentes por producto_id (si el payload trae el
   * mismo producto dos veces, se suman las cantidades en vez de rechazar o
   * duplicar), valida cantidad >= 1 y exige al menos un componente.
   */
  static normalizarComponentes(componentesPayload = []) {
    const mapa = new Map();
    for (const c of componentesPayload) {
      const productoId = Number(c.producto_id);
      const cantidad = parseInt(c.cantidad, 10) || 0;
      const descuentoPorcentaje = Math.min(100, Math.max(0, parseFloat(c.descuento_porcentaje) || 0));
      if (!productoId) throw new Error('Cada componente necesita un producto válido.');
      if (cantidad < 1) throw new Error('La cantidad de cada componente debe ser al menos 1.');
      // Fusionar por producto_id (regla existente) suma cantidades; el
      // descuento se queda con el último valor recibido para ese producto.
      const existente = mapa.get(productoId);
      mapa.set(productoId, { cantidad: (existente?.cantidad || 0) + cantidad, descuento_porcentaje: descuentoPorcentaje });
    }
    if (mapa.size === 0) throw new Error('La oferta necesita al menos un componente de stock.');
    return Array.from(mapa.entries()).map(([producto_id, v]) => ({ producto_id, cantidad: v.cantidad, descuento_porcentaje: v.descuento_porcentaje }));
  }

  /**
   * "Pack" es una presentación alternativa del propio producto ancla (ej.
   * "Earplugs x3") — no un bundle. Si permitiéramos otros productos ahí
   * dejaría de ser un pack y pasaría a comportarse como un combo sin
   * declararlo, confundiendo el modelo. "Combo" sí admite varios productos
   * libremente. estrategia y tipo_contenido quedan independientes a
   * propósito (un combo puede ser normal/order_bump/upsell igual que un
   * pack) — esta regla solo restringe qué productos puede tener cada uno.
   */
  static validarComponentesParaTipo(tipoContenido, productoAnclaId, componentes) {
    if (tipoContenido !== 'pack') return;
    const soloAncla = componentes.length === 1 && Number(componentes[0].producto_id) === Number(productoAnclaId);
    if (!soloAncla) {
      throw new Error('Un "pack" solo puede tener el producto ancla como componente (en la cantidad que corresponda). Para combinar varios productos, usá "combo".');
    }
  }

  static validarPayload(payload) {
    const { codigo, nombre, tipo_contenido, estrategia, precio } = payload;
    if (!codigo?.trim()) throw new Error('El código de la oferta es obligatorio.');
    if (!nombre?.trim()) throw new Error('El nombre de la oferta es obligatorio.');
    if (tipo_contenido !== undefined && !TIPOS_CONTENIDO.includes(tipo_contenido)) {
      throw new Error(`tipo_contenido inválido. Valores permitidos: ${TIPOS_CONTENIDO.join(', ')}.`);
    }
    if (estrategia !== undefined && !ESTRATEGIAS.includes(estrategia)) {
      throw new Error(`estrategia inválida. Valores permitidos: ${ESTRATEGIAS.join(', ')}.`);
    }
    if (parseFloat(precio) < 0) throw new Error('El precio de la oferta no puede ser negativo.');
  }

  /**
   * Lista las ofertas activas (o todas, si se pide) de un producto, con sus
   * componentes y el costo/margen calculado en vivo contra el catálogo
   * actual — esto es solo informativo para la pantalla de administración,
   * nunca se persiste (el costo real de una venta ya confirmada vive en
   * EnvioItemComponente, no acá).
   */
  static async listarPorProducto(producto_ancla_id, inquilino_id, { soloActivas = false } = {}) {
    const where = { producto_ancla_id, inquilino_id };
    if (soloActivas) where.activo = true;

    const ofertas = await Oferta.findAll({
      where,
      include: [{
        model: OfertaComponente,
        as: 'componentes',
        include: [{ model: Producto, as: 'producto', attributes: ['id', 'nombre', 'sku', 'precio_costo', 'cantidad_disponible'] }],
      }],
      order: [['orden', 'ASC'], ['created_at', 'ASC']],
    });

    return ofertas.map(o => this.conMargen(o));
  }

  static conMargen(ofertaInstancia) {
    const oferta = ofertaInstancia.toJSON();
    const costo = (oferta.componentes || []).reduce((acc, c) => {
      const costoUnit = parseFloat(c.producto?.precio_costo) || 0;
      return acc + costoUnit * c.cantidad;
    }, 0);
    const precio = parseFloat(oferta.precio) || 0;
    const ganancia = precio - costo;
    oferta.costo = costo;
    oferta.ganancia = ganancia;
    oferta.margen_pct = precio > 0 ? Number(((ganancia / precio) * 100).toFixed(1)) : 0;
    return oferta;
  }

  static async obtener(ofertaId, inquilino_id, transaction) {
    const oferta = await Oferta.findOne({
      where: { id: ofertaId, inquilino_id },
      include: [{ model: OfertaComponente, as: 'componentes' }],
      transaction,
    });
    if (!oferta) throw new Error('Oferta no encontrada.');
    return oferta;
  }

  static async crear(producto_ancla_id, payload, inquilino_id, transaction) {
    this.validarPayload(payload);
    const componentes = this.normalizarComponentes(payload.componentes);
    this.validarComponentesParaTipo(payload.tipo_contenido || 'pack', producto_ancla_id, componentes);

    const oferta = await Oferta.create({
      inquilino_id,
      producto_ancla_id,
      codigo: payload.codigo.trim(),
      nombre: payload.nombre.trim(),
      tipo_contenido: payload.tipo_contenido || 'pack',
      estrategia: payload.estrategia || 'normal',
      precio: parseFloat(payload.precio) || 0,
      descripcion: payload.descripcion?.trim() || null,
      activo: payload.activo === undefined ? true : !!payload.activo,
      orden: payload.orden || 0,
    }, { transaction });

    await OfertaComponente.bulkCreate(
      componentes.map(c => ({ ...c, oferta_id: oferta.id })),
      { transaction }
    );

    return this.obtener(oferta.id, inquilino_id, transaction);
  }

  static async actualizar(ofertaId, payload, inquilino_id, transaction) {
    const oferta = await Oferta.findOne({ where: { id: ofertaId, inquilino_id }, transaction });
    if (!oferta) throw new Error('Oferta no encontrada.');

    this.validarPayload({
      codigo: payload.codigo ?? oferta.codigo,
      nombre: payload.nombre ?? oferta.nombre,
      tipo_contenido: payload.tipo_contenido,
      estrategia: payload.estrategia,
      precio: payload.precio ?? oferta.precio,
    });

    const updates = {};
    if (payload.codigo !== undefined) updates.codigo = payload.codigo.trim();
    if (payload.nombre !== undefined) updates.nombre = payload.nombre.trim();
    if (payload.tipo_contenido !== undefined) updates.tipo_contenido = payload.tipo_contenido;
    if (payload.estrategia !== undefined) updates.estrategia = payload.estrategia;
    if (payload.precio !== undefined) updates.precio = parseFloat(payload.precio) || 0;
    if (payload.descripcion !== undefined) updates.descripcion = payload.descripcion?.trim() || null;
    if (payload.activo !== undefined) updates.activo = !!payload.activo;
    if (payload.orden !== undefined) updates.orden = payload.orden;

    // tipo_contenido y componentes pueden llegar en llamadas separadas —
    // hay que validar la combinación resultante contra lo que YA tiene la
    // oferta cuando uno de los dos no viene en este payload (ej.: pasar un
    // combo existente a "pack" sin reenviar componentes no debe dejar
    // guardado un pack con productos que no son el ancla).
    const tipoContenidoEfectivo = payload.tipo_contenido !== undefined ? payload.tipo_contenido : oferta.tipo_contenido;
    const componentesNuevos = payload.componentes !== undefined ? this.normalizarComponentes(payload.componentes) : null;
    const componentesParaValidar = componentesNuevos !== null
      ? componentesNuevos
      : (await OfertaComponente.findAll({ where: { oferta_id: oferta.id }, attributes: ['producto_id', 'cantidad'], transaction, raw: true }));
    this.validarComponentesParaTipo(tipoContenidoEfectivo, oferta.producto_ancla_id, componentesParaValidar);

    await oferta.update(updates, { transaction });

    if (componentesNuevos !== null) {
      await OfertaComponente.destroy({ where: { oferta_id: oferta.id }, transaction });
      await OfertaComponente.bulkCreate(
        componentesNuevos.map(c => ({ ...c, oferta_id: oferta.id })),
        { transaction }
      );
    }

    return this.obtener(oferta.id, inquilino_id, transaction);
  }

  /**
   * Baja lógica (activo=false) — nunca se borra en duro: pedidos históricos
   * referencian la oferta por oferta_id para trazabilidad, aunque el costo
   * real ya quedó snapshoteado aparte en EnvioItemComponente.
   */
  static async eliminar(ofertaId, inquilino_id, transaction) {
    const oferta = await Oferta.findOne({ where: { id: ofertaId, inquilino_id }, transaction });
    if (!oferta) throw new Error('Oferta no encontrada.');
    await oferta.update({ activo: false }, { transaction });
    return oferta;
  }
}

module.exports = OfertaService;
