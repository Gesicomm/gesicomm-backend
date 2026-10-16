'use strict';

/**
 * Feed de productos para el Catálogo de Meta (Commerce Manager → "scheduled
 * fetch" de una URL, CSV). El id de cada fila es a propósito el mismo
 * content_id que ya usan el Pixel y la Conversions API (ver
 * metaCapi.service.js y LandingService.obtenerCatalogoParaEvento): así Meta
 * puede cruzar un evento ViewContent/Purchase con la fila del catálogo sin
 * que el comercio tenga que mapear nada a mano.
 *
 * Arma el CSV en lotes (no carga el catálogo entero a memoria): el mismo
 * error — traer todo un catálogo grande de una — tumbó el backend por OOM
 * el 2026-10-16 (ver mcp.service.js, obtenerContextoComercial).
 */

const { Op } = require('sequelize');
const { Producto, ProductoImagen, Marca, PrecioUsuario } = require('../models');
const LandingService = require('./landing.service');
const PricingService = require('./pricing.service');
const StockPorTienda = require('./stockPorTienda.service');

const TAMANO_LOTE = 200;

const CAMPOS_CSV = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];

function dominioDeTienda(tienda) {
  return tienda.dominio_propio_verificado && tienda.dominio_propio_habilitado && tienda.dominio_propio
    ? tienda.dominio_propio
    : `${tienda.subdominio}.${process.env.TIENDA_DOMINIO_BASE || 'gesicomm.com'}`;
}

/** Despoja tags HTML y colapsa espacios — descripcion_larga se guarda como HTML del editor. */
function textoPlano(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una celda CSV: comillas dobles si tiene coma, comilla o salto de línea (RFC 4180). */
function celda(valor) {
  const texto = String(valor ?? '');
  return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function filaCsv(producto, dominio) {
  const contentId = producto.slug || `producto-${producto.id}`;
  const descripcion = textoPlano(producto.descripcion_corta || producto.descripcion_larga).slice(0, 5000);
  const disponible = producto.cantidad_disponible === null || producto.cantidad_disponible === undefined
    ? true // no rastrea stock: siempre a la venta, mismo criterio que la vitrina pública
    : Number(producto.cantidad_disponible) > 0;

  const fila = {
    id: contentId,
    title: producto.nombre,
    description: descripcion || producto.nombre,
    availability: disponible ? 'in stock' : 'out of stock',
    condition: 'new',
    price: `${Math.round(producto.precio_efectivo)} PYG`,
    link: `https://${dominio}/${contentId}`,
    image_link: producto.imagen_principal,
    brand: producto.Marca?.nombre || producto.marca_nombre_tienda,
  };
  return CAMPOS_CSV.map(campo => celda(fila[campo])).join(',');
}

/**
 * Generador async: produce líneas CSV (sin el salto de línea final, lo pone
 * el llamador) de a un lote por vez. El cursor es el id, no OFFSET — con un
 * catálogo que cambia mientras se pagina, OFFSET repite o salta filas.
 */
async function* filasFeed(tienda) {
  const visibles = await LandingService.whereVisibleEnTienda(tienda);
  let ultimoId = 0;
  for (;;) {
    const productos = await Producto.findAll({
      where: { id: { [Op.gt]: ultimoId }, activo: true, estado_venta: 'en_venta', ...visibles },
      attributes: [
        'id', 'slug', 'nombre', 'descripcion_corta', 'descripcion_larga',
        'precio_base', 'precio_minimo', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin',
        'cantidad_disponible',
      ],
      include: [{ model: Marca, attributes: ['nombre'] }],
      order: [['id', 'ASC']],
      limit: TAMANO_LOTE,
    });
    if (!productos.length) return;
    ultimoId = productos[productos.length - 1].id;

    await StockPorTienda.ajustarStockALaTienda(tienda, { productos });

    const ids = productos.map(p => p.id);
    const [imagenes, precios] = await Promise.all([
      ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: ids } },
        attributes: ['producto_id', 'url', 'es_principal', 'orden'],
      }),
      PrecioUsuario.findAll({
        where: { usuario_id: tienda.usuario_id, tipo: 'producto', referencia_id: { [Op.in]: ids } },
      }),
    ]);
    const imagenPrincipalPorProducto = new Map();
    for (const img of imagenes) {
      const actual = imagenPrincipalPorProducto.get(img.producto_id);
      const esMejor = !actual || (img.es_principal && !actual.es_principal)
        || (img.es_principal === actual.es_principal && (img.orden || 0) < (actual.orden || 0));
      if (esMejor) imagenPrincipalPorProducto.set(img.producto_id, img);
    }
    const precioUsuarioPorProducto = new Map(precios.map(p => [p.referencia_id, parseFloat(p.precio)]));

    const dominio = dominioDeTienda(tienda);
    const lineas = [];
    for (const producto of productos) {
      const imagen = imagenPrincipalPorProducto.get(producto.id);
      if (!imagen?.url) continue; // Meta exige image_link — sin foto no entra al catálogo.

      const precioMinimo = producto.precio_minimo !== null && producto.precio_minimo !== undefined
        ? parseFloat(producto.precio_minimo) : null;
      const baseConDescuento = PricingService.aplicarDescuentoFecha(
        parseFloat(producto.precio_base), producto.descuento_porcentaje, producto.descuento_inicio, producto.descuento_fin,
      );
      const { efectivo } = PricingService.calcularPrecioBase(baseConDescuento, precioMinimo, precioUsuarioPorProducto.get(producto.id));

      producto.setDataValue('imagen_principal', imagen.url);
      producto.setDataValue('precio_efectivo', efectivo);
      producto.setDataValue('marca_nombre_tienda', tienda.nombre);
      lineas.push(filaCsv(producto, dominio));
    }
    yield lineas;

    if (productos.length < TAMANO_LOTE) return;
  }
}

module.exports = { filasFeed, filaCsv, dominioDeTienda, CAMPOS_CSV };
