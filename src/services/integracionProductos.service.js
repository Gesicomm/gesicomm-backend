'use strict';

const crypto = require('crypto');
const slugify = require('slugify');
const { sequelize, Tienda, Categoria, Marca, ProductoImagen, IntegracionCredencial, IntegracionProducto, IntegracionEvento } = require('../models');
const ProductoService = require('./producto.service');

const MAX_LOTE = 200;

function fail(message, status = 400, codigo = 'ERROR') {
  throw Object.assign(new Error(message), { status, codigo });
}

function limpiar(valor) {
  return typeof valor === 'string' ? valor.trim() : valor;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}

// ---------------------------------------------------------------
// Credenciales (lado admin, panel de Gesicomm con sesión).
// ---------------------------------------------------------------

function generarApiKey() {
  const plano = `gsk_${crypto.randomBytes(32).toString('base64url')}`;
  return { plano, hash: crypto.createHash('sha256').update(plano).digest('hex'), prefix: plano.slice(0, 12) };
}

function serializarCredencial(c) {
  return {
    id: c.id, nombre: c.nombre, codigo: c.codigo, api_key_prefix: c.api_key_prefix,
    activo: c.activo, ultima_actividad_at: c.ultima_actividad_at, created_at: c.created_at,
  };
}

async function generarCodigoUnico(base) {
  const raiz = base || 'integracion';
  let codigo = raiz;
  let contador = 1;
  while (await IntegracionCredencial.findOne({ where: { codigo } })) codigo = `${raiz}-${++contador}`;
  return codigo;
}

async function crearCredencial({ tiendaId, usuarioId, nombre }) {
  const tienda = await Tienda.findOne({ where: { id: tiendaId, usuario_id: usuarioId } });
  if (!tienda) fail('Tienda no encontrada.', 404, 'TIENDA_NO_ENCONTRADA');

  const nombreLimpio = limpiar(nombre);
  if (!nombreLimpio) fail('El nombre es obligatorio.', 400, 'NOMBRE_REQUERIDO');

  const codigo = await generarCodigoUnico(slugify(nombreLimpio, { lower: true, strict: true }));
  const { plano, hash, prefix } = generarApiKey();

  const credencial = await IntegracionCredencial.create({
    inquilino_id: tienda.inquilino_id,
    tienda_id: tienda.id,
    usuario_id: tienda.usuario_id,
    nombre: nombreLimpio,
    codigo,
    api_key_hash: hash,
    api_key_prefix: prefix,
    creado_por: usuarioId,
  });

  // La key en texto plano solo existe en este punto: no se puede recuperar
  // después, ni siquiera por un admin (solo guardamos el hash).
  return { ...serializarCredencial(credencial), api_key: plano };
}

async function listarCredenciales(tiendaId, usuarioId) {
  const tienda = await Tienda.findOne({ where: { id: tiendaId, usuario_id: usuarioId } });
  if (!tienda) fail('Tienda no encontrada.', 404, 'TIENDA_NO_ENCONTRADA');
  const credenciales = await IntegracionCredencial.findAll({ where: { tienda_id: tiendaId }, order: [['created_at', 'DESC']] });
  return credenciales.map(serializarCredencial);
}

async function revocarCredencial(tiendaId, usuarioId, id) {
  const tienda = await Tienda.findOne({ where: { id: tiendaId, usuario_id: usuarioId } });
  if (!tienda) fail('Tienda no encontrada.', 404, 'TIENDA_NO_ENCONTRADA');
  const credencial = await IntegracionCredencial.findOne({ where: { id, tienda_id: tiendaId } });
  if (!credencial) fail('Credencial no encontrada.', 404, 'CREDENCIAL_NO_ENCONTRADA');
  await credencial.update({ activo: false });
  return serializarCredencial(credencial);
}

// ---------------------------------------------------------------
// Categoría / marca por nombre libre (buscar o crear). Mismo criterio que
// productoImportacionShopify.service.js#obtenerOCrearCategoria.
// ---------------------------------------------------------------

