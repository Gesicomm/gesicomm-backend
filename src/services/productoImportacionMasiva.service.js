'use strict';

/**
 * Carga masiva de productos con la plantilla de Gesicom (Excel).
 *
 * Una fila por producto, solo con lo básico: lo que la tienda necesita para
 * mostrarlo y venderlo (nombre, descripción, imágenes, precio, stock) y lo
 * que usan los cálculos de rentabilidad (costo de compra y precio de venta).
 * Mismo criterio que el importador de Shopify: cada producto se crea en su
 * propia transacción (uno con error no frena al resto) y las imágenes se
 * guardan por link, sin descargarlas.
 *
 * Es en dos pasos, como "Importar precios" de Mi catálogo: sin `aplicar`
 * solo revisa el archivo y devuelve qué entraría y qué no; con `aplicar`
 * crea las filas sin errores.
 */

const ExcelJS = require('exceljs');
const { Op } = require('sequelize');
const { sequelize, Producto, ProductoImagen, Deposito } = require('../models');
const ProductoService = require('./producto.service');
const { limpiarTexto, limitar, normalizarNumero, obtenerOCrearCategoria } = require('./productoImportacionShopify.service');

const MAX_PRODUCTOS = 500;
const MAX_IMAGENES = 6; // mismo tope que la galería del producto
const MAX_ERRORES_DETALLE = 50;

const HOJA_PRODUCTOS = 'Productos';

// `clave` es el nombre interno; `titulo` es el encabezado de la plantilla.
// Para leer el archivo el encabezado se compara sin tildes, mayúsculas,
// asterisco ni aclaración entre paréntesis.
// Las obligatorias van primero y angostas, para que se vean todas sin
// desplazarse al abrir el archivo (las fotos quedaban fuera de pantalla).
const COLUMNAS_PRODUCTOS = [
  { clave: 'sku', titulo: 'SKU', obligatoria: true, ancho: 18, ayuda: 'Código único del producto. No puede repetirse en el archivo ni existir ya en tu catálogo.', ejemplo: 'MOUSE-INAL-01' },
  { clave: 'nombre', titulo: 'Nombre', obligatoria: true, ancho: 28, ayuda: 'Nombre del producto tal como lo ve el cliente.', ejemplo: 'Mouse inalámbrico silencioso' },
  { clave: 'imagenes', titulo: 'Imágenes (links)', obligatoria: true, ancho: 40, ayuda: `Links públicos de las fotos, que empiecen con https:// y abran la imagen en el navegador (no sirven archivos de tu computadora ni links privados de Drive). Hasta ${MAX_IMAGENES}, uno por renglón dentro de la celda (Alt+Enter) o separados con |. La primera es la foto principal.`, ejemplo: 'https://mitienda.com/fotos/mouse-1.jpg | https://mitienda.com/fotos/mouse-2.jpg' },
  { clave: 'costo', titulo: 'Costo de compra', obligatoria: true, ancho: 16, ayuda: 'Lo que te cuesta el producto, en guaraníes, solo el número. Con este dato se calculan la ganancia y el margen.', ejemplo: '35000' },
  { clave: 'precio', titulo: 'Precio de venta', obligatoria: true, ancho: 16, ayuda: 'En guaraníes, solo el número. Ej: 89000. No puede ser menor al costo de compra.', ejemplo: '89000' },
  { clave: 'stock', titulo: 'Stock', obligatoria: true, ancho: 10, ayuda: 'Unidades disponibles. Con 0 la tienda lo muestra sin stock y no deja comprarlo.', ejemplo: '20' },
  { clave: 'descripcion', titulo: 'Descripción', obligatoria: true, ancho: 50, ayuda: 'Qué es, para quién es, qué problema resuelve y cómo se usa. De 2 a 4 oraciones.', ejemplo: 'Mouse inalámbrico con receptor USB y clic silencioso. Pensado para trabajar en la oficina o en casa sin cables ni ruido. Se conecta solo: enchufás el receptor y listo.' },
  { clave: 'ubicacion', titulo: 'Ubicación del stock', ancho: 22, ayuda: 'Nombre de la ubicación (Mi Tienda → Depósitos) donde está el stock. Si tenés una sola, dejalo vacío.', ejemplo: 'Depósito Central' },
  { clave: 'categoria', titulo: 'Categoría', ancho: 22, ayuda: 'Nombre de la categoría. Si no existe, se crea. Ordena el catálogo, los filtros y los productos relacionados.', ejemplo: 'Tecnología' },
  { clave: 'propuesta_valor', titulo: 'Propuesta de valor', ancho: 44, ayuda: 'Una oración corta que dice qué gana el cliente. Se muestra debajo del nombre.', ejemplo: 'Trabajá sin cables y sin ruido.' },
  { clave: 'beneficios', titulo: 'Beneficios', ancho: 40, ayuda: 'De 2 a 5 palabras cada uno, uno por renglón (Alt+Enter) o separados con |. La ficha muestra los 4 primeros.', ejemplo: 'Batería de larga duración | Clic silencioso | Conexión inmediata | Cómodo todo el día' },
  { clave: 'precio_ancla', titulo: 'Precio ancla', ancho: 16, ayuda: 'Precio tachado, mayor al precio de venta: la tienda muestra el descuento. Vacío = sin precio ancla.', ejemplo: '116000' },
];

