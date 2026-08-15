'use strict';

/**
 * Pricing Engine centralizado — resuelve cuánto cuesta realmente un item
 * (producto/combo + variante + oferta + cantidad). Antes esta cuenta vivía
 * inline dentro de LandingService.crearCheckout, duplicada en espíritu con
 * obtenerPublica, y sin aplicar nunca el descuento por fecha del producto
 * (Producto.descuento_porcentaje/descuento_inicio/descuento_fin, calculado
 * en utils/precio.js pero usado solo para el historial de precios, nunca
 * para lo que efectivamente se cobraba).
 *
 * Es el único lugar donde se decide "cuánto cuesta esto". Lo consumen
 * landing.service.js (obtenerPublica/crearCheckout), el endpoint de
 * recálculo de carrito y el simulador de precio del admin — ninguno de
 * esos lugares vuelve a implementar esta cuenta por su cuenta.
 *
 * No hace queries a la base — recibe ya resueltos producto/combo/variantes/
 * ofertas (los callers ya los cargan para otras cosas), así queda puro y
 * fácil de testear/reusar.
 */

const { calcularPrecioEfectivo } = require('../utils/precio');

class PricingService {
  /**
   * base = precio propio de la vendedora si lo fijó, si no el precio de
   * lista (ya con el descuento por fecha aplicado, si corresponde).
   * efectivo = base con el piso (precio_minimo) ya aplicado.
   */
  static calcularPrecioBase(precioBase, precioMinimo, precioUsuario) {
    const base = precioUsuario !== undefined && precioUsuario !== null ? precioUsuario : precioBase;
    const efectivo = precioMinimo !== null ? Math.max(base, precioMinimo) : base;
    return { base, efectivo };
  }

  /**
   * precio_diferencial es un delta ABSOLUTO sobre `base` (ej: "el talle XL
   * cuesta 10.000 más"). El resultado se vuelve a pisar por precioMinimo —
   * ninguna variante puede venderse por debajo del piso.
   */
  static calcularPrecioVariante(base, precioDiferencial, precioMinimo) {
    let precio = base + parseFloat(precioDiferencial);
    if (precioMinimo !== null) precio = Math.max(precio, precioMinimo);
    return precio;
  }

  /**
   * Descuento por fecha del producto — delega en utils/precio.js (misma
   * fórmula que ya usa producto.service.js para el historial de precios),
   * pero ahora entra también al precio que efectivamente se cobra.
   */
  static aplicarDescuentoFecha(precioBase, descuentoPorcentaje, descuentoInicio, descuentoFin) {
    return calcularPrecioEfectivo(precioBase, descuentoPorcentaje, descuentoInicio, descuentoFin);
  }

  /**
   * "La cantidad decide el precio": si no vino una oferta elegida a mano,
   * busca entre las Ofertas activas del producto (tipo_contenido='pack',
   * estrategia='normal') una cuya receta pida exactamente esa cantidad del
   * producto ancla — ej. cantidad=3 matchea "Pack x3" si su
   * OfertaComponente dice {producto_id: ancla, cantidad: 3}. No inventa
   * ningún concepto nuevo: solo automatiza elegir una Oferta que ya existe,
   * en vez de obligar a seleccionarla aparte.
   */
  static mejorOfertaParaCantidad(productoAnclaId, cantidad, ofertasDelProducto = []) {
    return ofertasDelProducto.find(o =>
      o.activo !== false &&
      o.tipo_contenido === 'pack' &&
      o.estrategia === 'normal' &&
      (o.componentes || []).some(c => c.producto_id === productoAnclaId && c.cantidad === cantidad)
    ) || null;
  }

