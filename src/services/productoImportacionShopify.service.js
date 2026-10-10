'use strict';

const ExcelJS = require('exceljs');
const slugify = require('slugify');
const { Op } = require('sequelize');
const { sequelize, Categoria, Producto, ProductoImagen } = require('../models');
const ProductoService = require('./producto.service');
const ProductoVarianteService = require('./productoVariante.service');

const SHOPIFY_HEADERS_MINIMOS = ['Handle', 'Title'];
const MAX_ERRORES_DETALLE = 30;

function limpiarTexto(valor) {
  return String(valor ?? '').trim();
}

function quitarHtml(valor) {
  return limpiarTexto(valor)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function limitar(valor, max) {
  const texto = limpiarTexto(valor);
  return texto.length > max ? texto.slice(0, max - 1).trim() : texto;
}

function normalizarNumero(valor, fallback = 0) {
  if (valor === null || valor === undefined || valor === '') return fallback;
  let normalizado = String(valor).trim().replace(/[^\d,.-]/g, '');
  const ultimaComa = normalizado.lastIndexOf(',');
  const ultimoPunto = normalizado.lastIndexOf('.');

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    normalizado = ultimaComa > ultimoPunto
      ? normalizado.replace(/\./g, '').replace(',', '.')
      : normalizado.replace(/,/g, '');
  } else if (ultimaComa >= 0) {
    normalizado = /,\d{1,2}$/.test(normalizado)
      ? normalizado.replace(',', '.')
      : normalizado.replace(/,/g, '');
  } else if ((normalizado.match(/\./g) || []).length > 1) {
    normalizado = normalizado.replace(/\.(?=.*\.)/g, '');
  } else if (/\.\d{3}$/.test(normalizado)) {
    normalizado = normalizado.replace('.', '');
  }
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : fallback;
}

function normalizarEntero(valor, fallback = 0) {
  return Math.max(0, Math.trunc(normalizarNumero(valor, fallback)));
}

function splitTags(valor) {
  return limpiarTexto(valor)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function esUrlImagenValida(url) {
  const texto = limpiarTexto(url);
  return /^https?:\/\//i.test(texto) || texto.startsWith('/uploads/');
}

function parseCsv(texto) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < texto.length; i += 1) {
    const char = texto[i];
    const next = texto[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function filasAObjetos(rows) {
  const [headersRaw, ...dataRows] = rows;
  const headers = (headersRaw || []).map((h) => limpiarTexto(h).replace(/^\uFEFF/, ''));
  if (!SHOPIFY_HEADERS_MINIMOS.every((h) => headers.includes(h))) {
    throw new Error('El archivo no parece ser una exportación de productos de Shopify.');
  }

  return dataRows
    .filter((row) => row.some((cell) => limpiarTexto(cell)))
    .map((row, index) => ({
      __rowNumber: index + 2,
      ...Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])),
    }));
}

function agruparPorHandle(registros) {
  const grupos = new Map();
  for (const registro of registros) {
    const handle = limpiarTexto(registro.Handle) || slugify(limpiarTexto(registro.Title) || `producto-${registro.__rowNumber}`, { lower: true, strict: true });
    if (!grupos.has(handle)) grupos.set(handle, []);
    grupos.get(handle).push(registro);
  }
  return [...grupos.entries()].map(([handle, rows]) => ({ handle, rows }));
}

function filaConDatosProducto(rows) {
  return rows.find((row) => limpiarTexto(row.Title)) || rows[0];
}

function filasDeVariantes(rows) {
  return rows.filter((row) => {
    const tieneSku = limpiarTexto(row['Variant SKU']);
    const tienePrecio = limpiarTexto(row['Variant Price']);
    const tieneOpcion = ['Option1 Value', 'Option2 Value', 'Option3 Value'].some((campo) => limpiarTexto(row[campo]));
    const tieneTitulo = limpiarTexto(row.Title);
    return tieneTitulo || tieneSku || tienePrecio || tieneOpcion;
  });
}

function resolverOpciones(variantRows) {
  const opciones = [];
  for (let i = 1; i <= 3; i += 1) {
    const nombre = limpiarTexto(variantRows.find((row) => limpiarTexto(row[`Option${i} Name`]))?.[`Option${i} Name`]);
    if (!nombre || nombre.toLowerCase() === 'title') continue;
    const valores = [...new Set(variantRows.map((row) => limpiarTexto(row[`Option${i} Value`])).filter(Boolean))];
    if (valores.length > 0) opciones.push({ nombre, valores: valores.map((valor, orden) => ({ valor, orden })) });
  }
  return opciones;
}