const tituloColumna = (c) => (c.obligatoria ? `${c.titulo} *` : c.titulo);

function normalizarEncabezado(valor) {
  return limpiarTexto(valor)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textoDeCelda(celda) {
  if (celda === null || celda === undefined) return '';
  if (celda instanceof Date) return celda.toISOString().slice(0, 10);
  if (typeof celda === 'object') {
    if (Array.isArray(celda.richText)) return celda.richText.map((r) => r.text).join('');
    return limpiarTexto(celda.text ?? celda.result ?? celda.hyperlink ?? '');
  }
  return limpiarTexto(celda);
}

/** Celda con varios valores: uno por renglón o separados con "|". */
function listaDeCelda(valor) {
  return limpiarTexto(valor).split(/\r?\n|\|/).map((v) => v.trim()).filter(Boolean);
}

function esLinkImagen(url) {
  return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(url);
}

/** Filas de una hoja como objetos `{ __fila, [clave]: texto }`, según sus columnas. */
function filasDeHoja(hoja, columnas) {
  if (!hoja) return null;
  const porEncabezado = new Map(columnas.map((c) => [normalizarEncabezado(c.titulo), c.clave]));
  const filas = [];
  let claves = null;
  hoja.eachRow({ includeEmpty: false }, (row, numero) => {
    const celdas = row.values.slice(1).map(textoDeCelda);
    if (!claves) {
      claves = celdas.map((c) => porEncabezado.get(normalizarEncabezado(c)) || null);
      return;
    }
    if (!celdas.some(Boolean)) return;
    const fila = { __fila: numero };
    claves.forEach((clave, i) => { if (clave) fila[clave] = celdas[i] || ''; });
    filas.push(fila);
  });
  return { claves: (claves || []).filter(Boolean), filas };
}

async function leerLibro(file) {
  if (!limpiarTexto(file?.originalname).toLowerCase().endsWith('.xlsx')) {
    throw new Error('Subí la plantilla de Gesicom en formato Excel (.xlsx).');
  }
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(file.buffer);
  } catch {
    throw new Error('No se pudo leer el archivo. Descargá la plantilla y completala sin cambiar el formato.');
  }
  const hoja = (nombre) => libro.worksheets.find((h) => normalizarEncabezado(h.name) === normalizarEncabezado(nombre));
  const productos = filasDeHoja(hoja(HOJA_PRODUCTOS) || libro.worksheets[0], COLUMNAS_PRODUCTOS);
  if (!productos) throw new Error('El Excel no tiene hojas para importar.');
  const faltan = COLUMNAS_PRODUCTOS.filter((c) => c.obligatoria && !productos.claves.includes(c.clave)).map((c) => c.titulo);
  if (faltan.length) {
    throw new Error(`Al archivo le faltan columnas obligatorias: ${faltan.join(', ')}. Descargá la plantilla y usá esos encabezados.`);
  }
  return { productos: productos.filas };
}

const claveSku = (sku) => limpiarTexto(sku).toUpperCase();

/**
 * Valida el archivo sin tocar la base y arma lo que se va a crear.
 * Devuelve `{ productos, errores }`: un producto con errores no se importa
 * y cada error dice hoja, fila y motivo para que la persona lo corrija.
 */
