'use strict';

/**
 * Generadores de archivo (Excel/PDF) para el reporte financiero de Costos
 * y Gastos. Reciben los datos ya calculados por
 * CostoGastoService.datosReporteFinanciero() — no consultan la base
 * directamente, así el mismo dato alimenta pantalla, Excel y PDF.
 */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const TIPO_LABEL = { costo: 'Costo', gasto: 'Gasto' };
const ESTADO_GASTO_LABEL = { pendiente: 'Pendiente', pagado: 'Pagado', cancelado: 'Cancelado' };

function gs(valor) {
  const n = Number(valor) || 0;
  return `Gs. ${Math.round(n).toLocaleString('es-PY')}`;
}

function formatFecha(f) {
  if (!f) return '—';
  const [y, m, d] = String(f).slice(0, 10).split('-');
  if (!y || !m || !d) return String(f);
  return `${d}/${m}/${y}`;
}

function tituloRango(fecha_desde, fecha_hasta) {
  if (!fecha_desde || !fecha_hasta) return 'Todo el historial';
  if (fecha_desde === fecha_hasta) return formatFecha(fecha_desde);
  return `${formatFecha(fecha_desde)} — ${formatFecha(fecha_hasta)}`;
}

async function generarExcelReporteFinanciero({ resumen, gastos, ingresos }, rango) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gesicomm';
  workbook.created = new Date();

  // --- Hoja 1: Resumen ---
  const hojaResumen = workbook.addWorksheet('Resumen');
  hojaResumen.columns = [{ width: 28 }, { width: 24 }];
  hojaResumen.addRow(['Reporte financiero', tituloRango(rango.fecha_desde, rango.fecha_hasta)]).font = { bold: true, size: 14 };
  hojaResumen.addRow([]);
  const filasResumen = [
    ['Ganaste (ingresos del período)', gs(resumen.ingresos)],
    ['Gastaste (costos + gastos del período)', gs(resumen.total_egresos)],
    ['  · Costos', gs(resumen.costos_periodo)],
    ['  · Gastos', gs(resumen.gastos_periodo)],
    ['Te queda disponible (ganancia neta aprox.)', gs(resumen.resultado)],
    ['Margen', `${resumen.margen}%`],
  ];
  filasResumen.forEach(fila => hojaResumen.addRow(fila));
  hojaResumen.getRow(3).font = { bold: true };
  hojaResumen.getRow(3).getCell(2).font = { bold: true, color: { argb: 'FF16A34A' } };
  hojaResumen.getRow(4).font = { bold: true };
  hojaResumen.getRow(4).getCell(2).font = { bold: true, color: { argb: 'FFDC2626' } };
  hojaResumen.getRow(7).font = { bold: true };
  hojaResumen.addRow([]);
  hojaResumen.addRow(['Nota', 'Los ingresos solo cuentan pedidos ya Entregados (plata que realmente entró). La ganancia neta es aproximada: no descuenta comisión de pago, IVA ni logística.']).getCell(2).alignment = { wrapText: true };

  // --- Hoja 2: Gastos y costos ---
  const hojaGastos = workbook.addWorksheet('Gastos y costos');
  hojaGastos.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Concepto', key: 'concepto', width: 32 },
    { header: 'Categoría', key: 'categoria', width: 20 },
    { header: 'Proveedor', key: 'proveedor', width: 20 },
    { header: 'Estado', key: 'estado', width: 12 },
    { header: 'Importe (Gs)', key: 'importe', width: 16 },
  ];
  hojaGastos.getRow(1).font = { bold: true };
  gastos.forEach(g => {
    hojaGastos.addRow({
      fecha: formatFecha(g.fecha),
      tipo: TIPO_LABEL[g.tipo] || g.tipo,
      concepto: g.concepto,
      categoria: g.categoria?.nombre || '—',
      proveedor: g.proveedor?.nombre || '—',
      estado: ESTADO_GASTO_LABEL[g.estado] || g.estado,
      importe: Math.round(Number(g.importe) || 0),
    });
  });
  hojaGastos.getColumn('importe').numFmt = '#,##0';
  if (gastos.length > 0) {
    hojaGastos.addRow({});
    const filaTotal = hojaGastos.addRow({ concepto: 'TOTAL', importe: Math.round(resumen.total_egresos) });
    filaTotal.font = { bold: true };
    hojaGastos.getColumn('importe').numFmt = '#,##0';
  }

  // --- Hoja 3: Ingresos (ventas) ---
  const hojaIngresos = workbook.addWorksheet('Ingresos');
  hojaIngresos.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Cliente', key: 'cliente', width: 28 },
    { header: 'Estado', key: 'estado', width: 16 },
    { header: 'Monto (Gs)', key: 'monto', width: 16 },
  ];
  hojaIngresos.getRow(1).font = { bold: true };
  ingresos.forEach(v => {
    hojaIngresos.addRow({
      fecha: formatFecha(v.fecha),
      cliente: v.cliente,
      estado: v.estado,
      monto: Math.round(Number(v.monto) || 0),
    });
  });
  hojaIngresos.getColumn('monto').numFmt = '#,##0';
  if (ingresos.length > 0) {
    hojaIngresos.addRow({});
    const filaTotal = hojaIngresos.addRow({ cliente: 'TOTAL', monto: Math.round(resumen.ingresos) });
    filaTotal.font = { bold: true };
    hojaIngresos.getColumn('monto').numFmt = '#,##0';
  }

  return workbook.xlsx.writeBuffer();
}

