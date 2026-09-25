'use strict';

/**
 * Excel de precios de "Mi catálogo".
 *
 * GET  /api/vitrina/precios/exportar  → .xlsx con todo el catálogo visible
 * POST /api/vitrina/precios/importar  → multipart `archivo` (+ `aplicar=true`
 *                                       para escribir; sin eso es vista previa)
 */

const multer = require('multer');
const PrecioUsuarioExcelService = require('../services/precioUsuarioExcel.service');

const MAX_XLSX_BYTES = 15 * 1024 * 1024; // un export de ~10.000 ítems pesa ~1MB

const uploadXlsx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_XLSX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new Error('Solo se aceptan archivos Excel .xlsx.'));
    cb(null, true);
  },
});

function subirXlsxMiddleware(req, res, next) {
  uploadXlsx.single('archivo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'El archivo supera el máximo permitido de 15MB.' });
    }
    return res.status(400).json({ message: err.message || 'Error al subir el archivo.' });
  });
}

async function exportar(req, res) {
  let filas;
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    filas = await PrecioUsuarioExcelService.listarFilas(req.usuario.id, req.usuario.tenantId, esAdmin);
  } catch (err) {
    console.error('[vitrina] exportarPrecios:', err.message);
    return res.status(500).json({ message: 'No se pudo generar el Excel.' });
  }

  const fecha = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="mi-catalogo-precios_${fecha}.xlsx"`);
  try {
    await PrecioUsuarioExcelService.escribirExcel(filas, res);
  } catch (err) {
    // Los headers ya salieron: no queda otra que cortar la conexión para
    // que el navegador no guarde un .xlsx truncado como si estuviera bien.
    console.error('[vitrina] exportarPrecios (stream):', err.message);
    res.destroy(err);
  }
}

async function importar(req, res) {
  if (!req.file) return res.status(400).json({ message: 'Adjuntá el archivo Excel.' });
  try {
    const esAdmin = req.usuario.rol === 'administrador';
    const aplicar = req.body.aplicar === 'true' || req.body.aplicar === true;
    const resultado = await PrecioUsuarioExcelService.importar(
      req.usuario.id, req.usuario.tenantId, esAdmin, req.file.buffer, { aplicar },
    );
    return res.json(resultado);
  } catch (err) {
    console.error('[vitrina] importarPrecios:', err.message);
    return res.status(400).json({ message: err.message || 'No se pudo procesar el archivo.' });
  }
}

module.exports = { subirXlsxMiddleware, exportar, importar };