function resolverVariantes(variantRows, opciones, precioBase) {
  if (opciones.length === 0 || variantRows.length <= 1) return [];
  return variantRows
    .map((row) => {
      const valores = opciones.map((opcion, index) => ({
        opcion: opcion.nombre,
        valor: limpiarTexto(row[`Option${index + 1} Value`]),
      })).filter((v) => v.valor);

      if (valores.length === 0) return null;
      const precioVariante = normalizarNumero(row['Variant Price'], precioBase);
      const stock = normalizarEntero(row['Variant Inventory Qty']);
      return {
        nombre: valores.map((v) => v.valor).join(' / '),
        sku_variante: limpiarTexto(row['Variant SKU']) || null,
        stock,
        stock_salon: stock,
        stock_deposito: 0,
        precio_diferencial: precioVariante - precioBase,
        valores,
      };
    })
    .filter(Boolean);
}

function imagenesDeGrupo(rows) {
  return [...new Set(rows.map((row) => limpiarTexto(row['Image Src'])).filter(esUrlImagenValida))];
}

function estadoVentaDesdeShopify(row, stock) {
  const status = limpiarTexto(row.Status).toLowerCase();
  const published = limpiarTexto(row.Published).toLowerCase();
  if (status === 'archived' || status === 'draft' || published === 'false') return 'no_disponible';
  return stock > 0 ? 'en_venta' : 'fuera_de_stock';
}

function skuDesdeProducto(row, handle, tieneVariantes) {
  const sku = limpiarTexto(row['Variant SKU']);
  if (sku && !tieneVariantes) return sku;
  return limitar((handle || limpiarTexto(row.Title) || `producto-${row.__rowNumber}`).toUpperCase().replace(/[^A-Z0-9-]+/g, '-'), 80);
}

function nombreCategoria(row) {
  const tipo = limpiarTexto(row.Type);
  if (tipo) return limitar(tipo, 150);
  const productCategory = limpiarTexto(row['Product Category']);
  if (!productCategory) return null;
  const partes = productCategory.split('>').map((p) => p.trim()).filter(Boolean);
  return limitar(partes[partes.length - 1] || productCategory, 150);
}

async function obtenerOCrearCategoria(nombre, inquilinoId, transaction) {
  if (!nombre) return null;
  const baseSlug = slugify(nombre, { lower: true, strict: true }) || 'categoria';
  let slug = baseSlug;
  let contador = 1;

  while (true) {
    const existente = await Categoria.findOne({ where: { inquilino_id: inquilinoId, slug }, transaction });
    if (existente) return existente.id;

    try {
      const creada = await Categoria.create({ inquilino_id: inquilinoId, nombre, slug, activo: true }, { transaction });
      return creada.id;
    } catch (err) {
      if (!err.name?.includes('Unique')) throw err;
      slug = `${baseSlug}-${++contador}`;
    }
  }
}

async function leerRegistrosDesdeArchivo(file) {
  const nombre = limpiarTexto(file.originalname).toLowerCase();
  if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('El Excel no tiene hojas para importar.');
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      rows.push(row.values.slice(1).map((cell) => {
        if (cell && typeof cell === 'object') return cell.text || cell.result || cell.hyperlink || cell.richText?.map((r) => r.text).join('') || '';
        return cell ?? '';
      }));
    });
    return filasAObjetos(rows);
  }

  const csvText = file.buffer.toString('utf8');
  return filasAObjetos(parseCsv(csvText));
}