async function obtenerOCrear(Modelo, nombre, inquilinoId, transaction) {
  const limpio = limpiar(nombre);
  if (!limpio) return null;
  const base = slugify(limpio, { lower: true, strict: true }) || 'item';
  let slug = base;
  let contador = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existente = await Modelo.findOne({ where: { inquilino_id: inquilinoId, slug }, transaction });
    if (existente) return existente.id;
    try {
      const creado = await Modelo.create({ inquilino_id: inquilinoId, nombre: limpio, slug, activo: true }, { transaction });
      return creado.id;
    } catch (err) {
      if (!err.name?.includes('Unique')) throw err;
      slug = `${base}-${++contador}`;
    }
  }
}

// ---------------------------------------------------------------
// Payload de producto que manda el socio externo -> forma interna.
// ---------------------------------------------------------------

function validarPayloadProducto(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) fail('El body debe ser un objeto JSON.', 400, 'PAYLOAD_INVALIDO');
  const sku = limpiar(datos.sku);
  const nombre = limpiar(datos.nombre);
  const precio = Number(datos.precio);
  if (!sku || sku.length > 100) fail('El campo "sku" es obligatorio (máx. 100 caracteres).', 400, 'SKU_INVALIDO');
  if (!nombre) fail('El campo "nombre" es obligatorio.', 400, 'NOMBRE_INVALIDO');
  if (!Number.isFinite(precio) || precio < 0) fail('El campo "precio" es obligatorio y debe ser un número >= 0 (guaraníes, sin decimales).', 400, 'PRECIO_INVALIDO');
  if (datos.moneda && datos.moneda !== 'PYG') fail('Por ahora solo se acepta moneda "PYG".', 400, 'MONEDA_NO_SOPORTADA');

  let stock_salon;
  let stock_deposito;
  if (datos.stock_salon !== undefined || datos.stock_deposito !== undefined) {
    stock_salon = Math.max(0, parseInt(datos.stock_salon, 10) || 0);
    stock_deposito = Math.max(0, parseInt(datos.stock_deposito, 10) || 0);
  } else if (datos.stock !== undefined) {
    if (!Number.isFinite(Number(datos.stock)) || Number(datos.stock) < 0) fail('El campo "stock" debe ser un número >= 0.', 400, 'STOCK_INVALIDO');
    stock_salon = Math.max(0, parseInt(datos.stock, 10) || 0);
    stock_deposito = 0;
  } else {
    fail('Mandá "stock" (o el desglose "stock_salon"/"stock_deposito").', 400, 'STOCK_REQUERIDO');
  }

  const imagenes = Array.isArray(datos.imagenes)
    ? datos.imagenes.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url.trim())).slice(0, 20)
    : [];
  const tags = Array.isArray(datos.tags)
    ? datos.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean).slice(0, 30)
    : [];

  return {
    sku, nombre,
    descripcion_corta: datos.descripcion_corta ? String(datos.descripcion_corta).slice(0, 500) : null,
    descripcion_larga: datos.descripcion ? String(datos.descripcion) : null,
    categoria: limpiar(datos.categoria) || null,
    marca: limpiar(datos.marca) || null,
    precio_base: precio,
    precio_tachado: datos.precio_comparacion != null ? Number(datos.precio_comparacion) : null,
    stock_salon, stock_deposito,
    peso: datos.peso_kg != null ? Number(datos.peso_kg) : null,
    activo: datos.activo !== false,
    imagenes, tags,
  };
}

async function reemplazarImagenes(productoId, inquilinoId, urls, transaction) {
  // Reemplazo total: el socio manda la lista completa y vigente de imágenes
  // en cada upsert, no hay endpoint para agregar/quitar una sola.
  await ProductoImagen.destroy({ where: { producto_id: productoId }, transaction });
  await ProductoImagen.bulkCreate(urls.map((url, index) => ({
    inquilino_id: inquilinoId,
    producto_id: productoId,
    url,
    original_url: url,
    storage_key: null,
    original_storage_key: null,
    es_principal: index === 0,
    orden: index,
    visual_modo: 'contain',
  })), { transaction });
}

