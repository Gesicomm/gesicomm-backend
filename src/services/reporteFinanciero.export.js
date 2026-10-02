'use strict';

/**
 * Generadores de archivo (Excel/PDF) para el reporte de Control financiero.
 * Reciben los datos ya calculados por
 * CostoGastoService.datosReporteFinanciero() — no consultan la base
 * directamente, así el mismo dato alimenta pantalla, Excel y PDF.
 */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { METRIC_TERMS } = require('../utils/metricGlossary');

const TIPO_LABEL = { ingreso: 'Ingreso', costo: 'Costo', gasto: 'Gasto' };
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

function pct(valor) {
  return `${Number(valor || 0).toLocaleString('es-PY')}%`;
}

async function generarExcelReporteFinanciero({ resumen, gastos, ingresos, reporte_visual }, rango) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gesicomm';
  workbook.created = new Date();

  // --- Hoja 1: Resumen ---
  const hojaResumen = workbook.addWorksheet('Resumen');
  hojaResumen.columns = [{ width: 28 }, { width: 24 }];
  hojaResumen.addRow(['Reporte visual de flujo de caja', tituloRango(rango.fecha_desde, rango.fecha_hasta)]).font = { bold: true, size: 14 };
  hojaResumen.addRow([]);

  const rv = reporte_visual;
  const filasResumen = rv ? [
    [METRIC_TERMS.ventasNetas, gs(rv.indicadores.ventas)],
    [METRIC_TERMS.utilidadNeta, gs(rv.indicadores.utilidad_neta)],
    [METRIC_TERMS.margen, pct(rv.indicadores.margen_neto)],
    [METRIC_TERMS.flujoCajaNeto, gs(rv.indicadores.flujo_caja_neto)],
    ['ROI', pct(rv.indicadores.roi)],
    [METRIC_TERMS.cajaDisponible, gs(rv.indicadores.caja_disponible)],
  ] : [
    [METRIC_TERMS.ventasNetas, gs(resumen.ingresos)],
    ['Egresos del período', gs(resumen.total_egresos)],
    ['  · Costos', gs(resumen.costos_periodo)],
    ['  · Gastos', gs(resumen.gastos_periodo)],
    [`Te queda disponible (${METRIC_TERMS.utilidadNeta})`, gs(resumen.resultado)],
    [METRIC_TERMS.margen, `${resumen.margen}%`],
  ];
  filasResumen.forEach(fila => hojaResumen.addRow(fila));
  hojaResumen.getRow(3).font = { bold: true };
  hojaResumen.getRow(3).getCell(2).font = { bold: true, color: { argb: 'FF16A34A' } };
  hojaResumen.getRow(4).font = { bold: true };
  hojaResumen.getRow(4).getCell(2).font = { bold: true, color: { argb: 'FFDC2626' } };
  hojaResumen.getRow(7).font = { bold: true };
  hojaResumen.addRow([]);
  hojaResumen.addRow(['Nota', rv?.flujo_caja?.nota || 'Los ingresos solo cuentan pedidos ya Entregados.']).getCell(2).alignment = { wrapText: true };

  if (rv) {
    const hojaFlujo = workbook.addWorksheet('Flujo de caja');
    hojaFlujo.columns = [{ width: 34 }, { width: 18 }, { width: 34 }, { width: 18 }];
    hojaFlujo.addRow(['INGRESOS', '', 'GASTOS', '']).font = { bold: true, size: 13 };
    [
      [METRIC_TERMS.ventasNetas, rv.ingresos.ventas_totales, METRIC_TERMS.costosVariables, rv.gastos.total_costos_variables],
      ['Ventas Web', rv.ingresos.ventas_web, 'Gastos fijos', rv.gastos.total_gastos_fijos],
      ['Ventas WhatsApp', rv.ingresos.ventas_whatsapp, 'Gastos totales', rv.gastos.gastos_totales],
      ['Ventas orgánicas', rv.ingresos.ventas_organicas, 'Margen de contribución', rv.resultado_operativo.margen_contribucion],
      ['Otros ingresos registrados', rv.ingresos.otros_ingresos, METRIC_TERMS.utilidadNeta, rv.resultado_operativo.utilidad_operativa],
      ['Reembolsos/devoluciones (-)', rv.ingresos.devoluciones, METRIC_TERMS.margen, `${rv.resultado_operativo.margen_neto}%`],
      [METRIC_TERMS.ventasNetas.toUpperCase(), rv.ingresos.ingresos_netos, '', ''],
    ].forEach(row => hojaFlujo.addRow([row[0], row[1], row[2], row[3]]));

    hojaFlujo.addRow([]);
    hojaFlujo.addRow(['FLUJO DE DINERO', '']);
    hojaFlujo.addRow(['Saldo inicial de caja', rv.flujo_caja.saldo_inicial_caja]);
    hojaFlujo.addRow(['Cobros reales de dinero', rv.flujo_caja.entradas_reales]);
    hojaFlujo.addRow(['Salidas reales de dinero', rv.flujo_caja.salidas_reales]);
    hojaFlujo.addRow(['SALDO FINAL DE CAJA', rv.flujo_caja.saldo_final_caja]).font = { bold: true };
    hojaFlujo.addRow([]);
    hojaFlujo.addRow(['ACTIVOS', '', 'PASIVOS', '']).font = { bold: true, size: 13 };
    const max = Math.max(rv.activos.items.length, rv.pasivos.items.length);
    for (let i = 0; i < max; i++) {
      hojaFlujo.addRow([
        rv.activos.items[i]?.label || '',
        rv.activos.items[i]?.valor ?? '',
        rv.pasivos.items[i]?.label || '',
        rv.pasivos.items[i]?.valor ?? '',
      ]);
    }
    hojaFlujo.addRow(['TOTAL ACTIVOS', rv.activos.total, 'TOTAL PASIVOS', rv.pasivos.total]).font = { bold: true };

    const hojaComparacion = workbook.addWorksheet('Comparación');
    hojaComparacion.columns = [{ width: 18 }, { width: 20 }, { width: 20 }, { width: 18 }];
    hojaComparacion.addRow(['Indicador', 'Período anterior', 'Período actual', 'Variación']).font = { bold: true };
    (rv.comparacion?.filas || []).forEach(f => {
      hojaComparacion.addRow([
        f.indicador,
        f.tipo === 'porcentaje' ? pct(f.anterior) : gs(f.anterior),
        f.tipo === 'porcentaje' ? pct(f.actual) : gs(f.actual),
        f.variacion === null ? 'Nuevo' : `${f.variacion > 0 ? '+' : ''}${f.variacion}${f.unidad_variacion === 'pp' ? ' pp' : '%'}`,
      ]);
    });
  }

  // --- Hoja 2: Movimientos financieros ---
  const hojaGastos = workbook.addWorksheet('Movimientos');
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
    const filaTotal = hojaGastos.addRow({ concepto: 'TOTAL EGRESOS', importe: Math.round(resumen.total_egresos) });
    filaTotal.font = { bold: true };
    hojaGastos.getColumn('importe').numFmt = '#,##0';
  }

  // --- Hoja 3: Ventas netas ---
  const hojaIngresos = workbook.addWorksheet('Ventas netas');
  hojaIngresos.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Cliente', key: 'cliente', width: 28 },
    { header: 'Estado', key: 'estado', width: 16 },
    { header: 'Ventas netas (Gs)', key: 'ventas_netas', width: 18 },
    { header: 'Cobro total (Gs)', key: 'cobro_total', width: 18 },
  ];
  hojaIngresos.getRow(1).font = { bold: true };
  ingresos.forEach(v => {
    hojaIngresos.addRow({
      fecha: formatFecha(v.fecha),
      cliente: v.cliente,
      estado: v.estado,
      ventas_netas: Math.round(Number(v.ventas_netas) || 0),
      cobro_total: Math.round(Number(v.cobro_total ?? v.monto) || 0),
    });
  });
  hojaIngresos.getColumn('ventas_netas').numFmt = '#,##0';
  hojaIngresos.getColumn('cobro_total').numFmt = '#,##0';
  if (ingresos.length > 0) {
    hojaIngresos.addRow({});
    const filaTotal = hojaIngresos.addRow({ cliente: 'TOTAL VENTAS NETAS', ventas_netas: Math.round(resumen.ventas_netas || 0) });
    filaTotal.font = { bold: true };
    hojaIngresos.getColumn('ventas_netas').numFmt = '#,##0';
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

function dibujarListaConceptos(doc, titulo, filas, x, y, width, totalLabel, totalValor) {
  const altura = Math.max(162, 58 + (filas.length * 16));
  doc.roundedRect(x, y, width, altura, 8).strokeColor('#D7DEE8').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0B1B3F').text(titulo, x + 12, y + 12, { width: width - 24 });
  let cursor = y + 34;
  doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
  filas.forEach(fila => {
    const valor = typeof fila.valor === 'string' ? fila.valor : gs(fila.valor);
    doc.text(fila.label, x + 12, cursor, { width: width - 98 });
    doc.text(valor, x + width - 96, cursor, { width: 84, align: 'right' });
    cursor += 16;
  });
  doc.moveTo(x + 12, y + altura - 30).lineTo(x + width - 12, y + altura - 30).strokeColor('#E2E8F0').stroke();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0B1B3F');
  doc.text(totalLabel, x + 12, y + altura - 22, { width: width - 98 });
  doc.text(gs(totalValor), x + width - 96, y + altura - 22, { width: 84, align: 'right' });
  return altura;
}

function generarPdfReporteFinanciero({ resumen, gastos, ingresos, reporte_visual }, rango) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rv = reporte_visual;

    doc.font('Helvetica-Bold').fontSize(18).text(rv ? 'Reporte visual de flujo de caja' : 'Reporte financiero', { align: 'left' });
    doc.font('Helvetica').fontSize(10).fillColor('#555555').text(tituloRango(rango.fecha_desde, rango.fecha_hasta));
    doc.fillColor('#000000');
    doc.moveDown(1);

    // Resumen
    if (rv) {
      const anchoTarjeta = 168;
      const yTarjetas = doc.y;
      [
        [METRIC_TERMS.ventasNetas, gs(rv.indicadores.ventas)],
        [METRIC_TERMS.utilidadNeta, gs(rv.indicadores.utilidad_neta)],
        [METRIC_TERMS.margen, pct(rv.indicadores.margen_neto)],
        [METRIC_TERMS.flujoCajaNeto, gs(rv.indicadores.flujo_caja_neto)],
        ['ROI', pct(rv.indicadores.roi)],
        [METRIC_TERMS.cajaDisponible, gs(rv.indicadores.caja_disponible)],
      ].forEach((card, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = doc.page.margins.left + col * (anchoTarjeta + 14);
        const y = yTarjetas + row * 54;
        doc.roundedRect(x, y, anchoTarjeta, 42, 8).strokeColor('#D7DEE8').stroke();
        doc.font('Helvetica').fontSize(8).fillColor('#64748B').text(card[0], x + 10, y + 8, { width: anchoTarjeta - 20 });
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0B1B3F').text(card[1], x + 10, y + 22, { width: anchoTarjeta - 20 });
      });
      doc.y = yTarjetas + 116;

      const margenIzq = doc.page.margins.left;
      const gap = 16;
      const ancho = (doc.page.width - doc.page.margins.left - doc.page.margins.right - gap) / 2;
      const yBloques = doc.y;
      const altoIngresos = dibujarListaConceptos(doc, 'INGRESOS', [
        { label: METRIC_TERMS.ventasNetas, valor: rv.ingresos.ventas_totales },
        { label: 'Ventas Web', valor: rv.ingresos.ventas_web },
        { label: 'Ventas WhatsApp', valor: rv.ingresos.ventas_whatsapp },
        { label: 'Ventas orgánicas', valor: rv.ingresos.ventas_organicas },
        { label: 'Otros ingresos registrados', valor: rv.ingresos.otros_ingresos },
        { label: 'Reembolsos/devoluciones (-)', valor: rv.ingresos.devoluciones },
      ], margenIzq, yBloques, ancho, METRIC_TERMS.ventasNetas.toUpperCase(), rv.ingresos.ingresos_netos);
      const altoGastos = dibujarListaConceptos(
        doc,
        'GASTOS',
        [...rv.gastos.costos_variables, ...rv.gastos.gastos_fijos],
        margenIzq + ancho + gap,
        yBloques,
        ancho,
        'GASTOS TOTALES',
        rv.gastos.gastos_totales
      );
      doc.y = yBloques + Math.max(altoIngresos, altoGastos) + 24;

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0B1B3F').text('FLUJO DE DINERO', { align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#334155')
        .text(`Saldo inicial ${gs(rv.flujo_caja.saldo_inicial_caja)}  +  Cobros ${gs(rv.flujo_caja.entradas_reales)}  -  Salidas ${gs(rv.flujo_caja.salidas_reales)}  =  ${gs(rv.flujo_caja.saldo_final_caja)}`, { align: 'center' });
      doc.moveDown(0.8);

      const yBalance = doc.y;
      const altoActivos = dibujarListaConceptos(doc, 'ACTIVOS', rv.activos.items, margenIzq, yBalance, ancho, 'TOTAL ACTIVOS', rv.activos.total);
      const altoPasivos = dibujarListaConceptos(doc, 'PASIVOS', rv.pasivos.items, margenIzq + ancho + gap, yBalance, ancho, 'TOTAL PASIVOS', rv.pasivos.total);
      doc.y = yBalance + Math.max(altoActivos, altoPasivos) + 16;

      if (rv.comparacion?.filas?.length) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 130) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0B1B3F').text('Comparación con período anterior');
        doc.moveDown(0.3);
        dibujarTabla(doc, {
          startY: doc.y,
          columnas: [
            { key: 'indicador', header: 'Indicador', width: 0.24 },
            { key: 'anterior', header: 'Anterior', width: 0.25, align: 'right' },
            { key: 'actual', header: 'Actual', width: 0.25, align: 'right' },
            { key: 'variacion', header: 'Variación', width: 0.26, align: 'right' },
          ],
          filas: rv.comparacion.filas.map(f => ({
            indicador: f.indicador,
            anterior: f.tipo === 'porcentaje' ? pct(f.anterior) : gs(f.anterior),
            actual: f.tipo === 'porcentaje' ? pct(f.actual) : gs(f.actual),
            variacion: f.variacion === null ? 'Nuevo' : `${f.variacion > 0 ? '+' : ''}${f.variacion}${f.unidad_variacion === 'pp' ? ' pp' : '%'}`,
          })),
        });
      }

      doc.addPage();
    } else {
      doc.font('Helvetica-Bold').fontSize(11).text('Resumen del período');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
      doc.text(`${METRIC_TERMS.ventasNetas}:  ${gs(resumen.ingresos)}`);
      doc.text(`Egresos:  ${gs(resumen.total_egresos)}   ·   Costos: ${gs(resumen.costos_periodo)}   ·   Gastos: ${gs(resumen.gastos_periodo)}`);
      doc.font('Helvetica-Bold');
      doc.fillColor(resumen.resultado >= 0 ? '#16A34A' : '#DC2626');
      doc.text(`${resumen.resultado >= 0 ? 'Te queda disponible' : 'Te falta'}:  ${gs(Math.abs(resumen.resultado))}  (margen ${resumen.margen}%)`);
      doc.fillColor('#000000').font('Helvetica').fontSize(8).fillColor('#777777');
      doc.text('Los ingresos solo cuentan pedidos ya Entregados. Ganancia aproximada: no descuenta comisión de pago, IVA ni logística.');
      doc.fillColor('#000000');
      doc.moveDown(1);
    }

    // Movimientos financieros
    doc.font('Helvetica-Bold').fontSize(11).text(`Movimientos financieros del período (${gastos.length})`);
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
    doc.font('Helvetica-Bold').fontSize(9).text(`Total egresos: ${gs(resumen.total_egresos)}`, { align: 'right' });
    doc.moveDown(1);

    // Ventas netas
    if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).text(`Ventas netas del período (${ingresos.length})`);
    doc.moveDown(0.3);
    y = dibujarTabla(doc, {
      startY: doc.y,
      columnas: [
        { key: 'fecha', header: 'Fecha', width: 0.14 },
        { key: 'cliente', header: 'Cliente', width: 0.34 },
        { key: 'estado', header: 'Estado', width: 0.16 },
        { key: 'ventas_netas', header: 'Ventas netas', width: 0.18, align: 'right' },
        { key: 'cobro_total', header: 'Cobro total', width: 0.18, align: 'right' },
      ],
      filas: ingresos.map(v => ({
        fecha: formatFecha(v.fecha),
        cliente: v.cliente,
        estado: v.estado,
        ventas_netas: gs(v.ventas_netas),
        cobro_total: gs(v.cobro_total ?? v.monto),
      })),
    });
    doc.y = y + 6;
    doc.font('Helvetica-Bold').fontSize(9).text(`Total ventas netas: ${gs(resumen.ventas_netas || 0)}`, { align: 'right' });

    doc.end();
  });
}

module.exports = { generarExcelReporteFinanciero, generarPdfReporteFinanciero };
