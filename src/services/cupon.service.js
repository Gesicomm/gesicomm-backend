'use strict';

const { Op } = require('sequelize');
const { Cupon, CuponProducto, Producto, sequelize } = require('../models');

/**
 * Cupones de descuento: alta/baja/edición para el comercio, y validación +
 * cálculo del descuento para el checkout público.
 *
 * Regla central: el cupón NUNCA puede dejar una línea por debajo del
 * `precio_minimo` que fijó el admin para ese producto. Es el mismo piso que
 * ya respetan las variantes y los descuentos por fecha en PricingService —
 * si el cupón pudiera perforarlo, el comercio podría vender a pérdida sin
 * enterarse por escribir un código en el checkout.
 */

/** Normaliza como se guarda y como se compara: sin espacios y en MAYÚSCULAS. */
function normalizarCodigo(codigo) {
  return String(codigo || '').trim().toUpperCase();
}

/** Fecha de hoy en Asunción, en formato YYYY-MM-DD (igual que el resto del sistema). */
function hoyPy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
}

class CuponService {
  static serializar(cupon) {
    const data = cupon.toJSON ? cupon.toJSON() : cupon;
    const estado = CuponService.estado(data);
    return {
      id: data.id,
      codigo: data.codigo,
      descuento_porcentaje: Number(data.descuento_porcentaje),
      alcance: data.alcance,
      fecha_vencimiento: data.fecha_vencimiento || null,
      max_usos: data.max_usos,
      usos: data.usos,
      activo: data.activo,
      producto_ids: (data.productos || []).map(p => p.producto_id),
      usos_restantes: data.max_usos == null ? null : Math.max(0, Number(data.max_usos) - Number(data.usos || 0)),
      estado_motivo: estado.motivo,
      // Se calcula acá y no en el frontend para que la lista y el checkout
      // usen exactamente el mismo criterio de "está vigente".
      vigente: estado.vigente,
    };
  }

  static estaVigente(data) {
    return CuponService.estado(data).vigente;
  }

  static estado(data) {
    if (!data.activo) return { vigente: false, motivo: 'desactivado' };
    if (data.fecha_vencimiento && data.fecha_vencimiento < hoyPy()) return { vigente: false, motivo: 'vencido' };
    if (data.max_usos != null && Number(data.usos || 0) >= Number(data.max_usos)) return { vigente: false, motivo: 'agotado' };
    return { vigente: true, motivo: 'vigente' };
  }

  static async listar(usuario_id) {
    const cupones = await Cupon.findAll({
      where: { usuario_id },
      include: [{ model: CuponProducto, as: 'productos', attributes: ['producto_id'] }],
      order: [['created_at', 'DESC']],
    });
    return cupones.map(this.serializar);
  }

  static async crear(datos, usuario_id, inquilino_id) {
    const codigo = normalizarCodigo(datos.codigo);
    if (!codigo) throw new Error('El código del cupón es obligatorio.');

    const porcentaje = Number(datos.descuento_porcentaje);
    if (!(porcentaje > 0) || porcentaje > 100) {
      throw new Error('El descuento tiene que ser un porcentaje mayor a 0 y hasta 100.');
    }
    const maxUsos = datos.max_usos != null && datos.max_usos !== '' ? Number.parseInt(datos.max_usos, 10) : null;
    if (maxUsos != null && (!Number.isSafeInteger(maxUsos) || maxUsos < 1)) {
      throw new Error('El límite de canjes tiene que ser un número entero mayor a 0.');
    }

    const alcance = datos.alcance === 'productos' ? 'productos' : 'tienda';
    const productoIds = alcance === 'productos'
      ? [...new Set((datos.producto_ids || []).map(Number).filter(Boolean))]
      : [];
    if (alcance === 'productos' && productoIds.length === 0) {
      throw new Error('Elegí al menos un producto para un cupón de alcance limitado.');
    }

    const yaExiste = await Cupon.findOne({ where: { usuario_id, codigo } });
    if (yaExiste) throw new Error(`Ya tenés un cupón con el código "${codigo}".`);

    return sequelize.transaction(async (t) => {
      const cupon = await Cupon.create({
        inquilino_id,
        usuario_id,
        codigo,
        descuento_porcentaje: porcentaje,
        alcance,
        fecha_vencimiento: datos.fecha_vencimiento || null,
        max_usos: maxUsos,
        activo: datos.activo !== false,
      }, { transaction: t });

      if (productoIds.length > 0) {
        await CuponProducto.bulkCreate(
          productoIds.map(producto_id => ({ cupon_id: cupon.id, producto_id })),
          { transaction: t }
        );
      }
      return cupon.id;
    }).then(id => this.obtener(id, usuario_id));
  }

  static async obtener(id, usuario_id) {
    const cupon = await Cupon.findOne({
      where: { id, usuario_id },
      include: [{ model: CuponProducto, as: 'productos', attributes: ['producto_id'] }],
    });
    if (!cupon) throw new Error('Cupón no encontrado.');
    return this.serializar(cupon);
  }