// SKU único por inquilino (producto.service.js#validarSku): si el SKU
// externo ya lo usa OTRO producto de otra tienda/integración, no se puede
// escribir tal cual. Se prefija con el código de esta integración para no
// pisar ni fallar en silencio.
async function resolverSkuSinChoque(skuExterno, inquilinoId, codigoIntegracion, transaction) {
  try {
    return await ProductoService.validarSku(skuExterno, inquilinoId, null, transaction);
  } catch {
    return ProductoService.validarSku(`${codigoIntegracion}-${skuExterno}`.slice(0, 100), inquilinoId, null, transaction);
  }
}

async function aplicarUpsert(integracion, payload, transaction) {
  const datos = validarPayloadProducto(payload);
  const mapeo = await IntegracionProducto.findOne({ where: { integracion_id: integracion.id, sku_externo: datos.sku }, transaction });
  const estado_venta = datos.activo ? (datos.stock_salon + datos.stock_deposito > 0 ? 'en_venta' : 'fuera_de_stock') : 'no_disponible';

  if (mapeo) {
    // A diferencia de la creación, en una actualización un campo OPCIONAL
    // que el socio no mandó en este request no se toca (no se borra lo
    // que ya estaba cargado). Si lo manda explícito (aunque sea null/""),
    // sí se aplica. Sin esto, un upsert de "solo cambió el precio" borraría
    // la categoría/marca/imágenes que se habían cargado antes.
    const campos = {
      nombre: datos.nombre,
      precio_base: datos.precio_base,
      stock_salon: datos.stock_salon,
      stock_deposito: datos.stock_deposito,
      activo: datos.activo,
      estado_venta,
    };
    if (payload.categoria !== undefined) campos.categoria_id = await obtenerOCrear(Categoria, datos.categoria, integracion.inquilinoId, transaction);
    if (payload.marca !== undefined) campos.marca_id = await obtenerOCrear(Marca, datos.marca, integracion.inquilinoId, transaction);
    if (payload.descripcion_corta !== undefined) campos.descripcion_corta = datos.descripcion_corta;
    if (payload.descripcion !== undefined) campos.descripcion_larga = datos.descripcion_larga;
    if (payload.precio_comparacion !== undefined) campos.precio_tachado = datos.precio_tachado;
    if (payload.peso_kg !== undefined) campos.peso = datos.peso;
    if (payload.tags !== undefined) campos.tags = datos.tags;

    const producto = await ProductoService.actualizar(mapeo.producto_id, campos, integracion.inquilinoId, integracion.usuarioId, false, transaction, integracion.tiendaId);
    // undefined = no tocar; [] explícito = borrar todas; array con URLs = reemplazar.
    if (payload.imagenes !== undefined) await reemplazarImagenes(mapeo.producto_id, integracion.inquilinoId, datos.imagenes, transaction);
    return { accion: 'actualizado', producto_id: mapeo.producto_id, sku: datos.sku, slug: producto.slug, activo: producto.activo };
  }

  // Creación: no hay nada previo que proteger, se usa lo que vino (o null).
  const categoria_id = await obtenerOCrear(Categoria, datos.categoria, integracion.inquilinoId, transaction);
  const marca_id = await obtenerOCrear(Marca, datos.marca, integracion.inquilinoId, transaction);
  const sku = await resolverSkuSinChoque(datos.sku, integracion.inquilinoId, integracion.codigo, transaction);
  const producto = await ProductoService.crear({
    nombre: datos.nombre, sku, categoria_id, marca_id, tags: datos.tags,
    descripcion_corta: datos.descripcion_corta, descripcion_larga: datos.descripcion_larga,
    precio_base: datos.precio_base, precio_tachado: datos.precio_tachado,
    stock_salon: datos.stock_salon, stock_deposito: datos.stock_deposito,
    peso: datos.peso, activo: datos.activo, estado_venta,
  }, integracion.inquilinoId, integracion.usuarioId, false, transaction, integracion.tiendaId);

  await IntegracionProducto.create({ integracion_id: integracion.id, producto_id: producto.id, sku_externo: datos.sku }, { transaction });
  if (datos.imagenes.length > 0) await reemplazarImagenes(producto.id, integracion.inquilinoId, datos.imagenes, transaction);

  return { accion: 'creado', producto_id: producto.id, sku: datos.sku, slug: producto.slug, activo: producto.activo };
}

