'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const { Op, where: sqlWhere } = require('sequelize');
const { sequelize, RahaDestino, RahaEnvioStock, Deposito, Tienda, Usuario,
  Producto, ProductoVariante, SolicitudAbastecimiento } = require('../../models');
const seguimiento = require('../abastecimiento/seguimientoRaha');

const ESTADOS = ['solicitada', 'observada', 'aceptada', 'preparado', 'enviado', 'recibido', 'rechazada', 'cancelada'];
const destinoSchema = z.object({ nombre: z.string().trim().min(2).max(150), ciudad: z.string().trim().min(2).max(100),
  direccion: z.string().trim().min(3).max(255), persona_contacto: z.string().trim().max(150).default(''),
  telefono_contacto: z.string().trim().max(50).default(''), activo: z.boolean().default(true) }).strict();
const envioSchema = z.object({ deposito_origen_id: z.number().int().positive(), destino_raha_id: z.number().int().positive(),
  solicitud_key: z.string().uuid(), observacion: z.string().trim().max(2000).default(''),
  items: z.array(z.object({ producto_id: z.number().int().positive(), variante_id: z.number().int().positive().nullable().default(null),
    cantidad: z.number().int().min(1).max(1000000) }).strict()).min(1).max(100) }).strict();

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) fail('Datos inválidos. Revisá los campos obligatorios y las cantidades.');
  return result.data;
}
function paginar(input = {}) {
  const page = Math.max(1, parseInt(input.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(input.limit, 10) || 20));
  if ((page - 1) * limit > 1000000) fail('Página fuera de rango.');
  return { page, limit, offset: (page - 1) * limit };
}
function respuesta(rows, count, pagina) {
  return { registros: rows, total: count, page: pagina.page, limit: pagina.limit,
    totalPaginas: Math.max(1, Math.ceil(count / pagina.limit)) };
}
function rango(where, input) {
  for (const [campo, operador, hora] of [['desde', Op.gte, '00:00:00'], ['hasta', Op.lte, '23:59:59.999']]) {
    const fecha = input[campo];
    if (!fecha) continue;
    if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha) fail('Fecha inválida.');
    where.created_at ||= {};
    where.created_at[operador] = new Date(`${fecha}T${hora}-03:00`);
  }
  if (input.desde && input.hasta && input.desde > input.hasta) fail('El rango de fechas está invertido.');
}
function consultaTexto(valor) { return String(valor || '').trim().slice(0, 100).replace(/[\\%_]/g, caracter => `\\${caracter}`); }
function idTexto(texto) { return /^#?\d{1,9}$/.test(texto) ? Number(texto.replace('#', '')) : null; }
async function tiendaActor(actor) {
  if (!Number.isSafeInteger(actor?.id) || !Number.isSafeInteger(actor?.tiendaId)) fail('Seleccioná una tienda activa.', 409);
  const tienda = await Tienda.findOne({ where: { id: actor.tiendaId, usuario_id: actor.id }, attributes: ['id', 'nombre', 'inquilino_id'] });
  if (!tienda) fail('Tienda no encontrada.', 404);
  return tienda;
}
async function origenActor(actor, id, transaction) {
  const deposito = await Deposito.findOne({ where: { id, usuario_id: actor.id, tienda_id: actor.tiendaId,
    activo: true, alcance: 'PROPIO' }, transaction });
  if (!deposito) fail('Depósito de origen no encontrado en esta tienda.', 404);
  return deposito;
}
const contacto = registro => ({ id: registro.id, nombre: registro.nombre, ciudad: registro.ciudad, direccion: registro.direccion,
  persona_contacto: registro.persona_contacto || '', telefono_contacto: registro.telefono_contacto || '' });
function salidaEnvio(registro) {
  const datos = registro.toJSON ? registro.toJSON() : registro;
  const { solicitud_key, solicitud_hash, ...publico } = datos;
  return publico;
}
const incluyeEnvio = () => [
  { model: Tienda, as: 'tienda', attributes: ['id', 'nombre'] },
  { model: Usuario, as: 'comercio', attributes: ['id', 'nombre'] },
];

async function destinos(portal = false) {
  return RahaDestino.findAll({ where: portal ? {} : { activo: true },
    attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto', 'activo'], order: [['nombre', 'ASC']] });
}
async function guardarDestino(portalUsuario, input, id = null) {
  const datos = parse(destinoSchema, input);
  if (!id) return RahaDestino.create({ ...datos, creado_por: portalUsuario.id });
  const destino = await RahaDestino.findByPk(id);
  if (!destino) fail('Depósito RAHA no encontrado.', 404);
  return destino.update(datos);
}
async function origenes(actor) {
  await tiendaActor(actor);
  return Deposito.findAll({ where: { usuario_id: actor.id, tienda_id: actor.tiendaId, activo: true, alcance: 'PROPIO' },
    attributes: ['id', 'nombre', 'ciudad', 'direccion'], order: [['nombre', 'ASC']] });
}
async function stock(actor, input = {}) {
  const tienda = await tiendaActor(actor);
  const depositoId = Number(input.deposito_origen_id);
  if (!Number.isSafeInteger(depositoId) || depositoId <= 0) fail('Seleccioná el depósito de origen.');
  await origenActor(actor, depositoId);
  const pagina = paginar(input);
  const resultado = await catalogoEnvio(actor, tienda, depositoId, { ...pagina, texto: input.texto });
  return respuesta(resultado.registros, Number(resultado.total), pagina);
}

async function catalogoEnvio(actor, tienda, depositoId, { texto = '', limit = 100, offset = 0, items = null } = {}, transaction) {
  const [[resultado]] = await sequelize.query(`WITH catalogo AS (
    SELECT p.id AS producto_id, v.id AS variante_id,
      jsonb_build_object('id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'imagen_url', foto.url) AS producto,
      CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('id', v.id, 'nombre', v.nombre, 'sku_variante', v.sku_variante, 'activo', v.activo) END AS variante,
      COALESCE(i.cantidad_disponible, 0) AS disponible, i.id IS NOT NULL AS stock_registrado
    FROM productos p
    LEFT JOIN producto_variantes v ON v.producto_id = p.id AND v.activo
    LEFT JOIN inventario_ubicaciones i ON i.producto_id = p.id AND i.variante_id IS NOT DISTINCT FROM v.id
      AND i.usuario_id = :usuarioId AND i.deposito_id = :depositoId
    LEFT JOIN LATERAL (
      SELECT imagen.url FROM producto_imagenes imagen
      WHERE imagen.producto_id = p.id AND imagen.inquilino_id = p.inquilino_id
        AND (imagen.variante_id IS NULL OR imagen.variante_id = v.id)
      ORDER BY (imagen.variante_id = v.id) DESC NULLS LAST, imagen.es_principal DESC, imagen.orden, imagen.id
      LIMIT 1
    ) foto ON TRUE
    WHERE p.activo AND p.inquilino_id = :inquilinoId AND (
      (p.creado_por = :usuarioId AND p.tienda_id = :tiendaId) OR (p.creado_por IS NULL AND (p.tienda_id IS NULL OR p.tienda_id = :tiendaId)) OR
      EXISTS (SELECT 1 FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.id = p.creado_por AND u.inquilino_id = :inquilinoId AND r.nombre = 'administrador'))
      AND (v.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM producto_variantes existente WHERE existente.producto_id = p.id))
      AND (:texto = '' OR p.nombre ILIKE :patron OR p.sku ILIKE :patron OR v.nombre ILIKE :patron OR v.sku_variante ILIKE :patron)
      ${items ? `AND EXISTS (SELECT 1 FROM jsonb_to_recordset(CAST(:items AS jsonb)) AS seleccionado(producto_id int, variante_id int)
        WHERE seleccionado.producto_id = p.id AND seleccionado.variante_id IS NOT DISTINCT FROM v.id)` : ''}
    ) SELECT (SELECT COUNT(*) FROM catalogo)::int AS total,
      COALESCE((SELECT jsonb_agg(fila) FROM
        (SELECT * FROM catalogo ORDER BY producto_id, variante_id NULLS FIRST LIMIT :limite OFFSET :desplazamiento) fila), '[]'::jsonb) AS registros`, {
    replacements: { usuarioId: actor.id, tiendaId: actor.tiendaId, inquilinoId: tienda.inquilino_id,
      depositoId, texto: consultaTexto(texto), patron: `%${consultaTexto(texto)}%`, limite: limit, desplazamiento: offset,
      items: items ? JSON.stringify(items) : null }, transaction,
  });
  return resultado;
}
async function crearEnvio(actor, input) {
  const datos = parse(envioSchema, input);
  const tienda = await tiendaActor(actor);
  if (!await require('./service').conexionAprobada(actor.id)) fail('Necesitás la conexión con RAHA aprobada para solicitar un envío.', 409);
  datos.items.sort((anterior, siguiente) => anterior.producto_id - siguiente.producto_id || (anterior.variante_id || 0) - (siguiente.variante_id || 0));
  const claves = datos.items.map(item => `${item.producto_id}:${item.variante_id || 0}`);
  if (new Set(claves).size !== claves.length) fail('No repitas el mismo producto y variante en la solicitud.');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ ...datos, solicitud_key: undefined })).digest('hex');
  return sequelize.transaction(async transaction => {
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:clave, 0))', {
      replacements: { clave: `raha-envio:${actor.id}:${actor.tiendaId}:${datos.solicitud_key}` }, transaction });
    const anterior = await RahaEnvioStock.findOne({ where: { usuario_id: actor.id, tienda_id: actor.tiendaId,
      solicitud_key: datos.solicitud_key }, transaction });
    if (anterior) {
      if (anterior.solicitud_hash !== hash) fail('La clave de solicitud ya se usó con otros productos o cantidades.', 409);
      return salidaEnvio(anterior);
    }
    const origen = await origenActor(actor, datos.deposito_origen_id, transaction);
    const destino = await RahaDestino.findOne({ where: { id: datos.destino_raha_id, activo: true }, transaction });
    if (!destino) fail('RAHA debe habilitar el depósito de destino antes de solicitar el envío.', 409);
    const { registros: existencias } = await catalogoEnvio(actor, tienda, origen.id, { items: datos.items }, transaction);
    const items = datos.items.map(item => {
      const existencia = existencias.find(fila => fila.producto_id === item.producto_id && (fila.variante_id || null) === item.variante_id);
      if (!existencia || (existencia.stock_registrado && Number(existencia.disponible) < item.cantidad)) fail('Stock insuficiente o producto no disponible en el depósito de origen. Actualizá la selección.', 409);
      return { ...item, nombre: existencia.producto.nombre, sku: existencia.variante?.sku_variante || existencia.producto.sku || '',
        variante: existencia.variante?.nombre || '', stock_registrado: existencia.stock_registrado,
        imagen_url: existencia.producto.imagen_url || null };
    });
    const registro = await RahaEnvioStock.create({ usuario_id: actor.id, tienda_id: actor.tiendaId,
      deposito_origen_id: origen.id, destino_raha_id: destino.id, solicitud_key: datos.solicitud_key, solicitud_hash: hash,
      estado: 'solicitada', items, origen_snapshot: contacto(origen), destino_snapshot: contacto(destino), observacion: datos.observacion,
      historial: [{ estado: 'solicitada', fecha: new Date().toISOString(), autor: 'Comercio',
        comentario: 'Solicitud enviada a RAHA para coordinar el traslado.' }], version: 0 }, { transaction });
    return salidaEnvio(registro);
  });
}
async function listarEnvios(actor, input = {}, portal = false) {
  if (!portal) await tiendaActor(actor);
  const where = portal ? {} : { usuario_id: actor.id, tienda_id: actor.tiendaId };
  if (input.estado) {
    if (!ESTADOS.includes(input.estado)) fail('Estado de solicitud inválido.');
    where.estado = input.estado;
  }
  rango(where, input);
  const texto = consultaTexto(input.texto);
  if (texto) {
    const filtro = { [Op.iLike]: `%${texto}%` };
    where[Op.or] = [{ '$tienda.nombre$': filtro }, { '$comercio.nombre$': filtro },
      sqlWhere(sequelize.cast(sequelize.col('RahaEnvioStock.items'), 'text'), filtro),
      sqlWhere(sequelize.cast(sequelize.col('RahaEnvioStock.origen_snapshot'), 'text'), filtro),
      sqlWhere(sequelize.cast(sequelize.col('RahaEnvioStock.destino_snapshot'), 'text'), filtro)];
    if (idTexto(texto)) where[Op.or].push({ id: idTexto(texto) });
  }
  const pagina = paginar(input);
  const { rows, count } = await RahaEnvioStock.findAndCountAll({ where, include: incluyeEnvio(),
    order: [['created_at', 'DESC'], ['id', 'DESC']], limit: pagina.limit, offset: pagina.offset, subQuery: false });
  return respuesta(rows.map(salidaEnvio), count, pagina);
}
async function detalleEnvio(actor, id, portal = false) {
  if (!portal) await tiendaActor(actor);
  const registro = await RahaEnvioStock.findOne({ where: { id, ...(portal ? {} : { usuario_id: actor.id, tienda_id: actor.tiendaId }) }, include: incluyeEnvio() });
  if (!registro) fail('Solicitud de envío no encontrada.', 404);
  return salidaEnvio(registro);
}
async function resolverEnvio(actor, id, input, portal = false) {
  const datos = parse(z.object({ estado: z.enum(ESTADOS), version: z.number().int().nonnegative(),
    comentario: z.string().trim().max(2000).default('') }).strict(), input);
  if (!portal) await tiendaActor(actor);
  return sequelize.transaction(async transaction => {
    const registro = await RahaEnvioStock.findOne({ where: { id, ...(portal ? {} : { usuario_id: actor.id, tienda_id: actor.tiendaId }) },
      transaction, lock: transaction.LOCK.UPDATE });
    if (!registro) fail('Solicitud de envío no encontrada.', 404);
    if (registro.version !== datos.version) fail('La solicitud cambió. Actualizá antes de continuar.', 409);
    const permitidos = portal
      ? (registro.estado === 'enviado' ? ['recibido'] : ['solicitada', 'observada'].includes(registro.estado) ? ['aceptada', 'observada', 'rechazada'] : [])
      : (['solicitada', 'aceptada'].includes(registro.estado) ? ['preparado', 'cancelada']
        : registro.estado === 'preparado' ? ['enviado', 'cancelada'] : registro.estado === 'observada' ? ['cancelada'] : []);
    if (!permitidos.includes(datos.estado)) fail('La transición no está permitida para esta solicitud.', 409);
    if (['observada', 'rechazada'].includes(datos.estado) && !datos.comentario) fail('Indicá el motivo para que el comercio pueda revisarlo.');
    await registro.update({ estado: datos.estado, version: registro.version + 1,
      historial: [...registro.historial, { estado: datos.estado, fecha: new Date().toISOString(),
        autor: portal ? `RAHA · ${actor.nombre}` : 'Comercio', ...(portal ? { raha_portal_usuario_id: actor.id } : {}), comentario: datos.comentario }] }, { transaction });
    return salidaEnvio(registro);
  });
}
function incluyeAbastecimiento() {
  return [{ ...seguimiento.incluirPedido(), required: true },
    { model: Producto, as: 'producto', attributes: ['id', 'nombre', 'sku'] },
    { model: ProductoVariante, as: 'variante', attributes: ['id', 'nombre', 'sku_variante'] },
    { model: Deposito, as: 'depositoDestino', attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'],
      include: [{ model: Tienda, as: 'tienda', attributes: ['id', 'nombre'] }] },
    { model: Usuario, attributes: ['id', 'nombre'] }];
}
async function abastecimientos(input = {}) {
  const where = { tipo_logistica: 'PROPIA' };
  rango(where, input);
  if (input.estado) where[Op.and] = [sqlWhere(seguimiento.estadoConsulta(), String(input.estado))];
  const texto = consultaTexto(input.texto);
  if (texto) {
    const filtro = { [Op.iLike]: `%${texto}%` };
    where[Op.or] = [{ '$producto.nombre$': filtro }, { '$producto.sku$': filtro }, { '$variante.sku_variante$': filtro },
      { '$variante.nombre$': filtro }, { '$pedidoRaha.order_id$': filtro }, { '$depositoDestino.nombre$': filtro },
      { '$depositoDestino.tienda.nombre$': filtro }, { '$Usuario.nombre$': filtro }];
    if (idTexto(texto)) where[Op.or].push({ id: idTexto(texto) });
  }
  const pagina = paginar(input);
  const { rows, count } = await SolicitudAbastecimiento.findAndCountAll({ where, include: incluyeAbastecimiento(),
    order: [['created_at', 'DESC'], ['id', 'DESC']], limit: pagina.limit, offset: pagina.offset, subQuery: false,
    attributes: ['id', 'usuario_id', 'producto_id', 'cantidad', 'tipo_logistica', 'estado', 'costo_producto', 'costo_logistico', 'created_at'] });
  return respuesta(rows.map(fila => seguimiento.presentar(fila.toJSON())), count, pagina);
}
async function detalleAbastecimiento(id) {
  const registro = await SolicitudAbastecimiento.findOne({ where: { id, tipo_logistica: 'PROPIA' }, include: incluyeAbastecimiento(),
    attributes: ['id', 'usuario_id', 'producto_id', 'cantidad', 'tipo_logistica', 'estado', 'costo_producto', 'costo_logistico', 'created_at'] });
  if (!registro) fail('Abastecimiento no vinculado a RAHA.', 404);
  const datos = seguimiento.presentar(registro.toJSON());
  return { ...datos, historial_raha: await seguimiento.historial(datos) };
}

module.exports = { destinos, guardarDestino, origenes, stock, crearEnvio, listarEnvios, detalleEnvio, resolverEnvio,
  abastecimientos, detalleAbastecimiento };
