'use strict';
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
// Arma el ZIP del expediente (resumen.pdf + solicitud.json + adjuntos) y lo envia.
async function enviarExpediente(res, { snapshot, archivos }) {
  const pdf = new PDFDocument({ margin: 45, size: 'A4' });
  const parts = [];
  const completed = new Promise((resolve, reject) => { pdf.on('data', chunk => parts.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(parts))); pdf.on('error', reject); });
  pdf.fontSize(18).text(`Solicitud Raha #${snapshot.id}`).moveDown();
  pdf.fontSize(11).text(`Estado: ${snapshot.estado}`).text(`Presentada: ${snapshot.enviado_at}`).moveDown();
  for (const [key, value] of Object.entries(snapshot.datos)) pdf.text(`${key.replace(/_/g, ' ')}: ${value}`).moveDown(0.4);
  pdf.moveDown().text('Autorizacion de revision y envio a Raha registrada por el solicitante.');
  pdf.end();
  const resumen = await completed;
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('error', error => res.destroy(error));
  res.attachment(`raha-solicitud-${snapshot.id}.zip`).type('application/zip');
  zip.pipe(res);
  zip.append(resumen, { name: 'resumen.pdf' });
  zip.append(JSON.stringify(snapshot, null, 2), { name: 'solicitud.json' });
  for (const archivo of archivos) zip.append(archivo.buffer, { name: archivo.nombre });
  await zip.finalize();
}
module.exports = { enviarExpediente };