async function resolverMapeo(integracion, skuExterno, transaction) {
  const mapeo = await IntegracionProducto.findOne({ where: { integracion_id: integracion.id, sku_externo: skuExterno }, transaction });
  if (!mapeo) fail(`No existe ningún producto sincronizado con sku "${skuExterno}" para esta integración. Primero hacé un upsert (POST /productos).`, 404, 'PRODUCTO_NO_ENCONTRADO');
  return mapeo;
}

async function aplicarStock(integracion, skuExterno, body, transaction) {
  const mapeo = await resolverMapeo(integracion, skuExterno, transaction);
  const campos = {};
  if (body.stock_salon !== undefined || body.stock_deposito !== undefined) {
    campos.stock_salon = Math.max(0, parseInt(body.stock_salon, 10) || 0);
    campos.stock_deposito = Math.max(0, parseInt(body.stock_deposito, 10) || 0);
  } else if (body.stock !== undefined) {
    if (!Number.isFinite(Number(body.stock)) || Number(body.stock) < 0) fail('El campo "stock" debe ser un número >= 0.', 400, 'STOCK_INVALIDO');
    campos.stock_salon = Math.max(0, parseInt(body.stock, 10) || 0);
    campos.stock_deposito = 0;
  } else {
    fail('Mandá "stock" (o el desglose "stock_salon"/"stock_deposito").', 400, 'STOCK_REQUERIDO');
  }
  campos.estado_venta = (campos.stock_salon + campos.stock_deposito) > 0 ? 'en_venta' : 'fuera_de_stock';

  const producto = await ProductoService.actualizar(mapeo.producto_id, campos, integracion.inquilinoId, integracion.usuarioId, false, transaction, integracion.tiendaId);
  return { producto_id: mapeo.producto_id, sku: skuExterno, stock_salon: producto.stock_salon, stock_deposito: producto.stock_deposito, cantidad_disponible: producto.cantidad_disponible };
}

async function aplicarPrecio(integracion, skuExterno, body, transaction) {
  const mapeo = await resolverMapeo(integracion, skuExterno, transaction);
  const precio = Number(body.precio);
  if (!Number.isFinite(precio) || precio < 0) fail('El campo "precio" es obligatorio y debe ser un número >= 0.', 400, 'PRECIO_INVALIDO');
  const campos = { precio_base: precio };
  if (body.precio_comparacion != null) campos.precio_tachado = Number(body.precio_comparacion);

  const producto = await ProductoService.actualizar(mapeo.producto_id, campos, integracion.inquilinoId, integracion.usuarioId, false, transaction, integracion.tiendaId);
  return { producto_id: mapeo.producto_id, sku: skuExterno, precio: producto.precio_base, precio_comparacion: producto.precio_tachado };
}

async function aplicarBaja(integracion, skuExterno, transaction) {
  const mapeo = await resolverMapeo(integracion, skuExterno, transaction);
  const producto = await ProductoService.actualizar(mapeo.producto_id, { activo: false, estado_venta: 'no_disponible' }, integracion.inquilinoId, integracion.usuarioId, false, transaction, integracion.tiendaId);
  return { producto_id: mapeo.producto_id, sku: skuExterno, activo: producto.activo };
}

async function consultarProducto(integracion, skuExterno) {
  const mapeo = await IntegracionProducto.findOne({ where: { integracion_id: integracion.id, sku_externo: skuExterno } });
  if (!mapeo) fail(`No existe ningún producto sincronizado con sku "${skuExterno}" para esta integración.`, 404, 'PRODUCTO_NO_ENCONTRADO');
  const producto = await ProductoService.detalle(mapeo.producto_id, integracion.inquilinoId, false, integracion.usuarioId, integracion.tiendaId);
  return {
    sku: skuExterno, producto_id: mapeo.producto_id, nombre: producto.nombre, slug: producto.slug,
    precio: producto.precio_base, precio_comparacion: producto.precio_tachado,
    stock_salon: producto.stock_salon, stock_deposito: producto.stock_deposito,
    activo: producto.activo, sincronizado_en: mapeo.updated_at,
  };
}