async function importarShopify(file, contexto) {
  const registros = await leerRegistrosDesdeArchivo(file);
  const grupos = agruparPorHandle(registros);
  const errores = [];
  const creados = [];
  let imagenesCreadas = 0;
  let variantesCreadas = 0;

  for (const grupo of grupos) {
    const principal = filaConDatosProducto(grupo.rows);
    const variantRows = filasDeVariantes(grupo.rows);
    const opciones = resolverOpciones(variantRows);
    const imagenes = imagenesDeGrupo(grupo.rows);
    const precioBase = normalizarNumero(principal['Variant Price']);
    const variantes = resolverVariantes(variantRows, opciones, precioBase);
    const stockPrincipal = variantes.length
      ? variantes.reduce((acc, variante) => acc + (Number(variante.stock) || 0), 0)
      : normalizarEntero(principal['Variant Inventory Qty']);

    const nombre = limpiarTexto(principal.Title);
    if (!nombre) {
      errores.push({ handle: grupo.handle, fila: principal.__rowNumber, error: 'Falta el título del producto.' });
      continue;
    }

    const sku = skuDesdeProducto(principal, grupo.handle, variantes.length > 0);
    const existente = await Producto.findOne({
      where: {
        inquilino_id: contexto.inquilinoId,
        [Op.and]: [sequelize.where(sequelize.fn('upper', sequelize.fn('trim', sequelize.col('sku'))), sku.toUpperCase())],
      },
      attributes: ['id', 'nombre', 'sku'],
    });
    if (existente) {
      errores.push({ handle: grupo.handle, fila: principal.__rowNumber, error: `SKU repetido: ${sku} ya existe en "${existente.nombre}".` });
      continue;
    }

    const t = await sequelize.transaction();
    try {
      const descripcion = quitarHtml(principal['Body (HTML)']);
      const categoriaId = await obtenerOCrearCategoria(nombreCategoria(principal), contexto.inquilinoId, t);
      const producto = await ProductoService.crear({
        nombre,
        sku,
        categoria_id: categoriaId,
        tags: splitTags(principal.Tags),
        descripcion_corta: limitar(principal['SEO Description'] || descripcion, 500),
        descripcion_larga: descripcion,
        propuesta_valor: limitar(principal['SEO Description'] || descripcion, 240),
        precio_base: precioBase,
        precio_tachado: normalizarNumero(principal['Variant Compare At Price'], null),
        cantidad_disponible: stockPrincipal,
        stock_salon: stockPrincipal,
        stock_deposito: 0,
        activo: estadoVentaDesdeShopify(principal, stockPrincipal) !== 'no_disponible',
        estado_venta: estadoVentaDesdeShopify(principal, stockPrincipal),
        meta_titulo: limitar(principal['SEO Title'], 160),
        meta_descripcion: limitar(principal['SEO Description'], 320),
        ficha_datos: {
          shopify: {
            handle: grupo.handle,
            vendor: limpiarTexto(principal.Vendor),
            product_category: limpiarTexto(principal['Product Category']),
            type: limpiarTexto(principal.Type),
            status: limpiarTexto(principal.Status),
            body_html: limpiarTexto(principal['Body (HTML)']),
          },
        },
      }, contexto.inquilinoId, contexto.usuarioId, contexto.esAdmin, t, contexto.tiendaId);

      if (variantes.length > 0) {
        await ProductoVarianteService.crearMultiples(producto.id, contexto.inquilinoId, variantes, t, opciones);
        await ProductoService.recalcularStockPadre(producto.id, t);
        variantesCreadas += variantes.length;
      }

      if (imagenes.length > 0) {
        await ProductoImagen.bulkCreate(imagenes.map((url, index) => ({
          inquilino_id: contexto.inquilinoId,
          producto_id: producto.id,
          url,
          original_url: url,
          storage_key: null,
          original_storage_key: null,
          es_principal: index === 0,
          orden: index,
          visual_modo: 'contain',
        })), { transaction: t });
        imagenesCreadas += imagenes.length;
      }

      await t.commit();
      creados.push({ id: producto.id, nombre, sku, handle: grupo.handle });
    } catch (err) {
      await t.rollback();
      errores.push({ handle: grupo.handle, fila: principal.__rowNumber, error: err.message || 'No se pudo importar el producto.' });
    }
  }

  return {
    total_leidos: grupos.length,
    creados: creados.length,
    imagenes: imagenesCreadas,
    variantes: variantesCreadas,
    errores: errores.slice(0, MAX_ERRORES_DETALLE),
    errores_total: errores.length,
    productos: creados,
  };
}

module.exports = {
  importarShopify,
  leerRegistrosDesdeArchivo,
  parseCsv,
  filasAObjetos,
  agruparPorHandle,
  // Compartidos con la carga masiva de la plantilla de Gesicom.
  limpiarTexto,
  limitar,
  normalizarNumero,
  obtenerOCrearCategoria,
};
