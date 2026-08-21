'use strict';

/**
 * Controller de Reportes de Meta Ads — campañas internas + importación de
 * CSV exportado desde Meta Ads Manager. Ver src/routes/metaReportes.js
 * para el listado completo de endpoints.
 *
 * A diferencia de routes/meta.js (OAuth + Graph API en vivo), este módulo
 * sigue el patrón por capas del repo (routes -> controller -> service)
 * desde el día uno.
 */

const multer = require('multer');
const MetaReportesService = require('../services/metaReportes.service');

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5MB — de sobra para un export de Ads Manager

const uploadCSV = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES },
  fileFilter: (req, file, cb) => {
    const nombreOk = /\.csv$/i.test(file.originalname);
    const tipoOk = ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype);
    if (!nombreOk && !tipoOk) return cb(new Error('Solo se aceptan archivos .csv'));
    cb(null, true);
  },
});

function subirCSVMiddleware(req, res, next) {
  uploadCSV.single('archivo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'El archivo supera el máximo permitido de 5MB.' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir el archivo.' });
  });
}

function manejarError(res, err, defaultMsg) {
  console.error('[meta-reportes]', err.message);
  const status = err.message.includes('no encontrad') ? 404 : 400;
  return res.status(status).json({ message: err.message || defaultMsg });
}

// ---- Campañas internas ----

async function crearCampana(req, res) {
  try {
    const campana = await MetaReportesService.crearCampana(req.usuario.tenantId, req.usuario.id, req.body);
    return res.status(201).json(campana);
  } catch (err) {
    return manejarError(res, err, 'Error al crear la campaña.');
  }
}

async function listarCampanas(req, res) {
  try {
    const campanas = await MetaReportesService.listarCampanas(req.usuario.tenantId, req.query);
    return res.json(campanas);
  } catch (err) {
    console.error('[meta-reportes] listarCampanas:', err.message);
    return res.status(500).json({ message: 'Error al listar campañas.' });
  }
}

async function actualizarCampana(req, res) {
  try {
    const campana = await MetaReportesService.actualizarCampana(req.params.id, req.usuario.tenantId, req.body);
    return res.json(campana);
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar la campaña.');
  }
}

async function eliminarCampana(req, res) {
  try {
    await MetaReportesService.eliminarCampana(req.params.id, req.usuario.tenantId);
    return res.json({ message: 'Campaña eliminada.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar la campaña.');
  }
}

// ---- Importación de reportes ----

async function importarCSV(req, res) {
  try {
    if (!req.file) return res.status(400).json({ message: 'Subí un archivo .csv.' });

    const resultado = await MetaReportesService.importarCSV(req.file.buffer, {
      inquilino_id: req.usuario.tenantId,
      usuario_id: req.usuario.id,
      meta_integration_id: req.body.meta_integration_id || null,
      nombre_archivo: req.file.originalname,
    });

    return res.status(201).json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al importar el reporte.');
  }
}

async function listarImportaciones(req, res) {
  try {
    const importaciones = await MetaReportesService.listarImportaciones(req.usuario.tenantId);
    return res.json(importaciones);
  } catch (err) {
    console.error('[meta-reportes] listarImportaciones:', err.message);
    return res.status(500).json({ message: 'Error al listar importaciones.' });
  }
}

async function eliminarImportacion(req, res) {
  try {
    await MetaReportesService.eliminarImportacion(req.params.id, req.usuario.tenantId);
    return res.json({ message: 'Importación eliminada.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar la importación.');
  }
}

// ---- Filas / métricas ----

async function listarFilas(req, res) {
  try {
    const resultado = await MetaReportesService.listarFilas(req.usuario.tenantId, req.query);
    return res.json(resultado);
  } catch (err) {
    console.error('[meta-reportes] listarFilas:', err.message);
    return res.status(500).json({ message: 'Error al listar filas de reporte.' });
  }
}

async function vincularFila(req, res) {
  try {
    const fila = await MetaReportesService.vincularFilaManual(req.params.id, req.usuario.tenantId, req.body.meta_campana_interna_id);
    return res.json(fila);
  } catch (err) {
    return manejarError(res, err, 'Error al vincular la fila.');
  }
}

async function metricasPorProducto(req, res) {
  try {
    const metricas = await MetaReportesService.metricasPorProducto(req.usuario.tenantId, req.usuario.id, req.query);
    return res.json(metricas);
  } catch (err) {
    return manejarError(res, err, 'Error al calcular métricas por producto.');
  }
}

module.exports = {
  subirCSVMiddleware,
  crearCampana,
  listarCampanas,
  actualizarCampana,
  eliminarCampana,
  importarCSV,
  listarImportaciones,
  eliminarImportacion,
  listarFilas,
  vincularFila,
  metricasPorProducto,
};