function armarProductos(libro) {
  const errores = [];
  const error = (hoja, fila, sku, mensaje) => errores.push({ hoja, fila, sku: sku || null, error: mensaje });
  const productos = [];
  const porSku = new Map();

  if (libro.productos.length > MAX_PRODUCTOS) {
    throw new Error(`El archivo tiene ${libro.productos.length} productos. Subí hasta ${MAX_PRODUCTOS} por archivo.`);
  }

  for (const fila of libro.productos) {
    const sku = limpiarTexto(fila.sku);
    const antes = errores.length;
    const fallo = (mensaje) => error(HOJA_PRODUCTOS, fila.__fila, sku, mensaje);

    if (!sku) fallo('Falta el SKU.');
    else if (sku.length > 100) fallo('El SKU no puede superar los 100 caracteres.');
    else if (porSku.has(claveSku(sku))) fallo(`El SKU "${sku}" está repetido en el archivo (fila ${porSku.get(claveSku(sku)).fila}).`);

    const nombre = limpiarTexto(fila.nombre);
    if (!nombre) fallo('Falta el nombre.');
    else if (nombre.length > 255) fallo('El nombre no puede superar los 255 caracteres.');

    const precio = normalizarNumero(fila.precio, NaN);
    if (!limpiarTexto(fila.precio)) fallo('Falta el precio de venta.');
    else if (!(precio > 0)) fallo(`El precio de venta "${fila.precio}" no es un número mayor a cero.`);

    const descripcion = limpiarTexto(fila.descripcion);
    if (!descripcion) fallo('Falta la descripción.');

    const imagenes = [...new Set(listaDeCelda(fila.imagenes))];
    const linksMalos = imagenes.filter((url) => !esLinkImagen(url));
    if (!imagenes.length) fallo('Falta al menos un link de imagen.');
    else if (linksMalos.length) fallo(`Este link de imagen no es válido: ${limitar(linksMalos[0], 80)}. Tiene que empezar con http:// o https://`);
    else if (imagenes.length > MAX_IMAGENES) fallo(`Tiene ${imagenes.length} imágenes: el máximo es ${MAX_IMAGENES} por producto.`);

    const precioAncla = limpiarTexto(fila.precio_ancla) ? normalizarNumero(fila.precio_ancla, NaN) : null;
    if (precioAncla !== null && !(precioAncla > precio)) fallo('El precio ancla tiene que ser mayor al precio de venta.');

    // Costo obligatorio: sin él la ganancia y el margen salen mal en los
    // reportes. Mismo criterio que "Importar precios": no se vende bajo costo.
    const costo = normalizarNumero(fila.costo, NaN);
    if (!limpiarTexto(fila.costo)) fallo('Falta el costo de compra.');
    else if (!(costo >= 0)) fallo(`El costo de compra "${fila.costo}" no es un número válido.`);
    else if (precio > 0 && precio < costo) fallo('El precio de venta es menor al costo de compra.');

    const stock = normalizarNumero(fila.stock, NaN);
    if (!limpiarTexto(fila.stock)) fallo('Falta el stock (poné 0 si todavía no tenés unidades).');
    else if (!(stock >= 0) || !Number.isInteger(stock)) fallo(`El stock "${fila.stock}" no es un número entero.`);

    const producto = {
      fila: fila.__fila,
      sku,
      nombre,
      precio,
      precio_ancla: precioAncla,
      costo,
      stock,
      ubicacion: limpiarTexto(fila.ubicacion) || null,
      descripcion,
      // Para las tarjetas del catálogo: la primera oración de la descripción.
      descripcion_corta: limitar(descripcion.split(/(?<=[.!?])\s/)[0], 500),
      propuesta_valor: limpiarTexto(fila.propuesta_valor) || null,
      imagenes,
      beneficios: listaDeCelda(fila.beneficios).slice(0, 8),
      categoria: limitar(fila.categoria, 150) || null,
      valido: errores.length === antes,
    };
    productos.push(producto);
    if (sku && !porSku.has(claveSku(sku))) porSku.set(claveSku(sku), producto);
  }

  return { productos, errores };
}

/** SKUs del archivo que ya existen en el catálogo (sin distinguir mayúsculas), con el nombre del producto que lo usa. */
async function skusExistentes(skus, inquilinoId) {
  const existentes = new Map();
  for (let i = 0; i < skus.length; i += 1000) {
    const lote = skus.slice(i, i + 1000);
    const filas = await Producto.findAll({
      where: {
        inquilino_id: inquilinoId,
        [Op.and]: [sequelize.where(sequelize.fn('upper', sequelize.fn('trim', sequelize.col('sku'))), { [Op.in]: lote })],
      },
      attributes: ['sku', 'nombre'],
    });
    filas.forEach((p) => existentes.set(claveSku(p.sku), p.nombre));
  }
  return existentes;
}

