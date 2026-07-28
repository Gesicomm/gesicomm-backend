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

// Multer guarda en /tmp primero — nunca directo a /public
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_TMP),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes JPG, PNG o WebP.'));
    }
    cb(null, true);
  },
});

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
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }

    // Procesar con sharp: max 1200px de ancho, JPEG 80% calidad
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const finalPath = path.join(UPLOADS_PUBLIC, filename);

    await sharp(tmpPath)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(finalPath);

    // Eliminar el temporal
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

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
    // Limpiar temp en cualquier error
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    console.error(err);
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
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await imagen.destroy();
    return res.json({ message: 'Imagen eliminada.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al eliminar imagen.' });
  }
}

module.exports = { upload, subirImagen, actualizarImagen, eliminarImagen };
