'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { ProductoImagen } = require('../models');

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
    return await ProductoImagen.findAll({
      where: { producto_id, inquilino_id },
      order: [['orden', 'ASC']],
    });
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

  static async subir(producto_id, inquilino_id, fileData, bodyData) {
    // guardarArchivo() ya limpia el tmp (éxito o error) — subir() no
    // necesita su propio try/catch de limpieza de archivo acá.
    const url = await this.guardarArchivo(fileData);

    const maxOrden = await ProductoImagen.max('orden', { where: { producto_id } }) || 0;
    const esPrincipal = bodyData.es_principal === 'true' || bodyData.es_principal === true;
    const variante_id = bodyData.variante_id ? parseInt(bodyData.variante_id) : null;

    if (esPrincipal) {
      await ProductoImagen.update({ es_principal: false }, { where: { producto_id } });
    }

    return ProductoImagen.create({
      inquilino_id,
      producto_id,
      variante_id,
      url,
      es_principal: esPrincipal,
      orden: maxOrden + 1,
    });
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
    return imagen;
  }

  static async eliminar(imagen_id, producto_id, inquilino_id) {
    const imagen = await ProductoImagen.findOne({ where: { id: imagen_id, producto_id, inquilino_id } });
    if (!imagen) throw new Error('Imagen no encontrada.');

    const filePath = path.join(process.cwd(), 'public', imagen.url);
    await this.borrarArchivoSeguro(filePath);

    await imagen.destroy();
    return true;
  }
}

module.exports = ImagenService;