/** Dibuja una tabla simple en pdfkit: encabezado + filas, con paginación
 * automática cuando se acaba el alto de página (pdfkit no trae tablas). */
function dibujarTabla(doc, { columnas, filas, startY }) {
  const margenIzq = doc.page.margins.left;
  const anchoUtil = doc.page.width - margenIzq - doc.page.margins.right;
  const altoFila = 18;
  const altoPagina = doc.page.height - doc.page.margins.bottom;

  const anchos = columnas.map(c => c.width * anchoUtil);

  function dibujarEncabezado(y) {
    doc.font('Helvetica-Bold').fontSize(8.5);
    let x = margenIzq;
    columnas.forEach((c, i) => {
      doc.text(c.header, x, y, { width: anchos[i], align: c.align || 'left' });
      x += anchos[i];
    });
    doc.moveTo(margenIzq, y + 13).lineTo(margenIzq + anchoUtil, y + 13).strokeColor('#cccccc').stroke();
    return y + 16;
  }

  let y = dibujarEncabezado(startY);
  doc.font('Helvetica').fontSize(8.5);

  filas.forEach(fila => {
    if (y + altoFila > altoPagina) {
      doc.addPage();
      y = dibujarEncabezado(doc.page.margins.top);
      doc.font('Helvetica').fontSize(8.5);
    }
    let x = margenIzq;
    columnas.forEach((c, i) => {
      doc.text(String(fila[c.key] ?? ''), x, y, { width: anchos[i], align: c.align || 'left' });
      x += anchos[i];
    });
    y += altoFila;
  });

  return y;
}

function generarPdfReporteFinanciero({ resumen, gastos, ingresos }, rango) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).text('Reporte financiero', { align: 'left' });
    doc.font('Helvetica').fontSize(10).fillColor('#555555').text(tituloRango(rango.fecha_desde, rango.fecha_hasta));
    doc.fillColor('#000000');
    doc.moveDown(1);

    // Resumen
    doc.font('Helvetica-Bold').fontSize(11).text('Resumen del período');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Ganaste (ingresos):  ${gs(resumen.ingresos)}`);
    doc.text(`Gastaste (costos + gastos):  ${gs(resumen.total_egresos)}   ·   Costos: ${gs(resumen.costos_periodo)}   ·   Gastos: ${gs(resumen.gastos_periodo)}`);
    doc.font('Helvetica-Bold');
    doc.fillColor(resumen.resultado >= 0 ? '#16A34A' : '#DC2626');
    doc.text(`${resumen.resultado >= 0 ? 'Te queda disponible' : 'Te falta'}:  ${gs(Math.abs(resumen.resultado))}  (margen ${resumen.margen}%)`);
    doc.fillColor('#000000').font('Helvetica').fontSize(8).fillColor('#777777');
    doc.text('Los ingresos solo cuentan pedidos ya Entregados. Ganancia aproximada: no descuenta comisión de pago, IVA ni logística.');
    doc.fillColor('#000000');
    doc.moveDown(1);

    // Gastos y costos
    doc.font('Helvetica-Bold').fontSize(11).text(`Gastos y costos del período (${gastos.length})`);
    doc.moveDown(0.3);
    let y = dibujarTabla(doc, {
      startY: doc.y,
      columnas: [
        { key: 'fecha', header: 'Fecha', width: 0.12 },
        { key: 'tipo', header: 'Tipo', width: 0.1 },
        { key: 'concepto', header: 'Concepto', width: 0.28 },
        { key: 'categoria', header: 'Categoría', width: 0.18 },
        { key: 'estado', header: 'Estado', width: 0.12 },
        { key: 'importe', header: 'Importe', width: 0.2, align: 'right' },
      ],
      filas: gastos.map(g => ({
        fecha: formatFecha(g.fecha),
        tipo: TIPO_LABEL[g.tipo] || g.tipo,
        concepto: g.concepto,
        categoria: g.categoria?.nombre || '—',
        estado: ESTADO_GASTO_LABEL[g.estado] || g.estado,
        importe: gs(g.importe),
      })),
    });
    doc.y = y + 6;
    doc.font('Helvetica-Bold').fontSize(9).text(`Total gastado: ${gs(resumen.total_egresos)}`, { align: 'right' });
    doc.moveDown(1);

    // Ingresos
    if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).text(`Ingresos del período (${ingresos.length})`);
    doc.moveDown(0.3);
    y = dibujarTabla(doc, {
      startY: doc.y,
      columnas: [
        { key: 'fecha', header: 'Fecha', width: 0.15 },
        { key: 'cliente', header: 'Cliente', width: 0.4 },
        { key: 'estado', header: 'Estado', width: 0.2 },
        { key: 'monto', header: 'Monto', width: 0.25, align: 'right' },
      ],
      filas: ingresos.map(v => ({
        fecha: formatFecha(v.fecha),
        cliente: v.cliente,
        estado: v.estado,
        monto: gs(v.monto),
      })),
    });
    doc.y = y + 6;
    doc.font('Helvetica-Bold').fontSize(9).text(`Total ganado: ${gs(resumen.ingresos)}`, { align: 'right' });

    doc.end();
  });
}

module.exports = { generarExcelReporteFinanciero, generarPdfReporteFinanciero };
