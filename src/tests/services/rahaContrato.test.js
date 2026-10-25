'use strict';
const JSZip = require('jszip');
const { generarContrato } = require('../../services/raha/contrato');

const datos = {
  razon_social: 'Sommix S.A.', ruc: '80012345-6', representante: 'Ana Benítez', cedula: '1.234.567',
  direccion: 'Mcal. López 1234', ciudad: 'Asunción', departamento: 'Central', email: 'contacto@sommix.com.py',
  telefono: '0981 123456', actividad_economica: 'Venta de <artículos> & más', tipo_productos: 'Hogar',
  operaciones_mensuales: '300', banco: 'Banco Itaú', tipo_cuenta: 'Caja de ahorro', numero_cuenta: '123456',
  titular_cuenta: 'Sommix S.A.', moneda: 'PYG',
};
const texto = async buffer => {
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
};

test('completa el contrato con los datos de la solicitud y deja la fecha para la firma', async () => {
  const contenido = await texto(await generarContrato(datos));
  expect(contenido).toContain('Por la otra parte, Sommix S.A., con RUC / C.I. N.º 80012345-6, domicilio en Mcal. López 1234, Asunción, Central, representada por el señor/la señora Ana Benítez, C.I. N.º 1.234.567');
  expect(contenido).toContain('300 pedidos por mes');
  expect(contenido).toContain('Caja de ahorro en guaraníes N.º 123456');
  expect(contenido).toContain('Venta de &lt;artículos&gt; &amp; más');
  expect(contenido).not.toContain('[RAZÓN SOCIAL');
  expect(contenido).not.toContain('[Nombre / Razón social]');
  expect(contenido).toContain('a los [____] días del mes de');
});

test('le pone extensión real al logo del encabezado para que Word abra el archivo', async () => {
  const zip = await JSZip.loadAsync(await generarContrato(datos));
  const medios = Object.keys(zip.files).filter(n => n.startsWith('word/media/') && !n.endsWith('/'));
  expect(medios.length).toBeGreaterThan(0);
  expect(medios.every(n => /\.(png|jpg)$/.test(n))).toBe(true);
  const rels = await zip.file('word/_rels/header1.xml.rels').async('string');
  expect(rels).not.toContain('.undefined');
});

test('no arma el contrato si faltan datos que lleva', async () => {
  await expect(generarContrato({ ...datos, tipo_cuenta: '', banco: ' ' })).rejects.toMatchObject({
    status: 409, message: 'Para armar el contrato completá primero: Banco, Tipo de cuenta.',
  });
});
