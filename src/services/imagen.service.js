'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { ProductoImagen } = require('../models');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('./r2/r2.service');
const { buildPublicUrl } = require('./r2/r2.config');

const UPLOADS_PUBLIC = path.join(process.cwd(), 'public', 'uploads');

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

  static serializar(imagen) {
    const data = imagen.toJSON ? imagen.toJSON() : { ...imagen };
    if (data.storage_key) {
      data.url = buildPublicUrl(data.storage_key);
    }
    return data;
  }

  /**
   * Redimensiona y guarda un archivo subido por multer en public/uploads,
   * devolviendo la URL pública relativa (misma convención en todo el
   * proyecto: "/uploads/archivo.jpg", servida por express.static).
   * No crea ninguna fila en base — eso lo decide cada caller (producto,
   * banner de landing, etc.), acá solo vive el procesamiento del archivo.
   */
  static async guardarArchivo(fileData, { width = 1200, quality = 80 } = {}) {
    const tmpPath = fileData.path;
    try {
      const buffer = await fs.promises.readFile(tmpPath);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const finalPath = path.join(UPLOADS_PUBLIC, filename);

      await sharp(buffer)
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality })
        .toFile(finalPath);

      await this.borrarArchivoSeguro(tmpPath);
      return `/uploads/${filename}`;
    } catch (err) {
      await this.borrarArchivoSeguro(tmpPath);
      throw err;
    }
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

  /**
   * Borra el objeto de R2 (storage_key) o, si es un registro legacy sin
   * storage_key, el archivo local en /uploads. Común a cualquier campo de
   * imagen que se reemplaza o se quita.
   */
  static async eliminarObjetoStorage({ url, storage_key } = {}) {
    if (storage_key) {
      await R2Service.deleteObject(storage_key);
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
}

module.exports = ImagenService;
