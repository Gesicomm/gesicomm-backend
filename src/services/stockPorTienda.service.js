'use strict';

const { Op } = require('sequelize');
const { InventarioUbicacion, Deposito, Producto, ProductoVariante, Usuario, Rol } = require('../models');

/**
 * Cuánto stock de un producto es de UNA tienda.
 *
 * El total del producto (Producto.cantidad_disponible, ProductoVariante.stock)
 * es uno solo para toda la cuenta, pero los depósitos y salones son de una
 * tienda (Deposito.tienda_id). Con 2+ tiendas, una tienda no puede vender lo
 * que está cargado en las ubicaciones de otra: no lo tiene.
 *
 * La regla es una sola y la usan los tres lugares que deciden si se puede
 * vender — la tienda pública (marca "sin stock"), el checkout (rechaza la
 * compra) y la confirmación del pedido (envioController) — para que nunca se
 * contradigan: lo que la vitrina ofrece es lo que después se puede confirmar.
 *
 *   - Si el producto NO tiene stock cargado en ubicaciones de otra tienda, no
 *     hay nada que repartir: vale el total, como siempre. Esto cubre las
 *     cuentas de una sola tienda y los productos sin stock por ubicación.
 *   - Si lo tiene, esta tienda dispone solo de lo cargado en SUS ubicaciones
 *     (más los Centros Gesicomm, si despacha con esa modalidad).
 */

const clave = (productoId, varianteId) => `${productoId}:${varianteId || ''}`;

/**
 * Por producto/variante, cuántas unidades disponibles hay en las ubicaciones
 * de la tienda y cuántas en las de otras tiendas de la misma cuenta.
 *
 * @returns {Promise<Map<string, {enLaTienda:number, enOtraTienda:number}>>}
 *   indexado por `${producto_id}:${variante_id || ''}`. Sin entrada = sin
 *   stock cargado por ubicación.
 */
async function repartoPorTienda({ usuarioId, tiendaId, permiteGesicomm = false, productoIds = [], transaction } = {}) {
  const reparto = new Map();
  const ids = [...new Set((productoIds || []).map(Number).filter(Boolean))];
  if (!usuarioId || !tiendaId || ids.length === 0) return reparto;

  const filas = await InventarioUbicacion.findAll({
    where: {
      usuario_id: usuarioId,
      producto_id: { [Op.in]: ids },
      cantidad_disponible: { [Op.gt]: 0 },
    },
    attributes: ['producto_id', 'variante_id', 'cantidad_disponible'],
    include: [{ model: Deposito, as: 'Deposito', where: { activo: true }, attributes: ['tienda_id', 'alcance'] }],
    transaction,
  });

  for (const fila of filas) {
    const cantidad = parseInt(fila.cantidad_disponible, 10) || 0;
    const deposito = fila.Deposito;
    const k = clave(fila.producto_id, fila.variante_id);
    const actual = reparto.get(k) || { enLaTienda: 0, enOtraTienda: 0 };

    if (deposito.alcance === 'GESICOMM') {
      // Un centro de la red no es de ninguna tienda: cuenta solo si esta
      // tienda despacha con Gesicomm, y nunca como stock "de otra tienda".
      if (permiteGesicomm) actual.enLaTienda += cantidad;
    } else if (Number(deposito.tienda_id) === Number(tiendaId)) {
      actual.enLaTienda += cantidad;
    } else if (deposito.tienda_id != null) {
      actual.enOtraTienda += cantidad;
    }
    // tienda_id NULL en una ubicación propia = fila vieja sin asignar: no es
    // de esta tienda ni prueba que sea de otra, así que no cambia nada.

    reparto.set(k, actual);
  }
  return reparto;
}

/** El stock del que dispone la tienda, dado el total y su reparto. */
function stockParaLaTienda(stockTotal, entrada) {
  if (stockTotal === null || stockTotal === undefined) return stockTotal; // no rastrea stock
  if (!entrada || !(entrada.enOtraTienda > 0)) return stockTotal;
  return Math.max(0, Math.min(Number(stockTotal) || 0, entrada.enLaTienda));
}

function asignar(registro, campo, valor) {
  if (typeof registro.setDataValue === 'function') registro.setDataValue(campo, valor);
  else registro[campo] = valor;
}

/**
 * El catálogo del administrador/global siempre está disponible. Aplica el
 * contrato stock=null en memoria, sin alterar las cantidades almacenadas.
 * Se comparte entre publicación, tienda pública y checkout.
 */
