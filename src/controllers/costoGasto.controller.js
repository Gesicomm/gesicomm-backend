/**
 * Controller de Costos y Gastos.
 *
 * POST /api/costos-gastos/buscar
 * POST /api/costos-gastos
 * GET  /api/costos-gastos/resumen
 * GET  /api/costos-gastos/:id
 * PUT  /api/costos-gastos/:id
 * DELETE /api/costos-gastos/:id
 * POST /api/costos-gastos/:id/duplicar
 * PATCH /api/costos-gastos/:id/marcar-pagado
 * POST /api/costos-gastos/:id/comprobante
 */
const path = require('path');
const multer = require('multer');
const CostoGastoService = require('../services/costoGasto.service');
const ComprobanteService = require('../services/comprobante.service');

const UPLOADS_TMP = path.join(process.cwd(), 'tmp', 'uploads');
const MAX_COMPROBANTE_BYTES = 5 * 1024 * 1024; // 5MB (facturas escaneadas/PDF)

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_TMP),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_COMPROBANTE_BYTES },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes (JPG, PNG, WebP) o PDF.'));
    }
    cb(null, true);
  },
});

function subirComprobanteMiddleware(req, res, next) {
  upload.single('comprobante')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'El comprobante supera el máximo permitido de 5MB.' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir el comprobante.' });
  });
}

async function buscar(req, res) {
  try {
    const result = await CostoGastoService.buscar(req.body, req.usuario.id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener costos y gastos.' });
  }
}

async function resumen(req, res) {
  try {
    const result = await CostoGastoService.resumen(req.query, req.usuario.id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al calcular el resumen.' });
  }
}

async function reporteDesglose(req, res) {
  try {
    const result = await CostoGastoService.reporteDesglose(req.body || {}, req.usuario.id);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al calcular el reporte de rentabilidad.' });
  }
}

async function crear(req, res) {
  try {
    const registro = await CostoGastoService.crear(req.body, req.usuario.id);
    return res.status(201).json(registro);
  } catch (err) {
    console.error(err);
    const status = /requerid|inválid|mayor a 0/.test(err.message) ? 400 : 500;
    return res.status(status).json({ message: err.message || 'Error al crear el registro.' });
  }
}

async function detalle(req, res) {
  try {
    const registro = await CostoGastoService.detalle(req.params.id, req.usuario.id);
    return res.json(registro);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al obtener el registro.' });
  }
}

async function actualizar(req, res) {
  try {
    const registro = await CostoGastoService.actualizar(req.params.id, req.body, req.usuario.id);
    return res.json(registro);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al actualizar el registro.' });
  }
}

async function eliminar(req, res) {
  try {
    await CostoGastoService.eliminar(req.params.id, req.usuario.id);
    return res.json({ message: 'Costo/gasto eliminado correctamente.' });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al eliminar el registro.' });
  }
}

async function duplicar(req, res) {
  try {
    const registro = await CostoGastoService.duplicar(req.params.id, req.usuario.id);
    return res.status(201).json(registro);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al duplicar el registro.' });
  }
}

async function marcarPagado(req, res) {
  try {
    const registro = await CostoGastoService.marcarPagado(req.params.id, req.body, req.usuario.id);
    return res.json(registro);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al marcar como pagado.' });
  }
}

async function subirComprobante(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se recibió ningún archivo.' });

    // Confirmamos que el registro exista y sea del usuario ANTES de guardar
    // el archivo definitivo (mismo patrón que imagen.controller.js).
    try {
      await CostoGastoService.detalle(req.params.id, req.usuario.id);
    } catch (e) {
      await ComprobanteService.borrarArchivoSeguro(req.file.path);
      return res.status(404).json({ message: 'Costo/gasto no encontrado.' });
    }

    const url = await ComprobanteService.guardarArchivo(req.file);
    const registro = await CostoGastoService.guardarComprobante(req.params.id, req.usuario.id, url, req.file.originalname);
    return res.status(201).json(registro);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'Error al procesar el comprobante.' });
  }
}

module.exports = {
  buscar, resumen, reporteDesglose, crear, detalle, actualizar, eliminar, duplicar, marcarPagado,
  subirComprobanteMiddleware, subirComprobante,
};