  static async actualizar(id, datos, usuario_id) {
    // Buscar por id + usuario_id (y no solo por id) es lo que impide editar
    // el cupón de otro comercio pasando un id ajeno.
    const cupon = await Cupon.findOne({ where: { id, usuario_id } });
    if (!cupon) throw new Error('Cupón no encontrado.');

    const cambios = {};
    if (datos.descuento_porcentaje !== undefined) {
      const p = Number(datos.descuento_porcentaje);
      if (!(p > 0) || p > 100) throw new Error('El descuento tiene que ser un porcentaje mayor a 0 y hasta 100.');
      cambios.descuento_porcentaje = p;
    }
    if (datos.activo !== undefined) cambios.activo = !!datos.activo;
    if (datos.fecha_vencimiento !== undefined) cambios.fecha_vencimiento = datos.fecha_vencimiento || null;
    if (datos.max_usos !== undefined) {
      const maxUsos = datos.max_usos === '' || datos.max_usos == null ? null : Number.parseInt(datos.max_usos, 10);
      if (maxUsos != null && (!Number.isSafeInteger(maxUsos) || maxUsos < 1)) {
        throw new Error('El límite de canjes tiene que ser un número entero mayor a 0.');
      }
      cambios.max_usos = maxUsos;
    }
    // El código NO se puede cambiar: ya circula impreso o compartido, y
    // renombrarlo dejaría clientes con un código que dejó de existir.

    return sequelize.transaction(async (t) => {
      await cupon.update(cambios, { transaction: t });

      if (datos.producto_ids !== undefined && cupon.alcance === 'productos') {
        const ids = [...new Set((datos.producto_ids || []).map(Number).filter(Boolean))];
        if (ids.length === 0) throw new Error('Un cupón de alcance limitado necesita al menos un producto.');
        await CuponProducto.destroy({ where: { cupon_id: cupon.id }, transaction: t });
        await CuponProducto.bulkCreate(ids.map(producto_id => ({ cupon_id: cupon.id, producto_id })), { transaction: t });
      }
    }).then(() => this.obtener(id, usuario_id));
  }

  static async eliminar(id, usuario_id) {
    const cupon = await Cupon.findOne({ where: { id, usuario_id } });
    if (!cupon) throw new Error('Cupón no encontrado.');
    await cupon.destroy();
    return true;
  }

  /**
   * Valida un código para el comercio dueño de la tienda y calcula cuánto
   * descuenta sobre los items que ya trae el carrito.
   *
   * `items`: [{ producto_id, precio_unitario, cantidad }] — los precios ya
   * resueltos por PricingService, no los de lista.
   *
   * Devuelve { cupon, descuento, lineas } o lanza con un motivo legible:
   * el comprador tiene que entender por qué su código no anduvo.
   */
  static async validar(codigo, items, usuario_id) {
    const buscado = normalizarCodigo(codigo);
    if (!buscado) throw new Error('Escribí un código de cupón.');

    const cupon = await Cupon.findOne({
      where: { usuario_id, codigo: buscado },
      include: [{ model: CuponProducto, as: 'productos', attributes: ['producto_id'] }],
    });
    if (!cupon) throw new Error('Ese cupón no existe.');
    if (!cupon.activo) throw new Error('Ese cupón ya no está disponible.');
    if (cupon.fecha_vencimiento && cupon.fecha_vencimiento < hoyPy()) throw new Error('Ese cupón está vencido.');
    if (cupon.max_usos != null && cupon.usos >= cupon.max_usos) throw new Error('Ese cupón ya alcanzó su límite de usos.');

    const alcanzados = new Set((cupon.productos || []).map(p => p.producto_id));
    const porcentaje = Number(cupon.descuento_porcentaje);

    // El piso del admin se lee de la base, no se confía en lo que llegue
    // en el request: el precio_minimo es justamente lo que el comprador no
    // puede influir.
    const idsCarrito = [...new Set((items || []).map(i => Number(i.producto_id)).filter(Boolean))];
    const productos = idsCarrito.length
      ? await Producto.findAll({ where: { id: { [Op.in]: idsCarrito } }, attributes: ['id', 'precio_minimo'], raw: true })
      : [];
    const pisoPorProducto = new Map(productos.map(p => [p.id, p.precio_minimo != null ? Number(p.precio_minimo) : null]));

    let descuento = 0;
    const lineas = [];
    for (const item of items || []) {
      const productoId = Number(item.producto_id);
      const aplica = cupon.alcance === 'tienda' || alcanzados.has(productoId);
      if (!aplica) continue;

      const precio = Number(item.precio_unitario) || 0;
      const cantidad = Number(item.cantidad) || 1;
      const piso = pisoPorProducto.get(productoId);

      const conDescuento = precio * (1 - porcentaje / 100);
      const precioFinal = piso != null ? Math.max(conDescuento, piso) : conDescuento;
      const ahorroUnitario = Math.max(0, precio - precioFinal);
      if (ahorroUnitario <= 0) continue;

      descuento += ahorroUnitario * cantidad;
      lineas.push({ producto_id: productoId, ahorro_unitario: Math.round(ahorroUnitario), cantidad });
    }

    descuento = Math.round(descuento);
    if (descuento <= 0) {
      throw new Error(
        cupon.alcance === 'productos'
          ? 'Ese cupón no aplica a los productos de tu pedido.'
          : 'Ese cupón no genera descuento sobre este pedido.'
      );
    }

    return { cupon, descuento, lineas };
  }

  /** Se llama al crear el pedido, no al validar: validar no consume el cupón. */
  static async registrarUso(cupon_id, t) {
    await Cupon.increment('usos', { by: 1, where: { id: cupon_id }, transaction: t });
  }
}

module.exports = CuponService;
