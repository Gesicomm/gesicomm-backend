'use strict';

const crypto = require('crypto');
const sharp = require('sharp');
const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Op } = require('sequelize');
const { sequelize, MensajeContacto } = require('../models');
const { getR2Client } = require('./r2/r2.client');

const PREFIJO = 'Gesicom · Postulación de proveedor · ';
const MAX_SIZE = 8 * 1024 * 1024;
const error = (status, message) => Object.assign(new Error(message), { status });
const TIPOS = { cedula_frente: 'cedula_frente', cedula_dorso: 'cedula_dorso', contrato_base: 'contrato_base', contrato_firmado: 'contrato_firmado' };

function privateBucket() {
  const bucket = process.env.PROVEEDOR_PRIVATE_BUCKET || process.env.RAHA_PRIVATE_BUCKET;
  if (!bucket || bucket === process.env.R2_BUCKET_NAME) throw error(503, 'El almacenamiento privado de proveedores no está configurado.');
  return bucket;
}

function resumenDocumentos(perfil = {}) {
  const docs = perfil.documentos || {};
  return {
    cedula_frente_cargada: Boolean(docs.cedula_frente?.key || docs.cedula?.key),
    cedula_dorso_cargada: Boolean(docs.cedula_dorso?.key),
    contrato_disponible: Boolean(docs.contrato_base?.key),
    contrato_firmado: Boolean(docs.contrato_firmado?.key),
    contrato_estado: docs.contrato_estado || (docs.contrato_base?.key ? docs.contrato_firmado?.key ? 'pendiente_revision' : 'pendiente_firma' : 'sin_contrato'),
    contrato_nota: docs.contrato_nota || '',
  };
}

async function normalizar(file, tipo) {
  if (!file?.buffer?.length || file.buffer.length > MAX_SIZE || file.size > MAX_SIZE) throw error(400, 'El archivo debe pesar hasta 8 MB.');
  if (tipo === 'cedula_frente' || tipo === 'cedula_dorso') {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw error(400, 'Subí una foto JPG, PNG o WebP de tu cédula.');
    try {
      const imagen = sharp(file.buffer, { limitInputPixels: 30000000, animated: false });
      const meta = await imagen.metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || meta.width < 500 || meta.height < 300) throw new Error('Dimensiones insuficientes');
      const body = await imagen.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
      return { body, mime: 'image/jpeg', ext: 'jpg', nombre: `${tipo}.jpg` };
    } catch { throw error(400, 'La foto de la cédula debe ser legible y medir al menos 500 × 300 píxeles.'); }
  }
  if (file.mimetype !== 'application/pdf' || !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-')) || !file.buffer.subarray(-2048).includes(Buffer.from('%%EOF'))) {
    throw error(400, 'Subí un archivo PDF válido de hasta 8 MB.');
  }
  return { body: file.buffer, mime: 'application/pdf', ext: 'pdf', nombre: tipo === 'contrato_base' ? 'contrato-proveedor.pdf' : 'contrato-firmado.pdf' };
}

async function subirPrivado(file, tipo) {
  const { body, mime, ext, nombre } = await normalizar(file, tipo);
  const key = `proveedores/documentos/${Date.now()}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await getR2Client().send(new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: body, ContentType: mime, CacheControl: 'private, no-store' }));
  return { key, mime, nombre, cargado_en: new Date().toISOString() };
}

async function eliminarPrivado(doc) {
  if (doc?.key) await getR2Client().send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: doc.key }));
}

async function solicitud(id, options = {}) {
  const postulacion = await MensajeContacto.findOne({ where: { id, area: 'comercial', asunto: { [Op.startsWith]: PREFIJO } }, ...options });
  if (!postulacion) throw error(404, 'Postulación de proveedor no encontrada.');
  return postulacion;
}

async function guardarDocumento(id, tipo, file) {
  if (!TIPOS[tipo]) throw error(400, 'Tipo de documento inválido.');
  const nuevo = await subirPrivado(file, tipo);
  let anterior, anteriorFirmado;
  try {
    await sequelize.transaction(async transaction => {
      const postulacion = await solicitud(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (postulacion.revision_proveedor === 'rechazada' && !tipo.startsWith('cedula_')) throw error(409, 'La postulación rechazada requiere una nueva solicitud.');
      const perfil = { ...(postulacion.datos_proveedor || {}) };
      const documentos = { ...(perfil.documentos || {}) };
      if (tipo === 'contrato_firmado' && !documentos.contrato_base?.key) throw error(409, 'El administrador todavía no adjuntó el contrato.');
      anterior = documentos[tipo] || (tipo === 'cedula_frente' ? documentos.cedula : null);
      documentos[tipo] = nuevo;
      if (tipo === 'cedula_frente') delete documentos.cedula;
      if (tipo === 'contrato_base') {
        anteriorFirmado = documentos.contrato_firmado;
        documentos.contrato_firmado = null;
        documentos.contrato_estado = 'pendiente_firma';
        documentos.contrato_nota = '';
      }
      if (tipo === 'contrato_firmado') {
        documentos.contrato_estado = 'pendiente_revision';
        documentos.contrato_nota = '';
      }
      await postulacion.update({ datos_proveedor: { ...perfil, documentos } }, { transaction });
    });
  } catch (err) { await eliminarPrivado(nuevo).catch(() => {}); throw err; }
  if (anterior) await eliminarPrivado(anterior).catch(() => {});
  if (anteriorFirmado) await eliminarPrivado(anteriorFirmado).catch(() => {});
  return resumenDocumentos((await solicitud(id)).datos_proveedor);
}

async function revisarContrato(id, { estado, nota = '' }) {
  if (!['validado', 'correccion'].includes(estado)) throw error(400, 'Estado de contrato inválido.');
  return sequelize.transaction(async transaction => {
    const postulacion = await solicitud(id, { transaction, lock: transaction.LOCK.UPDATE });
    const perfil = { ...(postulacion.datos_proveedor || {}) };
    const documentos = { ...(perfil.documentos || {}) };
    if (!documentos.contrato_firmado?.key) throw error(409, 'El proveedor todavía no subió el contrato firmado.');
    if (estado === 'correccion' && nota.trim().length < 3) throw error(400, 'Indicá qué debe corregir el proveedor.');
    documentos.contrato_estado = estado;
    documentos.contrato_nota = estado === 'correccion' ? nota.trim().slice(0, 1000) : '';
    await postulacion.update({ datos_proveedor: { ...perfil, documentos } }, { transaction });
    return resumenDocumentos({ documentos });
  });
}

async function leerDocumento(id, tipo) {
  if (!TIPOS[tipo]) throw error(400, 'Tipo de documento inválido.');
  const postulacion = await solicitud(id);
  const docs = postulacion.datos_proveedor?.documentos || {};
  const doc = docs[tipo] || (tipo === 'cedula_frente' ? docs.cedula : null);
  if (!doc?.key || !/^proveedores\/documentos\/[0-9]+-[a-f0-9]{24}\.(jpg|pdf)$/.test(doc.key)) throw error(404, 'Documento no disponible.');
  const objeto = await getR2Client().send(new GetObjectCommand({ Bucket: privateBucket(), Key: doc.key }));
  return { body: Buffer.from(await objeto.Body.transformToByteArray()), mime: doc.mime, nombre: tipo.startsWith('cedula_') ? `${tipo}.jpg` : doc.nombre };
}

module.exports = { MAX_SIZE, resumenDocumentos, normalizar, subirPrivado, eliminarPrivado, solicitud, guardarDocumento, revisarContrato, leerDocumento };
