'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { ProductoImagen, ProductoComboImagen } = require('../models');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('./r2/r2.service');
const { buildPublicUrl, extractStorageKeyFromUrl } = require('./r2/r2.config');

function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class ImagenService {
  
  static async borrarArchivoSeguro(filePath, intentos = 3) {
    if (!filePath) return;
    for (let intento = 1; intento <= intentos; intento++) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return;
      } catch (err) {
        if (intento === intentos) {
          console.error(`[imagen] No se pudo borrar "${filePath}" tras ${intentos} intentos:`, err.message);
          return;
        }
        await esperar(75 * intento);
      }
    }
  }

  static async listarPorProducto(producto_id, inquilino_id) {
    const imagenes = await ProductoImagen.findAll({
      where: { producto_id, inquilino_id },
      order: [['orden', 'ASC']],
    });
    return imagenes.map((imagen) => this.serializar(imagen));
  }

  static async listarPorCombo(combo_id, inquilino_id) {
    const imagenes = await ProductoComboImagen.findAll({
      where: { combo_id, inquilino_id },
      order: [['orden', 'ASC']],
    });
    return imagenes.map((imagen) => this.serializar(imagen));
  }

  static serializar(imagen) {
    const data = imagen.toJSON ? imagen.toJSON() : { ...imagen };
    if (data.storage_key) {
      data.url = buildPublicUrl(data.storage_key);
    }
    return data;
  }

  /**
   * Redimensiona a WebP y sube a R2 bajo `{keyPrefix}/{uuid}.webp`. Base
   * compartida por todos los módulos (productos, landings, ofertas,
   * testimonios) — cada uno solo decide su propio prefijo de key.
   */
  static async procesarArchivoParaR2(fileData, keyPrefix, { width = 1200, quality = 82 } = {}) {
    const tmpPath = fileData.path;
    try {
      const buffer = await fs.promises.readFile(tmpPath);
      const outputBuffer = await sharp(buffer)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      const metadata = await sharp(outputBuffer).metadata();
      const storageKey = `${keyPrefix}/${crypto.randomUUID()}.webp`;

      const result = await R2Service.uploadObject({
        key: storageKey,
        body: outputBuffer,
        contentType: 'image/webp',
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        contentLength: outputBuffer.length,
      });

      await this.borrarArchivoSeguro(tmpPath);
      return {
        storage_key: storageKey,
        url: result.url,
        mime_type: 'image/webp',
        size: outputBuffer.length,
        width: metadata.width || null,
        height: metadata.height || null,
      };
    } catch (err) {
      await this.borrarArchivoSeguro(tmpPath);
      throw err;
    }
  }

  static async procesarProductoParaR2(fileData, producto_id, opts = {}) {
    return this.procesarArchivoParaR2(fileData, `products/${producto_id}`, opts);
  }

  static async procesarComboParaR2(fileData, combo_id, opts = {}) {
    return this.procesarArchivoParaR2(fileData, `combos/${combo_id}`, opts);
  }

  /**
   * Borra el objeto de R2 (storage_key) o, si es un registro legacy sin
   * storage_key, el archivo local en /uploads. Común a cualquier campo de
   * imagen que se reemplaza o se quita. Si no se pasa storage_key (módulos
   * que no lo persisten en su propia columna, ej. testimonios) se lo
   * deriva de `url` cuando es una URL pública de R2.
   */
  static async eliminarObjetoStorage({ url, storage_key } = {}) {
    const key = storage_key || extractStorageKeyFromUrl(url);
    if (key) {
      await R2Service.deleteObject(key);
    } else if (url?.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), 'public', url);
      await this.borrarArchivoSeguro(filePath);
    }
  }

  static async subir(producto_id, inquilino_id, fileData, bodyData) {
    // procesarProductoParaR2() ya limpia el tmp (éxito o error) — subir() no
    // necesita su propio try/catch de limpieza de archivo acá.
    const imagenProcesada = await this.procesarProductoParaR2(fileData, producto_id);

    const maxOrden = await ProductoImagen.max('orden', { where: { producto_id } }) || 0;
    const esPrincipal = bodyData.es_principal === 'true' || bodyData.es_principal === true;
    const variante_id = bodyData.variante_id ? parseInt(bodyData.variante_id) : null;

    if (esPrincipal) {
      await ProductoImagen.update({ es_principal: false }, { where: { producto_id } });
    }

    const imagen = await ProductoImagen.create({
      inquilino_id,
      producto_id,
      variante_id,
      url: imagenProcesada.url,
      storage_key: imagenProcesada.storage_key,
      mime_type: imagenProcesada.mime_type,
      size: imagenProcesada.size,
      width: imagenProcesada.width,
      height: imagenProcesada.height,
      es_principal: esPrincipal,
      orden: maxOrden + 1,
    });

    return this.serializar(imagen);
  }

  static async actualizar(imagen_id, producto_id, inquilino_id, datos) {
    const imagen = await ProductoImagen.findOne({ where: { id: imagen_id, producto_id, inquilino_id } });
    if (!imagen) throw new Error('Imagen no encontrada.');

    if (datos.es_principal === true || datos.es_principal === 'true') {
      await ProductoImagen.update({ es_principal: false }, { where: { producto_id } });
      imagen.es_principal = true;
    }

    if (datos.orden !== undefined) imagen.orden = datos.orden;
    if (datos.variante_id !== undefined) imagen.variante_id = datos.variante_id || null;

    await imagen.save();
    return this.serializar(imagen);
  }

  static async eliminar(imagen_id, producto_id, inquilino_id) {
    const imagen = await ProductoImagen.findOne({ where: { id: imagen_id, producto_id, inquilino_id } });
    if (!imagen) throw new Error('Imagen no encontrada.');

    await this.eliminarObjetoStorage(imagen);
    await imagen.destroy();
    return true;
  }

  static async subirCombo(combo_id, inquilino_id, fileData, bodyData = {}) {
    const existentes = await ProductoComboImagen.count({ where: { combo_id, inquilino_id } });
    if (existentes >= 5) throw new Error('El combo ya tiene el máximo de 5 imágenes.');

    const imagenProcesada = await this.procesarComboParaR2(fileData, combo_id);
    const maxOrden = await ProductoComboImagen.max('orden', { where: { combo_id, inquilino_id } }) || 0;
    const esPrincipal = existentes === 0 || bodyData.es_principal === 'true' || bodyData.es_principal === true;

    if (esPrincipal) {
      await ProductoComboImagen.update({ es_principal: false }, { where: { combo_id, inquilino_id } });
    }

    const imagen = await ProductoComboImagen.create({
      inquilino_id,
      combo_id,
      url: imagenProcesada.url,
      storage_key: imagenProcesada.storage_key,
      mime_type: imagenProcesada.mime_type,
      size: imagenProcesada.size,
      width: imagenProcesada.width,
      height: imagenProcesada.height,
      es_principal: esPrincipal,
      orden: maxOrden + 1,
    });

    return this.serializar(imagen);
  }

  static async actualizarCombo(imagen_id, combo_id, inquilino_id, datos) {
    const imagen = await ProductoComboImagen.findOne({ where: { id: imagen_id, combo_id, inquilino_id } });
    if (!imagen) throw new Error('Imagen no encontrada.');

    if (datos.es_principal === true || datos.es_principal === 'true') {
      await ProductoComboImagen.update({ es_principal: false }, { where: { combo_id, inquilino_id } });
      imagen.es_principal = true;
    }

    if (datos.orden !== undefined) imagen.orden = datos.orden;

    await imagen.save();
    return this.serializar(imagen);
  }

  static async eliminarCombo(imagen_id, combo_id, inquilino_id) {
    const imagen = await ProductoComboImagen.findOne({ where: { id: imagen_id, combo_id, inquilino_id } });
    if (!imagen) throw new Error('Imagen no encontrada.');

    await this.eliminarObjetoStorage(imagen);
    await imagen.destroy();
    return true;
  }
}

module.exports = ImagenService;