  /**
   * Resuelve el precio real de UN item de carrito/checkout/catálogo.
   * Mismo comportamiento que antes vivía inline en
   * LandingService.crearCheckout — ver el comentario de ese método para
   * el principio rector ("nunca confiar en el precio del cliente").
   *
   * @param {object} params
   * @param {object} params.entidad - fila de Producto o ProductoCombo ya cargada.
   * @param {boolean} params.esCombo
   * @param {number} params.cantidad
   * @param {number|null} [params.ofertaId] - oferta elegida explícitamente, si la hay.
   * @param {number|null} [params.varianteId]
   * @param {number|undefined} [params.precioUsuario] - precio propio de la vendedora, si fijó uno.
   * @param {Array} [params.ofertasDelProducto] - Oferta[] (con .componentes) de este producto_ancla.
   * @param {Array} [params.variantesDelProducto] - ProductoVariante[] de este producto.
   */
  static resolverPrecioItem({
    entidad,
    esCombo,
    cantidad,
    ofertaId = null,
    varianteId = null,
    precioUsuario,
    ofertasDelProducto = [],
    variantesDelProducto = [],
  }) {
    const cantidadFinal = Math.max(1, Math.min(99, Number.parseInt(cantidad, 10) || 1));

    const precioLista = parseFloat(esCombo ? entidad.precio_total : entidad.precio_base);
    const precioMinimo = entidad.precio_minimo !== null && entidad.precio_minimo !== undefined
      ? parseFloat(entidad.precio_minimo) : null;

    // El descuento por fecha es una propiedad de Producto — un combo ya
    // trae su precio_total fijado a mano por el admin, no tiene ventana de
    // descuento propia.
    const precioBaseConDescuento = esCombo
      ? precioLista
      : this.aplicarDescuentoFecha(precioLista, entidad.descuento_porcentaje, entidad.descuento_inicio, entidad.descuento_fin);

    const { base, efectivo } = this.calcularPrecioBase(precioBaseConDescuento, precioMinimo, precioUsuario);

    let precioFinal = efectivo;
    let nombreFinal = entidad.nombre;
    let ofertaResuelta = null;
    let varianteResuelta = null;
    const stockDisponible = esCombo ? (entidad.producto_padre?.cantidad_disponible ?? null) : entidad.cantidad_disponible;

    // "auto" (cantidad decide el precio) vs. "explícita" (oferta_id
    // elegido a mano) cambian qué representa `cantidad`:
    //  - explícita: cantidad = cuántos BULTOS de esa oferta ("2 packs de
    //    x3" = cantidad 2, oferta.precio es el precio de UN bulto) — igual
    //    que ya funcionaba el carrito antes de este cambio.
    //  - auto: cantidad = unidades físicas reales tipeadas en el stepper
    //    (matcheó porque la receta de la oferta pide exactamente esa
    //    cantidad), oferta.precio YA es el total para esa cantidad exacta
    //    — no hay "bultos" que multiplicar.
    let ofertaEsAutoMatch = false;
    if (!esCombo) {
      if (ofertaId) {
        const candidata = ofertasDelProducto.find(o => o.id === Number(ofertaId));
        if (candidata && candidata.producto_ancla_id === entidad.id) ofertaResuelta = candidata;
      } else {
        ofertaResuelta = this.mejorOfertaParaCantidad(entidad.id, cantidadFinal, ofertasDelProducto);
        ofertaEsAutoMatch = !!ofertaResuelta;
      }
    }

    let stockFinal = stockDisponible;
    if (ofertaResuelta) {
      const precioOferta = parseFloat(ofertaResuelta.precio) || 0;
      precioFinal = ofertaEsAutoMatch ? precioOferta / cantidadFinal : precioOferta;
      nombreFinal = `${entidad.nombre} — ${ofertaResuelta.nombre}`;
    } else if (!esCombo && varianteId) {
      varianteResuelta = variantesDelProducto.find(v => v.id === Number(varianteId));
      if (varianteResuelta) {
        precioFinal = this.calcularPrecioVariante(base, varianteResuelta.precio_diferencial, precioMinimo);
        stockFinal = varianteResuelta.stock;
        nombreFinal = `${entidad.nombre} (${varianteResuelta.nombre})`;
      }
    }

    return {
      entidad_id: entidad.id,
      es_combo: !!esCombo,
      cantidad: cantidadFinal,
      nombre_final: nombreFinal,
      precio_lista: precioLista,
      precio_unitario: precioFinal,
      subtotal: precioFinal * cantidadFinal,
      // Para el chequeo de stock del producto ancla mismo (no de los
      // componentes de una oferta, ver validarStock).
      stock_producto_ancla: stockDisponible,
      stock_disponible: stockFinal,
      oferta_aplicada: ofertaResuelta,
      oferta_auto_aplicada: ofertaEsAutoMatch,
      variante_aplicada: varianteResuelta,
    };
  }

  /**
   * Chequeo de stock de un item ya resuelto — separado de
   * resolverPrecioItem a propósito: crearCheckout necesita que esto TIRE
   * un error (409) y corte el pedido; el recálculo de carrito en vivo solo
   * necesita saber "alcanza sí/no" para avisar en la UI sin interrumpir al
   * usuario. Cada caller decide qué hacer con el resultado.
   */
  static validarStock(resuelto, { mapaProducto } = new Map()) {
    if (resuelto.oferta_aplicada) {
      const faltantes = [];
      for (const comp of resuelto.oferta_aplicada.componentes || []) {
        const esAncla = comp.producto_id === resuelto.entidad_id;
        const stockComp = esAncla ? resuelto.stock_producto_ancla : mapaProducto?.get(comp.producto_id)?.cantidad_disponible;
        // Auto-match: resuelto.cantidad ya son las unidades físicas reales
        // (matcheó porque comp.cantidad === cantidad), no se multiplica de
        // nuevo. Selección explícita: cantidad = cuántos bultos.
        const necesario = resuelto.oferta_auto_aplicada ? comp.cantidad : resuelto.cantidad * comp.cantidad;
        if (stockComp !== null && stockComp !== undefined && stockComp < necesario) {
          faltantes.push({ producto_id: comp.producto_id, disponible: stockComp, necesario });
        }
      }
      return { suficiente: faltantes.length === 0, faltantes };
    }
    const disponible = resuelto.stock_disponible;
    const suficiente = disponible === null || disponible === undefined || disponible >= resuelto.cantidad;
    return { suficiente, faltantes: suficiente ? [] : [{ producto_id: resuelto.entidad_id, disponible, necesario: resuelto.cantidad }] };
  }
}

module.exports = PricingService;
