'use strict';

function imagenesDelPedido(envio) {
  const vistas = new Set();
  return (envio.items || []).flatMap(item => {
    const imagenes = (item.Producto?.imagenes || []).filter(i => i.url);
    const variantes = imagenes.filter(i => item.variante_id && Number(i.variante_id) === Number(item.variante_id));
    const generales = imagenes.filter(i => !i.variante_id);
    const candidatas = variantes.length ? variantes : generales;
    const principal = [...candidatas].sort((a, b) => Number(b.es_principal) - Number(a.es_principal) || Number(a.orden || 0) - Number(b.orden || 0) || a.id - b.id)[0];
    const imagen = item.Oferta?.imagen_url
      ? { url: item.Oferta.imagen_url, storage_key: item.Oferta.imagen_storage_key }
      : principal;
    if (!imagen?.url || vistas.has(imagen.url)) return [];
    vistas.add(imagen.url);
    return [{ item_id: item.id, nombre: item.oferta_nombre || item.nombre_producto || item.Producto?.nombre || 'Producto', url: imagen.url, storage_key: imagen.storage_key }];
  });
}

async function imagenParaCopiar(imagen) {
  const path = require('path');
  const fs = require('fs/promises');
  const sharp = require('sharp');
  const { extractStorageKeyFromUrl } = require('../r2/r2.config');
  const key = imagen.storage_key || extractStorageKeyFromUrl(imagen.url);
  let buffer;
  if (key) {
    const { R2Service } = require('../r2/r2.service');
    const objeto = await R2Service.getObject(key);
    buffer = Buffer.from(await objeto.Body.transformToByteArray());
  } else if (imagen.url.startsWith('/uploads/')) {
    const raiz = path.resolve(__dirname, '../../../public/uploads');
    const archivo = path.resolve(raiz, decodeURIComponent(imagen.url.slice('/uploads/'.length)));
    if (!archivo.startsWith(raiz + path.sep)) throw new Error('Ruta de imagen inválida');
    buffer = await fs.readFile(archivo);
  } else {
    const error = new Error('Esta imagen externa debe copiarse desde el navegador.');
    error.status = 422;
    throw error;
  }
  return sharp(buffer, { limitInputPixels: 40000000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

module.exports = { imagenesDelPedido, imagenParaCopiar };
