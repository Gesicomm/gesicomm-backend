'use strict';

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOADS_PUBLIC = path.join(process.cwd(), 'public', 'uploads');

/**
 * Igual que ImagenService.guardarArchivo pero admite también PDF (los
 * comprobantes de costos/gastos suelen ser facturas en PDF, no solo fotos).
 * Las imágenes se procesan con sharp para ahorrar espacio; los PDF se
 * mueven tal cual.
 */
class ComprobanteService {
  static async borrarArchivoSeguro(filePath) {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`[comprobante] No se pudo borrar "${filePath}":`, err.message);
    }
  }

  static async guardarArchivo(fileData) {
    const tmpPath = fileData.path;
    try {
      const esImagen = fileData.mimetype.startsWith('image/');
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${esImagen ? 'jpg' : 'pdf'}`;
      const finalPath = path.join(UPLOADS_PUBLIC, filename);

      if (esImagen) {
        const buffer = await fs.promises.readFile(tmpPath);
        await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(finalPath);
      } else {
        await fs.promises.copyFile(tmpPath, finalPath);
      }

      await this.borrarArchivoSeguro(tmpPath);
      return `/uploads/${filename}`;
    } catch (err) {
      await this.borrarArchivoSeguro(tmpPath);
      throw err;
    }
  }
}

module.exports = ComprobanteService;