async function ajustarStockCatalogoAdmin(inquilinoId, { productos = [], variantes = [] } = {}) {
  const listaProductos = (productos || []).filter(Boolean);
  const listaVariantes = (variantes || []).filter(Boolean);
  const productoIds = [...listaProductos.map(p => p.id), ...listaVariantes.map(v => v.producto_id)];
  if (productoIds.length === 0) return new Set();

  // El catálogo global/admin se vende sin límite de unidades. null es el
  // contrato público de stock ilimitado, también para variantes y checkout.
  const administradores = await Usuario.findAll({
    where: { inquilino_id: inquilinoId },
    attributes: ['id'],
    include: [{ model: Rol, attributes: [], where: { nombre: 'administrador' }, required: true }],
    raw: true,
  });
  const admins = new Set(administradores.map(u => Number(u.id)));
  const conocidos = new Set(listaProductos.filter(p => p.creado_por !== undefined).map(p => Number(p.id)));
  const faltantes = [...new Set(productoIds.map(Number))].filter(id => !conocidos.has(id));
  const padres = faltantes.length ? await Producto.findAll({
    where: { id: { [Op.in]: faltantes }, inquilino_id: inquilinoId },
    attributes: ['id', 'creado_por'],
  }) : [];
  const ilimitados = new Set();
  for (const producto of [...listaProductos, ...padres]) {
    if (producto.creado_por === null || admins.has(Number(producto.creado_por))) {
      ilimitados.add(Number(producto.id));
    }
  }
  for (const producto of listaProductos) {
    if (ilimitados.has(Number(producto.id))) asignar(producto, 'cantidad_disponible', null);
  }
  for (const variante of listaVariantes) {
    if (ilimitados.has(Number(variante.producto_id))) asignar(variante, 'stock', null);
  }
  return ilimitados;
}

/** Ajusta en memoria el stock propio a la tienda y conserva el admin ilimitado. */
async function ajustarStockALaTienda(tienda, { productos = [], variantes = [] } = {}) {
  if (!tienda?.id || !tienda.usuario_id) return;
  const listaProductos = (productos || []).filter(Boolean);
  const listaVariantes = (variantes || []).filter(Boolean);
  const productoIds = [...listaProductos.map(p => p.id), ...listaVariantes.map(v => v.producto_id)];
  if (!productoIds.length) return;
  const ilimitados = await ajustarStockCatalogoAdmin(tienda.inquilino_id, { productos: listaProductos, variantes: listaVariantes });

  const reparto = await repartoPorTienda({
    usuarioId: tienda.usuario_id,
    tiendaId: tienda.id,
    permiteGesicomm: tienda.modalidad_fulfillment === 'GESICOMM',
    productoIds,
  });

  const afectados = new Set();
  for (const [k, entrada] of reparto) {
    if (entrada.enOtraTienda > 0) afectados.add(Number(k.split(':')[0]));
  }
  if (afectados.size === 0) return;

  for (const variante of listaVariantes) {
    if (ilimitados.has(Number(variante.producto_id))) continue;
    if (!afectados.has(Number(variante.producto_id))) continue;
    asignar(variante, 'stock', stockParaLaTienda(variante.stock, reparto.get(clave(variante.producto_id, variante.id))));
  }

  const productosAfectados = listaProductos.filter(p => afectados.has(Number(p.id)));
  if (productosAfectados.length === 0) return;

  // El total de un producto con variantes es la suma de sus variantes, así
  // que su stock para la tienda también: se lee de la base y no de
  // `variantes`, que puede no traerlas (el catálogo paginado no las carga) o
  // traerlas ya ajustadas.
  const variantesReales = await ProductoVariante.findAll({
    where: { producto_id: { [Op.in]: productosAfectados.map(p => p.id) }, activo: true },
    attributes: ['id', 'producto_id', 'stock'],
  });
  const variantesPorProducto = new Map();
  for (const v of variantesReales) {
    const lista = variantesPorProducto.get(v.producto_id) || [];
    lista.push(v);
    variantesPorProducto.set(v.producto_id, lista);
  }

  for (const producto of productosAfectados) {
    const total = producto.cantidad_disponible;
    if (total === null || total === undefined) continue;
    const propias = variantesPorProducto.get(producto.id);
    const paraLaTienda = propias?.length
      ? propias.reduce((acc, v) => acc + (stockParaLaTienda(v.stock, reparto.get(clave(producto.id, v.id))) || 0), 0)
      : stockParaLaTienda(total, reparto.get(clave(producto.id, null)));
    asignar(producto, 'cantidad_disponible', Math.max(0, Math.min(Number(total) || 0, paraLaTienda)));
  }
}

module.exports = { clave, repartoPorTienda, stockParaLaTienda, ajustarStockALaTienda, ajustarStockCatalogoAdmin };
