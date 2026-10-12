'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { ProductoImagen, ProductoComboImagen } = require('../models');
const { R2Service, IMMUTABLE_CACHE_CONTROL } = require('./r2/r2.service');
const { buildPublicUrl, extractStorageKeyFromUrl } = require('./r2/r2.config');

function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function normalizarExtension(nombre = '', mime = '') {
  const ext = path.extname(nombre).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext;
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

function boolUpload(valor, fallback = false) {
  if (valor === undefined || valor === null || valor === '') return fallback;
  return valor === true || valor === 'true' || valor === '1' || valor === 1;
}

function numeroEnRango(valor, fallback, min, max) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function modoVisual(valor) {
  return valor === 'cover' ? 'cover' : 'contain';
}

// 1 = sin zoom, tope 3x (más que eso ya pixela la versión optimizada de
// 1600px de ancho). Se guarda dentro de optimizacion_json en vez de sumar
// una columna nueva — es metadata de encuadre, no del archivo en sí.
function numeroZoom(valor, fallback = 1) {
  return numeroEnRango(valor, fallback, 1, 3);
}

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
    if (data.visual_modo !== 'cover') data.visual_modo = 'contain';
    if (data.focal_x != null) data.focal_x = Number(data.focal_x);
    if (data.focal_y != null) data.focal_y = Number(data.focal_y);
    // Vive en optimizacion_json (ver numeroZoom) pero el frontend lo lee
    // como campo plano, igual que focal_x/focal_y.
    data.zoom = numeroZoom(data.optimizacion_json?.zoom, 1);
    return data;
  }

  /**
   * Favicon de la tienda: PNG cuadrado de 192x192 con fondo transparente.
   *
   * - Recorta antes los márgenes vacíos (transparentes o de color parejo):
   *   un ícono con aire alrededor es justamente lo que se ve diminuto en la
   *   pestaña. Sin el piso del 35% de recorteAutomatico: acá sacar mucho
   *   margen es el objetivo (un logo de 800x400 con el símbolo al medio
   *   queda en ~260x190 y el piso lo descartaba).
   * - Si no es cuadrado lo centra (contain) en vez de deformarlo o cortarlo.
   * - 192 px cubre la pestaña en pantallas de alta densidad (16-32 px x2/x3)
   *   y el ícono de acceso directo de Android; el navegador lo achica solo.
   * - PNG y no WebP: es el formato de favicon que aceptan todos los
   *   navegadores, Safari incluido.
   */
  static async procesarFaviconParaR2(fileData, keyPrefix) {
    const tmpPath = fileData.path;
    try {
      const buffer = await fs.promises.readFile(tmpPath);
      const original = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
      let base = original.data;
      try {
        const recortado = await sharp(original.data).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
        if (recortado.info.width >= 16 && recortado.info.height >= 16) base = recortado.data;
      } catch {
        // trim falla con imágenes de un solo color: se usa sin recortar.
      }

      const salida = await sharp(base)
        .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const storageKey = `${keyPrefix}/${crypto.randomUUID()}.png`;
      const result = await R2Service.uploadObject({
        key: storageKey,
        body: salida,
        contentType: 'image/png',
        cacheControl: IMMUTABLE_CACHE_CONTROL,
        contentLength: salida.length,
      });
      await this.borrarArchivoSeguro(tmpPath);
      return { url: result.url, storage_key: storageKey };
    } catch (err) {
      await this.borrarArchivoSeguro(tmpPath);
      throw err;
    }
  }

  /**
   * Núcleo del procesamiento (trim + resize + webp + subida), sin tocar
   * disco ni el original — lo comparten procesarArchivoParaR2() (sube
   * desde multer) y reprocesar() (relee el original ya guardado en R2).
   * Separarlo es lo que permite reprocesar sin volver a pedir el archivo.
   */
  static async procesarBufferParaR2(buffer, keyPrefix, {
    width = 1200,
    quality = 82,
    recorteAutomatico = false,
    // 14 (default de sharp ~10) apenas toleraba ruido de compresión: fotos
    // de producto con fondo blanco casi uniforme pero con un leve degradé
    // de estudio o artefactos JPEG cerca del borde no se recortaban casi
    // nada, y quedaba el margen vacío que se ve en la landing. Con el piso
    // del 35% ya evitando comerse el producto, subir el umbral es seguro.
    trimThreshold = 26,
  } = {}) {
    const originalMetadata = await sharp(buffer).metadata();
    const uuid = crypto.randomUUID();

    let bufferProcesable = buffer;
    let recorte = { aplicado: false };
    if (recorteAutomatico) {
      try {
        const trimmed = await sharp(buffer)
          .rotate()
          .trim({ threshold: trimThreshold })
          .toBuffer({ resolveWithObject: true });
        const minAncho = Math.max(40, Math.round((originalMetadata.width || 0) * 0.35));
        const minAlto = Math.max(40, Math.round((originalMetadata.height || 0) * 0.35));
        if (trimmed.info.width >= minAncho && trimmed.info.height >= minAlto) {
          bufferProcesable = trimmed.data;
          recorte = {
            aplicado: trimmed.info.width !== originalMetadata.width || trimmed.info.height !== originalMetadata.height,
            original_width: originalMetadata.width || null,
            original_height: originalMetadata.height || null,
            width: trimmed.info.width,
            height: trimmed.info.height,
          };
        }
      } catch (err) {
        recorte = { aplicado: false, error: 'trim_failed' };
      }
    }

    const outputBuffer = await sharp(bufferProcesable)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    const metadata = await sharp(outputBuffer).metadata();
    const storageKey = `${keyPrefix}/${uuid}.webp`;

    const result = await R2Service.uploadObject({
      key: storageKey,
      body: outputBuffer,
      contentType: 'image/webp',
      cacheControl: IMMUTABLE_CACHE_CONTROL,
      contentLength: outputBuffer.length,
    });

    return {
      storage_key: storageKey,
      url: result.url,
      mime_type: 'image/webp',
      size: outputBuffer.length,
      width: metadata.width || null,
      height: metadata.height || null,
      optimizacion_json: {
        recorte,
        original: {
          width: originalMetadata.width || null,
          height: originalMetadata.height || null,
          size: buffer.length,
        },
        optimizada: {
          width: metadata.width || null,
          height: metadata.height || null,
          mime_type: 'image/webp',
          size: outputBuffer.length,
        },
      },
    };
  }

  /**
   * Redimensiona a WebP y sube a R2 bajo `{keyPrefix}/{uuid}.webp`. Base
   * compartida por todos los módulos (productos, landings, ofertas,
   * testimonios) — cada uno solo decide su propio prefijo de key.
   */
  static async procesarArchivoParaR2(fileData, keyPrefix, {
    conservarOriginal = false,
    ...opts
  } = {}) {
    const tmpPath = fileData.path;
    try {
      const buffer = await fs.promises.readFile(tmpPath);
      const uuid = crypto.randomUUID();
      let originalData = null;

      if (conservarOriginal) {
        const originalKey = `${keyPrefix}/originales/${uuid}${normalizarExtension(fileData.originalname, fileData.mimetype)}`;
        const originalUpload = await R2Service.uploadObject({
          key: originalKey,
          body: buffer,
          contentType: fileData.mimetype || 'application/octet-stream',
          cacheControl: IMMUTABLE_CACHE_CONTROL,
          contentLength: buffer.length,
        });
        originalData = {
          original_storage_key: originalKey,
          original_url: originalUpload.url,
        };
      }

      const procesado = await this.procesarBufferParaR2(buffer, keyPrefix, opts);
      await this.borrarArchivoSeguro(tmpPath);
      return {
        ...originalData,
        ...procesado,
        optimizacion_json: {
          ...procesado.optimizacion_json,
          original: { ...procesado.optimizacion_json.original, mime_type: fileData.mimetype || null },
        },
      };
    } catch (err) {
      await this.borrarArchivoSeguro(tmpPath);
      throw err;
    }
  }

  /** Descarga un objeto de R2 completo a un Buffer (GetObjectCommand devuelve un stream). */
  static async descargarObjetoStorage(storageKey) {
    const objeto = await R2Service.getObject(storageKey);
    const chunks = [];
    for await (const chunk of objeto.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Regenera la versión optimizada de una imagen ya subida, releyendo el
   * ARCHIVO ORIGINAL conservado en R2 — nunca el derivado ya redimensionado
   * (redimensionar dos veces perdería calidad) y nunca el original en sí
   * (queda intacto, así se puede reprocesar cuantas veces haga falta).
   * Sube el nuevo derivado bajo una key nueva y solo después borra el
   * derivado viejo, para no perder la imagen si algo falla en el medio.
   */
  static async reprocesar(imagen_id, producto_id, inquilino_id, opts = {}) {
    const imagen = await ProductoImagen.findOne({ where: { id: imagen_id, producto_id, inquilino_id } });
    if (!imagen) throw new Error('Imagen no encontrada.');
    if (!imagen.original_storage_key) {
      throw new Error('Esta imagen no tiene un original conservado (es de antes de esta función) — volvé a subirla para poder reprocesarla.');
    }

    const buffer = await this.descargarObjetoStorage(imagen.original_storage_key);
    const procesado = await this.procesarBufferParaR2(buffer, `products/${producto_id}`, {
      width: 1600,
      quality: 86,
      recorteAutomatico: boolUpload(opts.auto_trim, true),
    });

    const derivadoAnterior = { storage_key: imagen.storage_key, url: imagen.url };
    const anteriorParaComparar = {
      url: imagen.url,
      width: imagen.width,
      height: imagen.height,
      visual_modo: imagen.visual_modo,
    };
    // El zoom es encuadre manual del comercio, no algo que el reprocesamiento
    // deba resetear — se conserva salvo que este mismo llamado traiga uno.
    const zoomAConservar = opts.zoom !== undefined ? numeroZoom(opts.zoom) : (imagen.optimizacion_json?.zoom ?? 1);

    imagen.storage_key = procesado.storage_key;
    imagen.url = procesado.url;
    imagen.mime_type = procesado.mime_type;
    imagen.size = procesado.size;
    imagen.width = procesado.width;
    imagen.height = procesado.height;
    if (opts.visual_modo !== undefined) imagen.visual_modo = modoVisual(opts.visual_modo);
    if (opts.focal_x !== undefined) imagen.focal_x = numeroEnRango(opts.focal_x, imagen.focal_x, 0, 100);
    if (opts.focal_y !== undefined) imagen.focal_y = numeroEnRango(opts.focal_y, imagen.focal_y, 0, 100);
    imagen.optimizacion_json = { ...procesado.optimizacion_json, anterior: anteriorParaComparar, zoom: zoomAConservar };
    await imagen.save();

    // Recién ahora, con el nuevo derivado ya subido y la fila ya guardada,
    // se puede borrar el derivado viejo sin riesgo de quedarse sin ninguno.
    await this.eliminarObjetoStorage(derivadoAnterior).catch(() => {});

    return { ...this.serializar(imagen), anterior_url: anteriorParaComparar.url };
  }

  static async procesarProductoParaR2(fileData, producto_id, opts = {}) {
    return this.procesarArchivoParaR2(fileData, `products/${producto_id}`, {
      width: 1600,
      quality: 86,
      conservarOriginal: true,
      recorteAutomatico: true,
      ...opts,
    });
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
    const imagenProcesada = await this.procesarProductoParaR2(fileData, producto_id, {
      recorteAutomatico: boolUpload(bodyData.auto_trim, true),
    });

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
      original_url: imagenProcesada.original_url || null,
      original_storage_key: imagenProcesada.original_storage_key || null,
      mime_type: imagenProcesada.mime_type,
      size: imagenProcesada.size,
      width: imagenProcesada.width,
      height: imagenProcesada.height,
      visual_modo: modoVisual(bodyData.visual_modo),
      focal_x: numeroEnRango(bodyData.focal_x, 50, 0, 100),
      focal_y: numeroEnRango(bodyData.focal_y, 50, 0, 100),
      optimizacion_json: bodyData.zoom !== undefined
        ? { ...imagenProcesada.optimizacion_json, zoom: numeroZoom(bodyData.zoom) }
        : imagenProcesada.optimizacion_json,
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
    if (datos.visual_modo !== undefined) imagen.visual_modo = modoVisual(datos.visual_modo);
    if (datos.focal_x !== undefined) imagen.focal_x = numeroEnRango(datos.focal_x, 50, 0, 100);
    if (datos.focal_y !== undefined) imagen.focal_y = numeroEnRango(datos.focal_y, 50, 0, 100);
    if (datos.zoom !== undefined) {
      imagen.optimizacion_json = { ...(imagen.optimizacion_json || {}), zoom: numeroZoom(datos.zoom) };
    }

    await imagen.save();
    return this.serializar(imagen);
  }

  static async eliminar(imagen_id, producto_id, inquilino_id) {
    const imagen = await ProductoImagen.findOne({ where: { id: imagen_id, producto_id, inquilino_id } });
    if (!imagen) throw new Error('Imagen no encontrada.');

    await this.eliminarObjetoStorage(imagen);
    await this.eliminarObjetoStorage({ url: imagen.original_url, storage_key: imagen.original_storage_key });
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
