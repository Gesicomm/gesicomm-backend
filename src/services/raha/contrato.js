'use strict';
// Contrato marco de Raha by SPEEDBOX, completado con los datos que el comercio ya
// cargó en la solicitud. El comercio lo imprime, lo firma y lo sube escaneado
// (tipo de documento 'contrato'): así no escribe dos veces lo mismo.
// La plantilla es el .docx que entregó Raha; los huecos se ubican por su texto.
// La fecha y el plan asignado quedan en blanco: la fecha se escribe al firmar y
// el plan lo define Raha.
const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

const PLANTILLA = path.join(__dirname, 'plantillas', 'contrato-marco.docx');

// Campos de la solicitud que el contrato usa, con el nombre que ve el comercio.
const CAMPOS_CONTRATO = {
  razon_social: 'Razón social', ruc: 'RUC', representante: 'Nombre del representante legal', cedula: 'Cédula del representante legal',
  direccion: 'Dirección', ciudad: 'Ciudad', email: 'Email', telefono: 'Teléfono', actividad_economica: 'Actividad económica',
  operaciones_mensuales: 'Volumen estimado de operaciones', banco: 'Banco', tipo_cuenta: 'Tipo de cuenta',
  numero_cuenta: 'Número de cuenta', titular_cuenta: 'Titular de la cuenta',
};

const escapar = valor => String(valor).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textoDe = xml => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');

// Escribe el valor en la corrida y le quita el resaltado amarillo de "completar".
function completarCorrida(corrida, valor) {
  return corrida.replace(/<w:highlight [^>]*\/>/g, '')
    .replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${escapar(valor)}</w:t>`);
}

// Reemplaza, en orden, cada corrida cuyo texto es exactamente un hueco de la lista.
function completarHuecos(parrafo, huecos) {
  const pendientes = [...huecos];
  const salida = parrafo.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, corrida => {
    if (pendientes.length && textoDe(corrida) === pendientes[0][0]) return completarCorrida(corrida, pendientes.shift()[1]);
    return corrida;
  });
  return { xml: salida, faltan: pendientes.length };
}

function valores(d) {
  const domicilio = [d.direccion, d.ciudad, d.departamento].filter(Boolean).join(', ');
  const moneda = d.moneda === 'USD' ? 'dólares' : 'guaraníes';
  return {
    encabezado: [
      ['[RAZÓN SOCIAL / NOMBRE DE EL CLIENTE]', d.razon_social], ['[____]', d.ruc], ['[ciudad y dirección]', domicilio],
      ['[nombre del representante legal]', d.representante], ['[____]', d.cedula],
    ],
    firma: [
      ['[Nombre / Razón social]', d.razon_social],
      ['[C.I. / RUC] — Representante legal', `RUC N.º ${d.ruc} — ${d.representante}, C.I. N.º ${d.cedula} — Representante legal`],
    ],
    // Tablas del Anexo I y II: el valor va en la celda vacía que sigue a la etiqueta.
    celdas: {
      'Razón social / Nombre': d.razon_social, 'RUC / C.I.': d.ruc, 'Representante legal': `${d.representante} (C.I. N.º ${d.cedula})`,
      Domicilio: domicilio, 'Actividad económica': d.actividad_economica,
      'Volumen estimado de operaciones': `${d.operaciones_mensuales} pedidos por mes`, 'Correo electrónico': d.email, Teléfono: d.telefono,
      'Banco / entidad': d.banco, 'Tipo y N.º de cuenta': `${d.tipo_cuenta} en ${moneda} N.º ${d.numero_cuenta}`,
      'Titular (debe ser EL CLIENTE)': d.titular_cuenta,
    },
  };
}

function completarDocumento(xml, datos) {
  const v = valores(datos);
  let faltan = 0, celda = null;
  const celdasPendientes = new Set(Object.keys(v.celdas));
  const salida = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, parrafo => {
    const texto = textoDe(parrafo).trim();
    if (celda) {
      const etiqueta = celda; celda = null;
      if (!texto) {
        celdasPendientes.delete(etiqueta);
        const valor = v.celdas[etiqueta];
        if (/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/.test(parrafo)) {
          return parrafo.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/, corrida => completarCorrida(corrida, valor));
        }
        return parrafo.replace(/<\/w:p>$/, `<w:r><w:t xml:space="preserve">${escapar(valor)}</w:t></w:r></w:p>`);
      }
    }
    if (celdasPendientes.has(texto)) { celda = texto; return parrafo; }
    const huecos = texto.includes('[RAZÓN SOCIAL / NOMBRE DE EL CLIENTE]') ? v.encabezado
      : texto.includes('[Nombre / Razón social]') ? v.firma.slice(0, 1)
        : texto.includes('[C.I. / RUC]') ? v.firma.slice(1) : null;
    if (!huecos) return parrafo;
    const r = completarHuecos(parrafo, huecos);
    faltan += r.faltan;
    return r.xml;
  });
  // Si la plantilla cambió y algún hueco ya no aparece, mejor fallar que entregar
  // un contrato a medio completar.
  if (faltan || celdasPendientes.size || salida === xml) {
    throw Object.assign(new Error('La plantilla del contrato no coincide con los datos esperados. Avisá a soporte.'), { status: 500 });
  }
  return salida;
}

// La plantilla de Raha trae el logo del encabezado como 'media/<hash>.undefined',
// un PNG sin tipo declarado: Word la da por dañada. Se le pone la extensión real
// y se corrigen las referencias.
async function repararImagenes(zip) {
  const firmas = [['png', [0x89, 0x50, 0x4e, 0x47]], ['jpg', [0xff, 0xd8, 0xff]]];
  const tipos = await zip.file('[Content_Types].xml').async('string');
  const declaradas = new Set([...tipos.matchAll(/Extension="([^"]+)"/g)].map(m => m[1].toLowerCase()));
  const renombres = {};
  for (const nombre of Object.keys(zip.files).filter(n => /^word\/media\/[^/]+$/.test(n))) {
    const ext = nombre.split('.').pop().toLowerCase();
    if (declaradas.has(ext)) continue;
    const contenido = await zip.file(nombre).async('nodebuffer');
    const real = firmas.find(([, bytes]) => bytes.every((b, i) => contenido[i] === b))?.[0];
    if (!real) continue;
    const nuevo = nombre.replace(/\.[^./]+$/, '') + `.${real}`;
    zip.remove(nombre); zip.file(nuevo, contenido);
    renombres[nombre.slice('word/'.length)] = nuevo.slice('word/'.length);
  }
  if (!Object.keys(renombres).length) return;
  for (const rels of Object.keys(zip.files).filter(n => /^word\/_rels\/[^/]+\.rels$/.test(n))) {
    let xml = await zip.file(rels).async('string');
    for (const [viejo, nuevo] of Object.entries(renombres)) xml = xml.split(`Target="${viejo}"`).join(`Target="${nuevo}"`);
    zip.file(rels, xml);
  }
}

async function generarContrato(datos = {}) {
  const faltantes = Object.entries(CAMPOS_CONTRATO).filter(([campo]) => !String(datos[campo] || '').trim()).map(([, nombre]) => nombre);
  if (faltantes.length) {
    throw Object.assign(new Error(`Para armar el contrato completá primero: ${faltantes.join(', ')}.`), { status: 409, campos: faltantes });
  }
  const zip = await JSZip.loadAsync(await fs.readFile(PLANTILLA));
  const documento = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', completarDocumento(documento, datos));
  await repararImagenes(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { generarContrato, completarDocumento, CAMPOS_CONTRATO };
