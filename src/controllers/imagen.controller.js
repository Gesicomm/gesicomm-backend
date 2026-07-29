/**
 * Controller de Imágenes de Productos.
 *
 * POST /api/productos/:id/imagenes         → Subir imagen (multer + sharp)
 * PUT  /api/productos/:id/imagenes/:imgId  → Actualizar orden/principal/variante
 * DELETE /api/productos/:id/imagenes/:imgId → Eliminar imagen
 */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { ProductoImagen, Producto } = require('../models');

const UPLOADS_TMP    = path.join(process.cwd(), 'tmp', 'uploads');
const UPLOADS_PUBLIC = path.join(process.cwd(), 'public', 'uploads');

[UPLOADS_TMP, UPLOADS_PUBLIC].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

function esperar(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Borra un archivo sin propagar el error si falla (ej. EBUSY en Windows,
// cuando el SO/antivirus todavía tiene el archivo abierto un instante).
// Reintenta un par de veces con backoff antes de resignarse — un archivo
// temporal huérfano ocasional es un costo menor; tumbar el proceso entero
// por eso, no.
async function borrarArchivoSeguro(filePath, intentos = 3) {
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

// Multer guarda en /tmp primero — nunca directo a /public
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_TMP),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const MAX_IMAGEN_BYTES = 1 * 1024 * 1024; // 1MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGEN_BYTES },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPG, PNG o WebP.'));
    }
    cb(null, true);
  },
});

// Envuelve upload.single() para traducir errores de multer (tamaño, tipo) a
// una respuesta JSON clara en vez de dejarlos caer al handler de errores
// genérico ("Error interno del servidor."), que no dice nada útil al usuario.
function subirImagenMiddleware(req, res, next) {
  upload.single('imagen')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'La imagen supera el máximo permitido de 1MB.' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir la imagen.' });
  });
}

// ─── POST /api/productos/:id/imagenes ────────────────────────────────────────
async function subirImagen(req, res) {
  const tmpPath = req.file?.path;

  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;

    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    // Verificar que el producto pertenece al tenant
    const producto = await Producto.findOne({ where: { id, inquilino_id } });
    if (!producto) {
      await borrarArchivoSeguro(tmpPath);
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    // Procesar con sharp: max 1200px de ancho, JPEG 80% calidad.
    // Se lee a un buffer en vez de pasarle la ruta directamente a sharp:
    // en Windows, sharp/libvips puede tardar un instante en soltar el
    // handle del archivo leído por ruta, y el unlink() de abajo fallaba
    // con EBUSY en casi todas las subidas. Leyendo a memoria primero,
    // sharp nunca abre el temporal — el archivo pesa como mucho 1MB
    // (límite de subida), así que cargarlo entero no tiene costo real.
    const buffer = await fs.promises.readFile(tmpPath);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const finalPath = path.join(UPLOADS_PUBLIC, filename);

    await sharp(buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(finalPath);

    // Eliminar el temporal
    await borrarArchivoSeguro(tmpPath);

    // Calcular el orden (máximo actual + 1)
    const maxOrden = await ProductoImagen.max('orden', { where: { producto_id: id } }) || 0;
    const esPrincipal = req.body.es_principal === 'true' || req.body.es_principal === true;
    const variante_id = req.body.variante_id ? parseInt(req.body.variante_id) : null;

    // Si se marca como principal, desmarcar las demás
    if (esPrincipal) {
      await ProductoImagen.update({ es_principal: false }, { where: { producto_id: id } });
    }

    const imagen = await ProductoImagen.create({
      inquilino_id,
      producto_id: id,
      variante_id,
      url: `/uploads/${filename}`,
      es_principal: esPrincipal,
      orden: maxOrden + 1,
    });

    return res.status(201).json(imagen);
  } catch (err) {
    // Loguear el error real ANTES de intentar limpiar — si la limpieza también
    // fallara, igual queda registrado qué fue lo que rompió originalmente.
    console.error(err);
    await borrarArchivoSeguro(tmpPath);
    return res.status(500).json({ message: err.message || 'Error al procesar la imagen.' });
  }
}

// ─── PUT /api/productos/:id/imagenes/:imgId ───────────────────────────────────
async function actualizarImagen(req, res) {
  try {
    const { id, imgId } = req.params;
    const inquilino_id = req.usuario.tenantId;
    const { orden, es_principal, variante_id } = req.body;

    const imagen = await ProductoImagen.findOne({ where: { id: imgId, producto_id: id, inquilino_id } });
    if (!imagen) return res.status(404).json({ message: 'Imagen no encontrada.' });

    if (es_principal === true || es_principal === 'true') {
      await ProductoImagen.update({ es_principal: false }, { where: { producto_id: id } });
      imagen.es_principal = true;
    }

    if (orden !== undefined) imagen.orden = orden;
    if (variante_id !== undefined) imagen.variante_id = variante_id || null;

    await imagen.save();
    return res.json(imagen);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al actualizar imagen.' });
  }
}

// ─── DELETE /api/productos/:id/imagenes/:imgId ───────────────────────────────
async function eliminarImagen(req, res) {
  try {
    const { id, imgId } = req.params;
    const inquilino_id = req.usuario.tenantId;

    const imagen = await ProductoImagen.findOne({ where: { id: imgId, producto_id: id, inquilino_id } });
    if (!imagen) return res.status(404).json({ message: 'Imagen no encontrada.' });

    // Eliminar archivo físico
    const filePath = path.join(process.cwd(), 'public', imagen.url);
    await borrarArchivoSeguro(filePath);

    await imagen.destroy();
    return res.json({ message: 'Imagen eliminada.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al eliminar imagen.' });
  }
}

module.exports = { upload, subirImagenMiddleware, subirImagen, actualizarImagen, eliminarImagen };
