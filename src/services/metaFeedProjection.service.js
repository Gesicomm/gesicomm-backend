'use strict';
const { Op } = require('sequelize');
const { Producto, ProductoCombo, ProductoImagen, ProductoComboImagen, Marca, PrecioUsuario } = require('../models');
const Pricing = require('./pricing.service');
const Stock = require('./stockPorTienda.service');
const Imagen = require('./imagen.service');

// No sections, HTML, offers, FAQs or checkout variants in a catalogue export.
const CAMPOS = ['id', 'meta_content_id', 'slug', 'nombre', 'descripcion_corta', 'descripcion_larga',
  'precio_base', 'precio_minimo', 'descuento_porcentaje', 'descuento_inicio', 'descuento_fin', 'cantidad_disponible', 'creado_por'];
function imagenPublica(imagenes, override) {
  const generales = imagenes.filter(i => !i.variante_id);
  const base = generales.length ? generales : imagenes;
  const porId = new Map(base.map(i => [String(i.id), i]));
  const porUrl = new Map(base.map(i => [i.url, i]));
  const personalizados = Array.isArray(override?.medios) ? override.medios.map(m => {
    if (typeof m === 'string') return m;
    if (!m || m.tipo === 'video') return null;
    return porId.get(String(m.imagen_id ?? m.id))?.url || porUrl.get(m.url)?.url || m.url || null;
  }).filter(Boolean) : [];
  return personalizados[0] || base[0]?.url || null;
}
async function leerLote(tienda, fuente, items, visibles) {
  const ids = items.filter(i => i.tipo === 'producto').map(i => i.referencia_id);
  const comboIds = items.filter(i => i.tipo === 'combo').map(i => i.referencia_id);
  const [productos, combos, precios] = await Promise.all([
    ids.length ? Producto.findAll({ where: { [Op.and]: [{ id: { [Op.in]: ids }, inquilino_id: tienda.inquilino_id, activo: true, estado_venta: 'en_venta' }, visibles] },
      attributes: CAMPOS, include: [{ model: Marca, attributes: ['nombre'] }] }) : [],
    comboIds.length ? ProductoCombo.findAll({ where: { id: { [Op.in]: comboIds }, inquilino_id: tienda.inquilino_id, estado: 'ACTIVO' },
      attributes: ['id', 'nombre', 'descripcion', 'precio_total', 'precio_minimo', 'producto_id'],
      include: [{ model: Producto, as: 'producto_padre', attributes: CAMPOS,
        where: { [Op.and]: [{ activo: true, inquilino_id: tienda.inquilino_id }, visibles] }, required: true,
        include: [{ model: Marca, attributes: ['nombre'] }] }] }) : [],
    PrecioUsuario.findAll({ where: { usuario_id: tienda.usuario_id, inquilino_id: tienda.inquilino_id,
      [Op.or]: [ids.length ? { tipo: 'producto', referencia_id: { [Op.in]: ids } } : null,
        comboIds.length ? { tipo: 'combo', referencia_id: { [Op.in]: comboIds } } : null].filter(Boolean) },
      attributes: ['tipo', 'referencia_id', 'precio'], raw: true }),
  ]);
  const padres = combos.map(c => c.producto_padre);
  const idsImagen = [...new Set([...ids, ...padres.map(p => p.id)])];
  const [imagenes, imagenesCombo] = await Promise.all([
    idsImagen.length ? ProductoImagen.findAll({ where: { producto_id: { [Op.in]: idsImagen } },
      attributes: ['id', 'producto_id', 'variante_id', 'url', 'storage_key'], order: [['es_principal', 'DESC'], ['orden', 'ASC'], ['id', 'ASC']], raw: true }) : [],
    comboIds.length ? ProductoComboImagen.findAll({ where: { combo_id: { [Op.in]: comboIds } },
      attributes: ['id', 'combo_id', 'url', 'storage_key'], order: [['es_principal', 'DESC'], ['orden', 'ASC'], ['id', 'ASC']], raw: true }) : [],
    Stock.ajustarStockALaTienda(tienda, { productos: [...productos, ...padres] }),
  ]);
  const porProducto = new Map(), porCombo = new Map();
  for (const i of imagenes) { const grupo = porProducto.get(i.producto_id) || []; grupo.push(Imagen.serializar(i)); porProducto.set(i.producto_id, grupo); }
  for (const i of imagenesCombo) { const grupo = porCombo.get(i.combo_id) || []; grupo.push(Imagen.serializar(i)); porCombo.set(i.combo_id, grupo); }
  const mapaPrecios = new Map(precios.map(p => [`${p.tipo}:${p.referencia_id}`, Number(p.precio)]));
  return [...productos.map(p => ({ tipo: 'producto', entidad: p, padre: p })), ...combos.map(c => ({ tipo: 'combo', entidad: c, padre: c.producto_padre }))]
    .map(({ tipo, entidad, padre }) => {
      const esCombo = tipo === 'combo';
      const base = Number(esCombo ? entidad.precio_total : entidad.precio_base);
      const personalizado = mapaPrecios.get(`${tipo}:${entidad.id}`);
      const conDescuento = esCombo ? base : Pricing.precioConDescuentoVigente(base, personalizado, entidad.descuento_porcentaje, entidad.descuento_inicio, entidad.descuento_fin);
      const { efectivo } = Pricing.calcularPrecioBase(conDescuento, entidad.precio_minimo == null ? null : Number(entidad.precio_minimo), null);
      const override = (esCombo ? fuente.combos : fuente.productos)?.[String(entidad.id)];
      const galeriaCombo = porCombo.get(entidad.id);
      const galeria = esCombo && galeriaCombo?.length ? galeriaCombo : porProducto.get(padre.id) || [];
      return { content_id: esCombo ? `combo-${entidad.id}` : entidad.meta_content_id || entidad.slug || `producto-${entidad.id}`,
        nombre: entidad.nombre, descripcion: esCombo ? entidad.descripcion : override?.descripcion || entidad.descripcion_corta,
        descripcion_larga: esCombo ? null : override?.descripcion || entidad.descripcion_larga,
        precio: efectivo, stock: padre.cantidad_disponible ?? null,
        imagen: imagenPublica(galeria, override), marca: padre.Marca?.nombre || null };
    });
}
module.exports = { leerLote, imagenPublica };
