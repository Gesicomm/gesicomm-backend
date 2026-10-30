'use strict';

const crypto = require('crypto');
const slugify = require('slugify');
const { Op } = require('sequelize');
const { sequelize, Tienda, Categoria, Marca, Producto, ProductoImagen, Proveedor, IntegracionCredencial, IntegracionProducto, IntegracionEvento } = require('../models');
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
    tipo: c.proveedor_id ? 'proveedor' : 'tienda',
    proveedor_id: c.proveedor_id || null,
    logo_url: c.proveedor?.logo_url || null,
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

/**
 * API Key de un PROVEEDOR externo (la que se le pasa a un proveedor para
 * que conecte su sistema). La crea un administrador de Gesicomm, no un
 * comercio: lo que entre con ella va al catálogo global y lo ve todo
 * comercio en Mi catálogo. El Proveedor se busca por nombre o se crea, y
 * su `logo_url` es el logo chico que después muestra la tarjeta del
 * producto para reconocer de dónde viene.
 */
async function crearCredencialProveedor({ inquilinoId, usuarioId, nombre, logo_url }) {
  const nombreLimpio = limpiar(nombre);
  if (!nombreLimpio) fail('El nombre del proveedor es obligatorio.', 400, 'NOMBRE_REQUERIDO');
  const logo = limpiar(logo_url) || null;
  if (logo && !/^https?:\/\//i.test(logo)) fail('El logo tiene que ser una URL http(s) pública.', 400, 'LOGO_INVALIDO');

  const [proveedor] = await Proveedor.findOrCreate({
    where: { usuario_id: usuarioId, nombre: nombreLimpio },
    defaults: { usuario_id: usuarioId, nombre: nombreLimpio, activo: true, logo_url: logo },
  });
  // Un proveedor que ya existía (cargado antes desde Costos y Gastos, o
  // una key anterior) se queda con su logo salvo que manden uno nuevo.
  if (logo && proveedor.logo_url !== logo) await proveedor.update({ logo_url: logo });

  const codigo = await generarCodigoUnico(slugify(nombreLimpio, { lower: true, strict: true }));
  const { plano, hash, prefix } = generarApiKey();

  const credencial = await IntegracionCredencial.create({
    inquilino_id: inquilinoId,
    proveedor_id: proveedor.id,
    tienda_id: null,
    usuario_id: null,
    nombre: nombreLimpio,
    codigo,
    api_key_hash: hash,
    api_key_prefix: prefix,
    creado_por: usuarioId,
  });

  credencial.proveedor = proveedor;
  return { ...serializarCredencial(credencial), api_key: plano };
}

async function listarCredencialesProveedor(inquilinoId) {
  const credenciales = await IntegracionCredencial.findAll({
    where: { inquilino_id: inquilinoId, proveedor_id: { [Op.ne]: null } },
    include: [{ model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre', 'logo_url'] }],
    order: [['created_at', 'DESC']],
  });
  return credenciales.map(serializarCredencial);
}

async function revocarCredencialProveedor(inquilinoId, id) {
  const credencial = await IntegracionCredencial.findOne({
    where: { id, inquilino_id: inquilinoId, proveedor_id: { [Op.ne]: null } },
    include: [{ model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre', 'logo_url'] }],
  });
  if (!credencial) fail('Credencial no encontrada.', 404, 'CREDENCIAL_NO_ENCONTRADA');
  await credencial.update({ activo: false });
  return serializarCredencial(credencial);
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
    dimensiones: datos.dimensiones != null ? limpiar(datos.dimensiones).slice(0, 100) || null : null,
    destacado: datos.destacado === true,
    activo: datos.activo !== false,
    imagenes, tags,
    ficha: construirFicha(datos.ficha),
  };
}

// ---------------------------------------------------------------
// La ficha de producto del LIENZO EN BLANCO (landing kind='codigo', la
// única que se usa hoy). El runtime la resuelve en un solo lugar,
// `presentacionComercial` en gesicomm-frontend/src/pages/landing-simple/
// datosRuntime.js: cada bloque de la ficha sale de un campo del producto y
// la landing solo pisa lo que el comercio editó a mano. Lo que entra por
// acá es ese nivel de abajo — el del producto —, así que vale en todas las
// landings donde se venda, sin volver a cargarlo.
//
// El mapeo es el MISMO que usa la importación del JSON de la IA en el panel
// (ProductForm.jsx, "Instrucciones para tu IA"): si cambia uno, cambia el
// otro, o el mismo producto se ve distinto según cómo entró.
//
// Nada de esto se rellena con textos de ejemplo: lo que el socio no manda
// queda vacío y el bloque se oculta solo en la ficha.
// ---------------------------------------------------------------

const MAX_BENEFICIOS = 8;
const MAX_CONFIANZA = 8;
const MAX_PREGUNTAS = 20;
const MAX_OPINIONES = 9;
const MAX_INCLUYE = 8;

// Textos de bloque de la ficha -> ficha_datos.presentacion. Los nombres de
// campo y los topes son los de presentacion_productos (la landing) para que
// un texto cargado por API y uno editado en el panel sean intercambiables.
const TEXTOS_FICHA = {
  insignia_principal: 40,
  insignia_secundaria: 40,
  titulo_comercial: 100,
  cta_texto: 60,
  agregar_carrito_texto: 40,
  beneficios_kicker: 60,
  beneficios_titulo: 90,
  beneficios_subtitulo: 180,
  urgencia_kicker: 60,
  urgencia_titulo: 90,
  urgencia_texto: 180,
  opiniones_kicker: 60,
  opiniones_titulo: 90,
  opiniones_subtitulo: 180,
  preguntas_kicker: 60,
  preguntas_titulo: 90,
  preguntas_subtitulo: 180,
};

/** Texto de una sola línea (rótulos, títulos): sin saltos ni espacios dobles. */
function linea(valor, max) {
  const texto = valor == null ? '' : String(valor).replace(/\s+/g, ' ').trim();
  return max ? texto.slice(0, max) : texto;
}

/** Texto largo (descripción, respuesta de FAQ): se conservan los saltos de línea. */
function parrafo(valor) {
  return valor == null ? '' : String(valor).trim();
}

function lista(valor, codigo, nombreCampo) {
  if (valor == null) return [];
  if (!Array.isArray(valor)) fail(`"ficha.${nombreCampo}" debe ser un array.`, 400, codigo);
  return valor;
}

// Mismos alias (español/inglés) que acepta el runtime en normalizarBeneficio
// y compañía: el socio puede mandar el nombre que ya usa su sistema.
function normalizarBeneficio(b) {
  if (typeof b === 'string') return { titulo: linea(b, 80), texto: '', icono: null };
  return {
    titulo: linea(b?.titulo || b?.title || b?.texto || b?.text, 80),
    texto: linea(b?.texto || b?.text || b?.descripcion || b?.description, 180),
    icono: linea(b?.icono || b?.icon, 40) || null,
  };
}

function normalizarConfianza(c) {
  if (typeof c === 'string') return { icono: '', titulo: linea(c, 80), texto: '' };
  const titulo = linea(c?.titulo || c?.title || c?.texto || c?.text, 80);
  const texto = linea(c?.texto || c?.text || c?.subtitulo || c?.subtitle || c?.descripcion || c?.description, 180);
  return { icono: linea(c?.icono || c?.icon, 40), titulo, texto: texto && texto !== titulo ? texto : '' };
}

function normalizarPregunta(f) {
  return {
    pregunta: linea(f?.pregunta || f?.question || f?.titulo || f?.title, 300),
    respuesta: parrafo(f?.respuesta || f?.answer || f?.texto || f?.text),
  };
}

// Opiniones REALES del producto: son las que la ficha usa para las estrellas
// y el "4,8 de 5 · 32 opiniones" debajo del título. Sin comentario no es una
// opinión (así entraban renglones vacíos como "Cliente verificado").
function normalizarOpinion(o) {
  const calificacion = Number(o?.calificacion ?? o?.rating ?? o?.stars);
  return {
    nombre: linea(o?.nombre || o?.name || o?.author, 80) || 'Cliente verificado',
    comentario: parrafo(o?.comentario || o?.comment || o?.text || o?.review).slice(0, 600),
    detalle: linea(o?.detalle || o?.source || o?.subtitle, 80),
    calificacion: Number.isFinite(calificacion) ? Math.min(5, Math.max(1, calificacion)) : 5,
    foto: typeof o?.foto === 'string' && /^https?:\/\//i.test(o.foto.trim()) ? o.foto.trim() : '',
  };
}

/**
 * `payload.ficha` -> los tres destinos que tiene la ficha en el producto:
 *   - `producto`: columnas propias (propuesta_valor, beneficios, confianza…).
 *   - `fichaDatos`: claves de `productos.ficha_datos` (insignia, opiniones).
 *   - `presentacion`: textos de bloque, dentro de `ficha_datos.presentacion`.
 *   - `faq`: filas de `producto_faqs` (de donde la ficha pública lee las
 *     preguntas), o `undefined` si el socio no mandó el campo.
 *
 * Devuelve `null` cuando el request no trae `ficha`: la regla de upsert
 * parcial vale acá también, clave por clave (no mandar un campo no borra lo
 * que ya estaba cargado; mandarlo vacío sí lo borra).
 */
function construirFicha(ficha) {
  if (ficha === undefined) return null;
  if (ficha === null) return { producto: {}, fichaDatos: {}, presentacion: {}, faq: undefined };
  if (typeof ficha !== 'object' || Array.isArray(ficha)) fail('"ficha" debe ser un objeto JSON.', 400, 'FICHA_INVALIDA');

  const producto = {};
  const fichaDatos = {};
  const presentacion = {};
  let faq;

  // Frase destacada arriba del título y descripción larga: son los dos
  // textos que más pesan en la ficha (van debajo del nombre, antes del
  // precio). La descripción larga entra por `descripcion`, afuera de
  // `ficha`, porque ya existía en el contrato.
  if (ficha.propuesta_valor !== undefined) producto.propuesta_valor = linea(ficha.propuesta_valor, 300) || null;
  if (ficha.sobre_el_producto !== undefined) producto.sobre_este_producto = parrafo(ficha.sobre_el_producto) || null;

  if (ficha.beneficios !== undefined) {
    producto.beneficios = lista(ficha.beneficios, 'FICHA_BENEFICIOS_INVALIDOS', 'beneficios')
      .map(normalizarBeneficio).filter(b => b.titulo || b.texto).slice(0, MAX_BENEFICIOS);
  }
  if (ficha.confianza !== undefined) {
    producto.confianza = lista(ficha.confianza, 'FICHA_CONFIANZA_INVALIDA', 'confianza')
      .map(normalizarConfianza).filter(c => c.titulo || c.texto).slice(0, MAX_CONFIANZA);
  }
  if (ficha.preguntas !== undefined) {
    faq = lista(ficha.preguntas, 'FICHA_PREGUNTAS_INVALIDAS', 'preguntas')
      .map(normalizarPregunta).filter(f => f.pregunta && f.respuesta).slice(0, MAX_PREGUNTAS);
    // Las mismas preguntas quedan en la columna del producto además de en
    // `producto_faqs`: la ficha pública lee la tabla, pero varias pantallas
    // del panel y el DTO de combos leen la columna.
    producto.preguntas_frecuentes = faq;
  }
  if (ficha.preguntas_titulo !== undefined) producto.faq_titulo = linea(ficha.preguntas_titulo, 255) || null;

  // Etiqueta corta sobre la foto en el catálogo ("OFERTA", "MÁS VENDIDO").
  // NO es la descripción corta: va en ficha_datos.insignia, que es de donde
  // la tarjeta del catálogo saca `etiqueta`.
  if (ficha.insignia !== undefined) fichaDatos.insignia = linea(ficha.insignia, 24);
  if (ficha.opiniones !== undefined) {
    fichaDatos.product_page_opiniones = lista(ficha.opiniones, 'FICHA_OPINIONES_INVALIDAS', 'opiniones')
      .map(normalizarOpinion).filter(o => o.comentario).slice(0, MAX_OPINIONES);
  }

  if (ficha.textos !== undefined) {
    if (ficha.textos === null) {
      Object.keys(TEXTOS_FICHA).forEach(campo => { presentacion[campo] = ''; });
    } else {
      if (typeof ficha.textos !== 'object' || Array.isArray(ficha.textos)) fail('"ficha.textos" debe ser un objeto JSON.', 400, 'FICHA_TEXTOS_INVALIDOS');
      const desconocidos = Object.keys(ficha.textos).filter(campo => !(campo in TEXTOS_FICHA));
      if (desconocidos.length) {
        fail(`"ficha.textos" no reconoce: ${desconocidos.join(', ')}. Campos válidos: ${Object.keys(TEXTOS_FICHA).join(', ')}.`, 400, 'FICHA_TEXTOS_INVALIDOS');
      }
      Object.entries(ficha.textos).forEach(([campo, valor]) => { presentacion[campo] = linea(valor, TEXTOS_FICHA[campo]); });
    }
  }
  if (ficha.incluye_pedido !== undefined) {
    presentacion.incluye_pedido = lista(ficha.incluye_pedido, 'FICHA_INCLUYE_INVALIDO', 'incluye_pedido')
      .map(item => linea(typeof item === 'string' ? item : item?.texto || item?.text, 120))
      .filter(Boolean).slice(0, MAX_INCLUYE)
      .map(texto => ({ texto }));
  }

  return { producto, fichaDatos, presentacion, faq };
}

/**
 * `ficha_datos` para el update: ProductoService.actualizar combina un solo
 * nivel, así que `presentacion` hay que mezclarla a mano o el request pisa
 * los textos que ya tenía cargados el producto (mismo cuidado que el panel).
 */
function fichaDatosParaGuardar(ficha, fichaDatosActual = {}) {
  const datos = { ...ficha.fichaDatos };
  if (Object.keys(ficha.presentacion).length) {
    datos.presentacion = { ...(fichaDatosActual?.presentacion || {}), ...ficha.presentacion };
  }
  return datos;
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

/**
 * Con qué permisos escribe esta credencial (ver IntegracionCredencial.js).
 *
 * Un PROVEEDOR escribe en el catálogo global, igual que el administrador:
 * sin usuario dueño (`creado_por` queda en null, que es lo que hace que el
 * producto lo vea TODO comercio en Mi catálogo) y sin tienda. Una
 * credencial de TIENDA escribe como el dueño de esa tienda y solo alcanza
 * a sus propios productos.
 */
function escritura(integracion) {
  return integracion.proveedorId
    ? { usuarioId: null, esAdmin: true, tiendaId: null }
    : { usuarioId: integracion.usuarioId, esAdmin: false, tiendaId: integracion.tiendaId };
}

/**
 * Un producto que todavía no aprobó un administrador no se publica, mande
 * lo que mande el proveedor. `activo: false` es lo que de verdad lo
 * esconde: Mi catálogo, las landings, la tienda pública y el feed de Meta
 * ya filtran por ahí, así que no hace falta un filtro nuevo en cada
 * consulta (ver la migración 20261030210000).
 */
function aplicarModeracion(campos, estadoRevision) {
  if (!estadoRevision || estadoRevision === 'aprobado') return campos;
  campos.activo = false;
  campos.estado_venta = 'no_disponible';
  return campos;
}

async function actualizarProducto(integracion, productoId, campos, transaction) {
  const { usuarioId, esAdmin, tiendaId } = escritura(integracion);
  // Vale para cualquier cambio del proveedor — también para un PATCH de
  // stock o de precio, que son los que vuelven a tocar `estado_venta`.
  if (integracion.proveedorId) {
    const actual = await Producto.findOne({ where: { id: productoId }, attributes: ['estado_revision'], transaction });
    aplicarModeracion(campos, actual?.estado_revision);
  }
  return ProductoService.actualizar(productoId, campos, integracion.inquilinoId, usuarioId, esAdmin, transaction, tiendaId);
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
    if (payload.dimensiones !== undefined) campos.dimensiones = datos.dimensiones;
    if (payload.destacado !== undefined) campos.destacado = datos.destacado;
    if (payload.tags !== undefined) campos.tags = datos.tags;
    const actual = await Producto.findOne({ where: { id: mapeo.producto_id }, attributes: ['ficha_datos', 'estado_revision'], transaction });
    if (datos.ficha) {
      Object.assign(campos, datos.ficha.producto);
      const fichaDatos = fichaDatosParaGuardar(datos.ficha, actual?.ficha_datos);
      if (Object.keys(fichaDatos).length) campos.ficha_datos = fichaDatos;
    }
    // Mientras el administrador no lo apruebe, el proveedor puede corregir
    // lo que quiera pero el producto NO se publica: mandar `activo: true`
    // en el upsert no alcanza para saltear la revisión (lo aplica
    // actualizarProducto, para cualquier cambio que venga del proveedor).
    const producto = await actualizarProducto(integracion, mapeo.producto_id, campos, transaction);
    // undefined = no tocar; [] explícito = borrar todas; array con URLs = reemplazar.
    if (payload.imagenes !== undefined) await reemplazarImagenes(mapeo.producto_id, integracion.inquilinoId, datos.imagenes, transaction);
    if (datos.ficha?.faq !== undefined) {
      await ProductoService.sincronizarFaq(mapeo.producto_id, integracion.inquilinoId, datos.ficha.faq, transaction);
    }
    return { accion: 'actualizado', producto_id: mapeo.producto_id, sku: datos.sku, slug: producto.slug, activo: producto.activo };
  }

  // Creación: no hay nada previo que proteger, se usa lo que vino (o null).
  const { usuarioId, esAdmin, tiendaId } = escritura(integracion);
  const categoria_id = await obtenerOCrear(Categoria, datos.categoria, integracion.inquilinoId, transaction);
  const marca_id = await obtenerOCrear(Marca, datos.marca, integracion.inquilinoId, transaction);
  const sku = await resolverSkuSinChoque(datos.sku, integracion.inquilinoId, integracion.codigo, transaction);
  const producto = await ProductoService.crear({
    nombre: datos.nombre, sku, categoria_id, marca_id, tags: datos.tags,
    descripcion_corta: datos.descripcion_corta, descripcion_larga: datos.descripcion_larga,
    precio_base: datos.precio_base, precio_tachado: datos.precio_tachado,
    stock_salon: datos.stock_salon, stock_deposito: datos.stock_deposito,
    peso: datos.peso, dimensiones: datos.dimensiones, destacado: datos.destacado,
    activo: datos.activo, estado_venta,
    // Un producto de proveedor nace esperando la aprobación de un
    // administrador: nadie publica mercadería en Gesicom sin que alguien
    // la mire primero (ver Producto.estado_revision).
    ...(integracion.proveedorId ? { estado_revision: 'pendiente', activo: false, estado_venta: 'no_disponible' } : {}),
    ...(datos.ficha ? { ...datos.ficha.producto, ficha_datos: fichaDatosParaGuardar(datos.ficha) } : {}),
    // Proveedor externo: queda atado a su Proveedor, que es lo que deja
    // filtrarlo y mostrar su logo en la tarjeta de Mi catálogo.
    ...(integracion.proveedorId ? { proveedor_id: integracion.proveedorId } : {}),
  }, integracion.inquilinoId, usuarioId, esAdmin, transaction, tiendaId);

  await IntegracionProducto.create({ integracion_id: integracion.id, producto_id: producto.id, sku_externo: datos.sku }, { transaction });
  if (datos.imagenes.length > 0) await reemplazarImagenes(producto.id, integracion.inquilinoId, datos.imagenes, transaction);
  if (datos.ficha?.faq?.length) {
    await ProductoService.sincronizarFaq(producto.id, integracion.inquilinoId, datos.ficha.faq, transaction);
  }

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

  const producto = await actualizarProducto(integracion, mapeo.producto_id, campos, transaction);
  return { producto_id: mapeo.producto_id, sku: skuExterno, stock_salon: producto.stock_salon, stock_deposito: producto.stock_deposito, cantidad_disponible: producto.cantidad_disponible };
}

async function aplicarPrecio(integracion, skuExterno, body, transaction) {
  const mapeo = await resolverMapeo(integracion, skuExterno, transaction);
  const precio = Number(body.precio);
  if (!Number.isFinite(precio) || precio < 0) fail('El campo "precio" es obligatorio y debe ser un número >= 0.', 400, 'PRECIO_INVALIDO');
  const campos = { precio_base: precio };
  if (body.precio_comparacion != null) campos.precio_tachado = Number(body.precio_comparacion);

  const producto = await actualizarProducto(integracion, mapeo.producto_id, campos, transaction);
  return { producto_id: mapeo.producto_id, sku: skuExterno, precio: producto.precio_base, precio_comparacion: producto.precio_tachado };
}

async function aplicarBaja(integracion, skuExterno, transaction) {
  const mapeo = await resolverMapeo(integracion, skuExterno, transaction);
  const producto = await actualizarProducto(integracion, mapeo.producto_id, { activo: false, estado_venta: 'no_disponible' }, transaction);
  return { producto_id: mapeo.producto_id, sku: skuExterno, activo: producto.activo };
}

async function consultarProducto(integracion, skuExterno) {
  const mapeo = await IntegracionProducto.findOne({ where: { integracion_id: integracion.id, sku_externo: skuExterno } });
  if (!mapeo) fail(`No existe ningún producto sincronizado con sku "${skuExterno}" para esta integración.`, 404, 'PRODUCTO_NO_ENCONTRADO');
  const { usuarioId, esAdmin, tiendaId } = escritura(integracion);
  const producto = await ProductoService.detalle(mapeo.producto_id, integracion.inquilinoId, esAdmin, usuarioId, tiendaId);
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
  crearCredencialProveedor,
  listarCredencialesProveedor,
  revocarCredencialProveedor,
  upsertProducto,
  actualizarStock,
  actualizarPrecio,
  darDeBaja,
  consultarProducto,
  sincronizarLote,
};