// ---------------------------------------------------------------
// Idempotencia: cada mutación se registra con una event_key única por
// integración ANTES de darse por confirmada. Un reintento de red del
// socio (mismo event_id) nunca vuelve a aplicar el efecto: devuelve el
// resultado ya guardado con `duplicado: true`. Si no viene event_id, la
// key es un hash del payload (igual criterio que el ingest de Speedbox).
// ---------------------------------------------------------------

async function ingest(integracion, tipo, eventId, logPayload, aplicar) {
  if (eventId != null && (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 150)) {
    fail('"event_id" inválido: debe ser texto, no vacío, máx. 150 caracteres.', 400, 'EVENT_ID_INVALIDO');
  }
  const eventKey = eventId ? `id:${eventId.trim()}` : `hash:${crypto.createHash('sha256').update(JSON.stringify(canonical(logPayload))).digest('hex')}`;

  try {
    return await sequelize.transaction(async (transaction) => {
      const resultado = await aplicar(transaction);
      await IntegracionEvento.create({
        integracion_id: integracion.id, event_key: eventKey, tipo,
        sku_externo: logPayload?.sku || null,
        producto_id: resultado?.producto_id || null,
        estado: 'procesado',
        payload: { request: logPayload, resultado },
      }, { transaction });
      return { ...resultado, duplicado: false };
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      const previo = await IntegracionEvento.findOne({ where: { integracion_id: integracion.id, event_key: eventKey } });
      if (previo) return { ...(previo.payload?.resultado || {}), duplicado: true };
      fail('Conflicto de concurrencia (dos requests simultáneos para lo mismo). Reintentá la misma operación.', 409, 'CONFLICTO_CONCURRENCIA');
    }
    throw error;
  }
}

async function upsertProducto(integracion, payload) {
  return ingest(integracion, 'producto.upsert', payload?.event_id, payload, transaction => aplicarUpsert(integracion, payload, transaction));
}

async function actualizarStock(integracion, skuExterno, body) {
  return ingest(integracion, 'producto.stock', body?.event_id, { sku: skuExterno, ...body }, transaction => aplicarStock(integracion, skuExterno, body, transaction));
}

async function actualizarPrecio(integracion, skuExterno, body) {
  return ingest(integracion, 'producto.precio', body?.event_id, { sku: skuExterno, ...body }, transaction => aplicarPrecio(integracion, skuExterno, body, transaction));
}

async function darDeBaja(integracion, skuExterno, body = {}) {
  return ingest(integracion, 'producto.baja', body?.event_id, { sku: skuExterno }, transaction => aplicarBaja(integracion, skuExterno, transaction));
}

// El lote de carga inicial no usa event_id: cada item es un upsert por su
// propio sku, que ya es idempotente de por sí (reenviar el mismo lote dos
// veces deja el catálogo en el mismo estado). Cada item va en su propia
// transacción para que un item con error no tumbe a los demás.
async function sincronizarLote(integracion, productos) {
  if (!Array.isArray(productos) || productos.length === 0) fail('"productos" debe ser un array con al menos un elemento.', 400, 'PAYLOAD_INVALIDO');
  if (productos.length > MAX_LOTE) fail(`Máximo ${MAX_LOTE} productos por lote.`, 400, 'LOTE_DEMASIADO_GRANDE');

  const resultados = [];
  const errores = [];
  for (const item of productos) {
    try {
      resultados.push(await sequelize.transaction(transaction => aplicarUpsert(integracion, item, transaction)));
    } catch (error) {
      errores.push({ sku: item?.sku ?? null, error: error.message, codigo: error.codigo || 'ERROR' });
    }
  }

  return {
    procesados: resultados.length,
    creados: resultados.filter(r => r.accion === 'creado').length,
    actualizados: resultados.filter(r => r.accion === 'actualizado').length,
    errores_total: errores.length,
    errores: errores.slice(0, 50),
  };
}

module.exports = {
  MAX_LOTE,
  crearCredencial,
  listarCredenciales,
  revocarCredencial,
  upsertProducto,
  actualizarStock,
  actualizarPrecio,
  darDeBaja,
  consultarProducto,
  sincronizarLote,
};
