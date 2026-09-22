/**
 * Controller de movimientos financieros.
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
const ImagenService = require('../services/imagen.service');
const { generarExcelReporteFinanciero, generarPdfReporteFinanciero } = require('../services/reporteFinanciero.export');

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
    return res.status(500).json({ message: 'Error al obtener movimientos financieros.' });
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

async function reporteFlujoCaja(req, res) {
  try {
    const result = await CostoGastoService.reporteVisualFlujoCaja(req.query, req.usuario.id, req.usuario.tenantId);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al calcular el reporte visual de flujo de caja.' });
  }
}

async function exportarExcel(req, res) {
  try {
    const datos = await CostoGastoService.datosReporteFinanciero(req.query, req.usuario.id);
    datos.reporte_visual = await CostoGastoService.reporteVisualFlujoCaja(req.query, req.usuario.id, req.usuario.tenantId);
    const buffer = await generarExcelReporteFinanciero(datos, req.query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-financiero_${req.query.fecha_desde || 'inicio'}_${req.query.fecha_hasta || 'hoy'}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al generar el Excel del reporte financiero.' });
  }
}

async function exportarPdf(req, res) {
  try {
    const datos = await CostoGastoService.datosReporteFinanciero(req.query, req.usuario.id);
    datos.reporte_visual = await CostoGastoService.reporteVisualFlujoCaja(req.query, req.usuario.id, req.usuario.tenantId);
    const buffer = await generarPdfReporteFinanciero(datos, req.query);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-financiero_${req.query.fecha_desde || 'inicio'}_${req.query.fecha_hasta || 'hoy'}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al generar el PDF del reporte financiero.' });
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
    return res.json({ message: 'Movimiento financiero eliminado correctamente.' });
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
    return res.status(status).json({ message: err.message || 'Error al actualizar el estado.' });
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
      await ImagenService.borrarArchivoSeguro(req.file.path);
      return res.status(404).json({ message: 'Movimiento financiero no encontrado.' });
    }

    const imagenData = await ComprobanteService.procesarComprobanteParaR2(req.file, req.params.id);
    const { registro, anterior } = await CostoGastoService.guardarComprobante(req.params.id, req.usuario.id, imagenData, req.file.originalname);
    // Reemplazar es subir el nuevo y borrar el viejo: si no, cada
    // reemplazo de comprobante deja un objeto huérfano en R2 para siempre.
    if (anterior) await ImagenService.eliminarObjetoStorage(anterior);
    return res.status(201).json(registro);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: err.message || 'Error al procesar el comprobante.' });
  }
}

module.exports = {
  buscar, resumen, reporteDesglose, reporteFlujoCaja, exportarExcel, exportarPdf, crear, detalle, actualizar, eliminar, duplicar, marcarPagado,
  subirComprobanteMiddleware, subirComprobante,
};