const claveUbicacion = (nombre) => limpiarTexto(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * A qué ubicación va el stock de cada producto. El stock se guarda repartido
 * por ubicación (igual que en el formulario), así que un producto con stock
 * necesita una: la que dice la fila o, si la persona tiene una sola, esa.
 * Marca con error las filas que no se pueden resolver.
 */
async function asignarUbicaciones(productos, errores, contexto) {
  const conStock = productos.filter((p) => p.valido && p.stock > 0);
  if (!conStock.length) return;
  const ubicaciones = await Deposito.findAll({ where: { usuario_id: contexto.usuarioId, activo: true }, attributes: ['id', 'nombre'] });
  const porNombre = new Map(ubicaciones.map((u) => [claveUbicacion(u.nombre), u]));
  const nombres = ubicaciones.map((u) => u.nombre).join(', ');

  for (const producto of conStock) {
    let motivo = null;
    if (!ubicaciones.length) motivo = 'Para cargar stock primero creá una ubicación en Mi Tienda → Depósitos (o dejá el stock en 0).';
    else if (producto.ubicacion && !porNombre.has(claveUbicacion(producto.ubicacion))) motivo = `La ubicación "${producto.ubicacion}" no existe. Tus ubicaciones: ${nombres}.`;
    else if (!producto.ubicacion && ubicaciones.length > 1) motivo = `Tenés varias ubicaciones: escribí en "Ubicación del stock" una de estas: ${nombres}.`;

    if (motivo) {
      producto.valido = false;
      errores.push({ hoja: HOJA_PRODUCTOS, fila: producto.fila, sku: producto.sku, error: motivo });
    } else {
      producto.deposito_id = (producto.ubicacion ? porNombre.get(claveUbicacion(producto.ubicacion)) : ubicaciones[0]).id;
    }
  }
}

async function crearProducto(producto, categoriaId, contexto) {
  const t = await sequelize.transaction();
  try {
    const creado = await ProductoService.crear({
      nombre: producto.nombre,
      sku: producto.sku,
      categoria_id: categoriaId,
      descripcion_corta: producto.descripcion_corta,
      descripcion_larga: producto.descripcion,
      propuesta_valor: producto.propuesta_valor,
      precio_base: producto.precio,
      precio_ancla: producto.precio_ancla,
      precio_costo: producto.costo,
      stock_salon: producto.stock,
      stock_deposito: 0,
      activo: true,
      estado_venta: 'en_venta',
      beneficios: producto.beneficios.map((titulo) => ({ titulo, texto: '', icono: 'check' })),
      confianza: [],
      ficha_datos: {},
    }, contexto.inquilinoId, contexto.usuarioId, contexto.esAdmin, t, contexto.tiendaId);

    // Mismo paso que el alta desde el formulario: el stock queda asentado en
    // su ubicación, que es de donde lo descuenta la venta.
    await ProductoService.sincronizarStockDeposito(
      creado.id, contexto.usuarioId,
      producto.stock > 0 ? [{ deposito_id: producto.deposito_id, variante_id: null, cantidad: producto.stock }] : [],
      t,
    );
    await ProductoImagen.bulkCreate(producto.imagenes.map((url, index) => ({
      inquilino_id: contexto.inquilinoId,
      producto_id: creado.id,
      url,
      original_url: url,
      storage_key: null,
      original_storage_key: null,
      es_principal: index === 0,
      orden: index,
      visual_modo: 'contain',
    })), { transaction: t });

    await t.commit();
    return creado;
  } catch (err) {
    await t.rollback();
    throw err;
  }
}

async function importarMasivo(file, contexto, { aplicar = false } = {}) {
  if (!contexto.esAdmin && !contexto.tiendaId) {
    throw new Error('Seleccioná una tienda antes de importar productos.');
  }
  const { productos, errores } = armarProductos(await leerLibro(file));
  if (!productos.length) throw new Error('La hoja Productos está vacía. Completá al menos una fila.');

  const existentes = await skusExistentes(productos.filter((p) => p.valido).map((p) => claveSku(p.sku)), contexto.inquilinoId);
  for (const producto of productos) {
    if (producto.valido && existentes.has(claveSku(producto.sku))) {
      producto.valido = false;
      errores.push({ hoja: HOJA_PRODUCTOS, fila: producto.fila, sku: producto.sku, error: `El SKU "${producto.sku}" ya existe en tu catálogo ("${existentes.get(claveSku(producto.sku))}").` });
    }
  }
  await asignarUbicaciones(productos, errores, contexto);

  const listos = productos.filter((p) => p.valido);
  const creados = [];
  let imagenes = 0;
  if (aplicar) {
    // Las categorías se resuelven fuera de la transacción de cada producto:
    // si un producto falla, la categoría que estrenó sigue valiendo para los demás.
    const categorias = new Map();
    for (const producto of listos) {
      try {
        const claveCategoria = (producto.categoria || '').toLowerCase();
        if (producto.categoria && !categorias.has(claveCategoria)) {
          categorias.set(claveCategoria, await obtenerOCrearCategoria(producto.categoria, contexto.inquilinoId));
        }
        const creado = await crearProducto(producto, categorias.get(claveCategoria) || null, contexto);
        creados.push({ id: creado.id, sku: producto.sku, nombre: producto.nombre });
        imagenes += producto.imagenes.length;
      } catch (err) {
        errores.push({ hoja: HOJA_PRODUCTOS, fila: producto.fila, sku: producto.sku, error: err.message || 'No se pudo crear el producto.' });
      }
    }
  }

  errores.sort((a, b) => a.fila - b.fila);
  return {
    aplicado: aplicar,
    total_leidos: productos.length,
    listos: listos.length,
    creados: creados.length,
    imagenes,
    errores: errores.slice(0, MAX_ERRORES_DETALLE),
    errores_total: errores.length,
    productos: creados,
  };
}

/** El formato del archivo, para que la pantalla lo explique con los mismos datos que usa la plantilla. */
function formato() {
  return {
    hoja: HOJA_PRODUCTOS,
    max_productos: MAX_PRODUCTOS,
    max_imagenes: MAX_IMAGENES,
    columnas: COLUMNAS_PRODUCTOS.map((c) => ({ titulo: c.titulo, obligatoria: !!c.obligatoria, ayuda: c.ayuda, ejemplo: c.ejemplo })),
  };
}

/** La plantilla vacía, con una nota de ayuda en cada encabezado y una hoja de instrucciones con un ejemplo. */
async function generarPlantilla() {
  const libro = new ExcelJS.Workbook();
  const agregarHoja = (nombre, columnas) => {
    const hoja = libro.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    hoja.columns = columnas.map((c) => ({ header: tituloColumna(c), key: c.clave, width: c.ancho }));
    hoja.getRow(1).eachCell((celda, i) => {
      const columna = columnas[i - 1];
      celda.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columna.obligatoria ? 'FF1D4ED8' : 'FF475569' } };
      if (columna.ayuda) celda.note = columna.ayuda;
    });
    hoja.columns.forEach((c) => { c.alignment = { vertical: 'top', wrapText: true }; });
    return hoja;
  };
  agregarHoja(HOJA_PRODUCTOS, COLUMNAS_PRODUCTOS);

  const ayuda = libro.addWorksheet('Instrucciones');
  ayuda.columns = [{ width: 24 }, { width: 14 }, { width: 90 }];
  const titulo = (texto) => { ayuda.addRow([texto]).font = { bold: true, size: 12 }; };
  titulo('Cómo completar la plantilla');
  [
    `Cargá un producto por fila en la hoja "${HOJA_PRODUCTOS}". Hasta ${MAX_PRODUCTOS} productos por archivo.`,
    'Las columnas con * (encabezado azul) son obligatorias. Sin ellas, esa fila no se importa.',
    'No cambies los nombres de las hojas ni de los encabezados. El orden de las columnas no importa.',
    'Para varias imágenes o beneficios en una celda: uno por renglón (Alt+Enter) o separados con |',
    'El costo de compra y el precio de venta van en guaraníes. Con esos dos datos se calculan la ganancia y el margen.',
    'El stock se guarda en una ubicación de Mi Tienda → Depósitos. Si tenés más de una, completá "Ubicación del stock".',
    'Al subir el archivo primero se revisa y te muestra qué filas tienen errores. No se crea nada hasta que confirmes.',
    'Lo demás (variantes, preguntas frecuentes, opiniones, ofertas) se completa después dentro de cada producto.',
  ].forEach((linea) => ayuda.addRow([linea]));
  ayuda.addRow([]);
  titulo(`Columnas de la hoja "${HOJA_PRODUCTOS}"`);
  ayuda.addRow(['Columna', 'Obligatoria', 'Qué va']).font = { bold: true };
  COLUMNAS_PRODUCTOS.forEach((c) => ayuda.addRow([c.titulo, c.obligatoria ? 'Sí' : 'No', c.ayuda]));
  ayuda.addRow([]);
  titulo('Ejemplo de una fila');
  COLUMNAS_PRODUCTOS.forEach((c) => ayuda.addRow([c.titulo, '', c.ejemplo]));
  ayuda.getColumn(3).alignment = { vertical: 'top', wrapText: true };

  return libro.xlsx.writeBuffer();
}

module.exports = {
  importarMasivo,
  generarPlantilla,
  formato,
  leerLibro,
  armarProductos,
  COLUMNAS_PRODUCTOS,
  MAX_PRODUCTOS,
};
