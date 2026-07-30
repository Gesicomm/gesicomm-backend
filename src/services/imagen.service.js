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

  static async subir(producto_id, inquilino_id, fileData, bodyData) {
    const tmpPath = fileData.path;
    try {
      const buffer = await fs.promises.readFile(tmpPath);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const finalPath = path.join(UPLOADS_PUBLIC, filename);

      await sharp(buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(finalPath);

      await this.borrarArchivoSeguro(tmpPath);

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
        url: `/uploads/${filename}`,
        es_principal: esPrincipal,
        orden: maxOrden + 1,
      });

      return imagen;
    } catch (err) {
      await this.borrarArchivoSeguro(tmpPath);
      throw err;
    }
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
