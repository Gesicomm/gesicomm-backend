'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('./r2/r2.service');
const ImagenService = require('./imagen.service');

/**
 * Comprobantes de costos/gastos (facturas escaneadas o PDF) — mismo destino
 * (R2) que el resto de las imágenes del proyecto, pero admite también PDF:
 * las imágenes se procesan con sharp a WebP, el PDF se sube tal cual.
 */
class ComprobanteService {
  static async procesarComprobanteParaR2(fileData, costo_gasto_id, prefijo = 'receipts') {
    const tmpPath = fileData.path;
    try {
      const esImagen = fileData.mimetype.startsWith('image/');
      const storageKey = `${prefijo}/${costo_gasto_id}/${crypto.randomUUID()}.${esImagen ? 'webp' : 'pdf'}`;

      let body, contentType, size;
      if (esImagen) {
        const buffer = await fs.promises.readFile(tmpPath);
        body = await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
        contentType = 'image/webp';
        size = body.length;
      } else {
        body = await fs.promises.readFile(tmpPath);
        contentType = 'application/pdf';
        size = body.length;
      }

      const result = await R2Service.uploadObject({
        key: storageKey,
        body,
        contentType,
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        contentLength: size,
      });

      await ImagenService.borrarArchivoSeguro(tmpPath);
      return {
        storage_key: storageKey,
        url: result.url,
        mime_type: contentType,
        size,
      };
    } catch (err) {
      await ImagenService.borrarArchivoSeguro(tmpPath);
      throw err;
    }
  }
}

module.exports = ComprobanteService;
