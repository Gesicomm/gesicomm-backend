'use strict';

/**
 * Exportar / importar en Excel los precios propios de "Mi catálogo".
 *
 * El catálogo puede tener 7.000–10.000+ ítems, así que:
 *   - Exportar arma las filas con UNA consulta SQL (sin includes de Sequelize
 *     ni imágenes) y escribe el .xlsx en streaming directo a la respuesta.
 *   - Importar resuelve todas las filas contra un mapa en memoria (una sola
 *     consulta) y escribe en lotes: UPDATE ... FROM (VALUES ...) + bulkCreate,
 *     dentro de una transacción. Nunca una query por fila.
 *
 * Identificación de cada fila:
 *   - Tipo + ID (columnas del export) es la clave primaria: siempre existe y
 *     es la única forma de identificar combos, que no tienen SKU.
 *   - SKU sirve como alternativa (un Excel armado a mano con "SKU | Precio
 *     nuevo" funciona). El SKU es opcional en productos y único por inquilino
 *     solo según el índice del modelo, así que se compara normalizado
 *     (trim + mayúsculas) y un SKU que matchea más de un ítem se rechaza en
 *     vez de adivinar.
 *   - Si vienen ID y SKU y no coinciden, la fila es error: probablemente se
 *     desordenaron columnas y no hay que escribir un precio en otro producto.
 *
 * Solo se aplican las filas con "Precio nuevo" cargado y distinto del
 * actual. Se valida precio > 0, >= precio mínimo del admin y >= lo que le
 * cuesta al usuario (misma "Te cuesta" que muestra la tarjeta).
 */

const ExcelJS = require('exceljs');
const { sequelize, PrecioUsuario } = require('../models');
const PrecioUsuarioService = require('./precioUsuario.service');

const MAX_FILAS_IMPORTACION = 50000;
const LOTE_ESCRITURA = 1000;
const MAX_ERRORES_DETALLE = 500;
const MAX_CAMBIOS_DETALLE = 200;

const COLUMNAS_EXPORT = [
  { header: 'Tipo',                       key: 'tipo',           width: 11 },
  { header: 'ID',                         key: 'id',             width: 9 },
  { header: 'SKU',                        key: 'sku',            width: 18 },
  { header: 'Nombre',                     key: 'nombre',         width: 50 },
  { header: 'Categoría',                  key: 'categoria',      width: 22 },
  { header: 'Proveedor',                  key: 'proveedor',      width: 22 },
  { header: 'Te cuesta (Gs)',             key: 'costo',          width: 16, numero: true },
  { header: 'Precio mínimo (Gs)',         key: 'precio_minimo',  width: 18, numero: true },
  { header: 'Precio de venta actual (Gs)', key: 'precio_actual', width: 24, numero: true },
  { header: 'Precio nuevo (Gs)',          key: 'precio_nuevo',   width: 18, numero: true, editable: true },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizarTexto(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizarSku(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return s || null;
}

const ALIAS_COLUMNAS = {
  tipo: ['tipo'],
  id: ['id', 'id gesicomm'],
  sku: ['sku', 'codigo', 'codigo sku'],
  nombre: ['nombre', 'producto', 'nombre del producto'],
  precio_nuevo: ['precio nuevo', 'nuevo precio', 'precio de venta nuevo', 'nuevo precio de venta'],
};

function columnaDeHeader(texto) {
  const n = normalizarTexto(texto);
  for (const [clave, alias] of Object.entries(ALIAS_COLUMNAS)) {
    if (alias.includes(n)) return clave;
  }
  return null;
}

/** Valor "plano" de una celda de ExcelJS (fórmulas, rich text, hipervínculos). */
function valorCelda(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return valorCelda(v.result);
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('text' in v) return valorCelda(v.text);
    if ('error' in v) return null;
  }
  return v;
}

/**
 * Guaraníes no tienen decimales. Acepta 169000, "169000", "169.000",
 * "169,000", "Gs 169.000". Rechaza cosas ambiguas como "169.5" o "1.69.00".
 * Devuelve { valor } o { error }.
 */
function parsearPrecio(v) {
  const crudo = valorCelda(v);
  if (crudo === null || crudo === '') return { vacio: true };
  if (typeof crudo === 'number') {
    if (!Number.isFinite(crudo)) return { error: 'El precio no es un número válido.' };
    return { valor: Math.round(crudo) };
  }
  const texto = String(crudo).replace(/gs\.?/ig, '').replace(/[\s ₲]/g, '');
  if (texto === '') return { vacio: true };
  if (/^\d+$/.test(texto)) return { valor: parseInt(texto, 10) };
  if (/^\d{1,3}([.,]\d{3})+$/.test(texto)) return { valor: parseInt(texto.replace(/[.,]/g, ''), 10) };
  return { error: `"${String(crudo).slice(0, 30)}" no es un precio válido (sin decimales, ej. 169000).` };
}

function num(v) {
  return v === null || v === undefined ? null : parseFloat(v);
}

class PrecioUsuarioExcelService {

  /**
   * Todos los ítems que el usuario ve en "Mi catálogo" (mismas reglas de
   * visibilidad que listarCatalogoPaginado), en forma plana y liviana.
   */
  static async listarFilas(usuario_id, inquilino_id, esAdmin = false) {
    const replacements = { usuario_id, inquilino_id };
    const visProducto = PrecioUsuarioService.visibilidadCatalogoSql(esAdmin, false);
    const visCombo = PrecioUsuarioService.visibilidadComboSql(esAdmin, false);

    const filas = await sequelize.query(`
      SELECT * FROM (
        SELECT 'producto' AS tipo, p.id, p.sku, p.nombre,
          cat.nombre AS categoria, pr.nombre AS proveedor,
          CASE WHEN p.creado_por = :usuario_id AND p.precio_costo IS NOT NULL
               THEN p.precio_costo ELSE p.precio_base END AS costo,
          p.precio_base, p.precio_minimo,
          pu.id AS precio_usuario_id, pu.precio AS precio_usuario
        FROM productos p
        LEFT JOIN categorias cat ON cat.id = p.categoria_id
        LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
        LEFT JOIN precios_usuario pu
          ON pu.tipo = 'producto' AND pu.referencia_id = p.id AND pu.usuario_id = :usuario_id
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ${visProducto}

        UNION ALL

        SELECT 'combo' AS tipo, c.id, NULL AS sku, c.nombre,
          cat.nombre AS categoria, pr.nombre AS proveedor,
          c.precio_total AS costo,
          c.precio_total AS precio_base, c.precio_minimo,
          pu.id AS precio_usuario_id, pu.precio AS precio_usuario
        FROM producto_combos c
        INNER JOIN productos p ON c.producto_id = p.id AND p.inquilino_id = :inquilino_id AND p.activo = true
        LEFT JOIN categorias cat ON cat.id = p.categoria_id
        LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
        LEFT JOIN precios_usuario pu
          ON pu.tipo = 'combo' AND pu.referencia_id = c.id AND pu.usuario_id = :usuario_id
        WHERE c.inquilino_id = :inquilino_id AND c.estado = 'ACTIVO'
        ${visCombo}
        ${visProducto}
      ) t
      ORDER BY CASE WHEN tipo = 'producto' THEN 0 ELSE 1 END, nombre ASC, id ASC
    `, { replacements, type: sequelize.QueryTypes.SELECT });

    return filas.map(f => {
      const precioBase = num(f.precio_base);
      const precioUsuario = num(f.precio_usuario);
      return {
        tipo: f.tipo,
        id: Number(f.id),
        sku: f.sku || null,
        nombre: f.nombre,
        categoria: f.categoria || null,
        proveedor: f.proveedor || null,
        costo: num(f.costo),
        precio_minimo: num(f.precio_minimo),
        precio_usuario_id: f.precio_usuario_id ? Number(f.precio_usuario_id) : null,
        precio_actual: precioUsuario !== null ? precioUsuario : precioBase,
      };
    });
  }

  // ─── Exportar ──────────────────────────────────────────────────────────────

  /** Escribe el .xlsx en streaming sobre `stream` (la respuesta HTTP). */
  static async escribirExcel(filas, stream) {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    workbook.creator = 'Gesicomm';
    workbook.created = new Date();

    const hoja = workbook.addWorksheet('Precios', { views: [{ state: 'frozen', ySplit: 1 }] });
    hoja.columns = COLUMNAS_EXPORT.map(c => ({
      header: c.header,
      key: c.key,
      width: c.width,
      style: c.numero ? { numFmt: '#,##0' } : {},
    }));
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS_EXPORT.length } };

    const header = hoja.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.height = 22;
    COLUMNAS_EXPORT.forEach((c, i) => {
      header.getCell(i + 1).fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: c.editable ? 'FF16A34A' : 'FF0D1B3D' },
      };
    });
    header.commit();

    const rellenoEditable = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
    for (const f of filas) {
      const row = hoja.addRow({
        tipo: f.tipo === 'combo' ? 'Combo' : 'Producto',
        id: f.id,
        sku: f.sku || '',
        nombre: f.nombre,
        categoria: f.categoria || '',
        proveedor: f.proveedor || '',
        costo: f.costo,
        precio_minimo: f.precio_minimo,
        precio_actual: f.precio_actual,
        precio_nuevo: null,
      });
      row.getCell('precio_nuevo').fill = rellenoEditable;
      row.commit();
    }
    hoja.commit();

    const ayuda = workbook.addWorksheet('Instrucciones');
    ayuda.columns = [{ key: 'texto', width: 110 }];
    [
      'Cómo actualizar precios de venta en masa',
      '',
      '1. En la hoja "Precios", cargá el valor en la columna verde "Precio nuevo (Gs)". Sin decimales (ej. 169000).',
      '2. Dejá vacía la columna en los productos que no quieras cambiar: esas filas se ignoran.',
      '3. No modifiques las columnas "Tipo", "ID" ni "SKU": se usan para identificar cada producto o combo.',
      '4. Guardá el archivo como .xlsx y subilo en Mi catálogo → "Importar precios".',
      '5. Antes de aplicar vas a ver un resumen con los cambios y las filas con error.',
      '',
      'Reglas: el precio nuevo no puede ser menor al "Precio mínimo" ni a lo que te cuesta el producto ("Te cuesta").',
      'Podés borrar filas o columnas informativas (Nombre, Categoría, etc.). Lo mínimo es: SKU o ID, y Precio nuevo.',
      'Los combos no tienen SKU: para ellos se usan las columnas Tipo e ID.',
    ].forEach((texto, i) => {
      const row = ayuda.addRow({ texto });
      if (i === 0) row.font = { bold: true, size: 13 };
      row.commit();
    });
    ayuda.commit();

    await workbook.commit();
  }

  // ─── Importar ──────────────────────────────────────────────────────────────

  /**
   * Lee el .xlsx y devuelve las filas crudas { fila, tipo, id, sku, nombre, precio }.
   * Busca la hoja y la fila de encabezados (primeras 10 filas) que tengan
   * una columna "Precio nuevo" y otra de identificación (ID o SKU).
   */
  static async leerArchivo(buffer) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch {
      throw new Error('No se pudo leer el archivo. Tiene que ser un Excel .xlsx.');
    }

    for (const hoja of workbook.worksheets) {
      for (let r = 1; r <= Math.min(10, hoja.rowCount); r++) {
        const columnas = {};
        hoja.getRow(r).eachCell((cell, col) => {
          const clave = columnaDeHeader(valorCelda(cell.value));
          if (clave && !columnas[clave]) columnas[clave] = col;
        });
        if (!columnas.precio_nuevo || (!columnas.id && !columnas.sku)) continue;

        if (hoja.rowCount - r > MAX_FILAS_IMPORTACION) {
          throw new Error(`El archivo tiene más de ${MAX_FILAS_IMPORTACION.toLocaleString('es-PY')} filas.`);
        }

        const filas = [];
        for (let i = r + 1; i <= hoja.rowCount; i++) {
          const row = hoja.getRow(i);
          const leer = (clave) => (columnas[clave] ? valorCelda(row.getCell(columnas[clave]).value) : null);
          const fila = {
            fila: i,
            tipo: leer('tipo'),
            id: leer('id'),
            sku: leer('sku'),
            nombre: leer('nombre'),
            precio: row.getCell(columnas.precio_nuevo).value,
          };
          if ([fila.id, fila.sku, fila.precio].every(v => v === null || String(v).trim() === '')) continue;
          filas.push(fila);
        }
        return { hoja: hoja.name, columnas: Object.keys(columnas), filas };
      }
    }

    throw new Error('No se encontró la columna "Precio nuevo" junto a "SKU" o "ID". Usá el Excel que descargás con "Exportar".');
  }

  /**
   * Valida el archivo contra el catálogo y, si `aplicar`, escribe los
   * precios válidos. Las filas con error nunca se escriben; el usuario las
   * ve en la vista previa antes de confirmar.
   */
  static async importar(usuario_id, inquilino_id, esAdmin, buffer, { aplicar = false } = {}) {
    const { hoja, filas } = await this.leerArchivo(buffer);
    const catalogo = await this.listarFilas(usuario_id, inquilino_id, esAdmin);

    const porClave = new Map(catalogo.map(item => [`${item.tipo}:${item.id}`, item]));
    const porSku = new Map();
    for (const item of catalogo) {
      const sku = normalizarSku(item.sku);
      if (!sku) continue;
      if (!porSku.has(sku)) porSku.set(sku, []);
      porSku.get(sku).push(item);
    }

    const errores = [];
    const cambiosPorClave = new Map();
    const conflictos = new Set();
    let sinPrecio = 0;

    const agregarError = (fila, motivo, item = null) => {
      errores.push({
        fila: fila.fila,
        sku: item?.sku ?? (fila.sku != null ? String(fila.sku) : null),
        nombre: item?.nombre ?? (fila.nombre != null ? String(fila.nombre) : null),
        motivo,
      });
    };

    for (const fila of filas) {
      const precio = parsearPrecio(fila.precio);
      if (precio.vacio) { sinPrecio++; continue; }

      // 1) Resolver el ítem
      const sku = normalizarSku(fila.sku);
      const idTexto = fila.id !== null && fila.id !== undefined ? String(fila.id).trim() : '';
      let item = null;

      if (idTexto) {
        if (!/^\d+$/.test(idTexto)) { agregarError(fila, `ID "${idTexto}" inválido.`); continue; }
        const tipoNorm = normalizarTexto(fila.tipo);
        const tipo = tipoNorm.startsWith('combo') ? 'combo' : 'producto';
        item = porClave.get(`${tipo}:${Number(idTexto)}`);
        if (!item) {
          agregarError(fila, `No hay ningún ${tipo} con ID ${idTexto} en tu catálogo.`);
          continue;
        }
        if (sku && normalizarSku(item.sku) !== sku) {
          agregarError(fila, `El SKU "${fila.sku}" no corresponde al ID ${idTexto} (${item.sku || 'sin SKU'}). Revisá que no se hayan movido columnas.`, item);
          continue;
        }
      } else if (sku) {
        const candidatos = porSku.get(sku) || [];
        if (candidatos.length === 0) {
          agregarError(fila, `SKU "${fila.sku}" no encontrado en tu catálogo.`);
          continue;
        }
        if (candidatos.length > 1) {
          agregarError(fila, `El SKU "${fila.sku}" está repetido en ${candidatos.length} productos. Usá la columna ID para identificarlo.`);
          continue;
        }
        item = candidatos[0];
      } else {
        agregarError(fila, 'La fila no tiene SKU ni ID.');
        continue;
      }

      // 2) Validar el precio
      if (precio.error) { agregarError(fila, precio.error, item); continue; }
      const nuevo = precio.valor;
      if (nuevo <= 0) { agregarError(fila, 'El precio tiene que ser mayor a cero.', item); continue; }
      if (item.precio_minimo && nuevo < item.precio_minimo) {
        agregarError(fila, `Menor al precio mínimo (Gs ${item.precio_minimo.toLocaleString('es-PY')}).`, item);
        continue;
      }
      if (item.costo && nuevo < item.costo) {
        agregarError(fila, `Menor a lo que te cuesta (Gs ${item.costo.toLocaleString('es-PY')}).`, item);
        continue;
      }

      // 3) Duplicados dentro del mismo archivo
      const clave = `${item.tipo}:${item.id}`;
      if (conflictos.has(clave)) { agregarError(fila, 'El producto aparece varias veces con precios distintos.', item); continue; }
      const previo = cambiosPorClave.get(clave);
      if (previo) {
        if (previo.precio_nuevo !== nuevo) {
          conflictos.add(clave);
          cambiosPorClave.delete(clave);
          agregarError(fila, `El producto aparece también en la fila ${previo.fila} con otro precio.`, item);
        }
        continue;
      }
      if (nuevo === item.precio_actual) {
        // Se registra igual para detectar un duplicado posterior con otro precio.
        cambiosPorClave.set(clave, { fila: fila.fila, item, precio_nuevo: nuevo, sinCambio: true });
        continue;
      }

      cambiosPorClave.set(clave, { fila: fila.fila, item, precio_nuevo: nuevo, sinCambio: false });
    }

    const todos = [...cambiosPorClave.values()];
    const cambios = todos.filter(c => !c.sinCambio);
    const sinCambios = todos.length - cambios.length;

    let aplicados = 0;
    if (aplicar && cambios.length > 0) {
      aplicados = await this.escribirPrecios(usuario_id, inquilino_id, cambios);
    }

    return {
      hoja,
      total_filas: filas.length,
      filas_sin_precio: sinPrecio,
      sin_cambios: sinCambios,
      a_actualizar: cambios.length,
      aplicado: Boolean(aplicar),
      actualizados: aplicados,
      total_errores: errores.length,
      errores: errores.slice(0, MAX_ERRORES_DETALLE),
      cambios: cambios.slice(0, MAX_CAMBIOS_DETALLE).map(c => ({
        fila: c.fila,
        tipo: c.item.tipo,
        id: c.item.id,
        sku: c.item.sku,
        nombre: c.item.nombre,
        precio_actual: c.item.precio_actual,
        precio_nuevo: c.precio_nuevo,
      })),
    };
  }

  /**
   * UPDATE de los precios existentes en lotes con VALUES, e INSERT de los
   * nuevos con bulkCreate. Todo en una transacción: o se aplica el archivo
   * entero o nada.
   */
  static async escribirPrecios(usuario_id, inquilino_id, cambios) {
    const actualizar = cambios.filter(c => c.item.precio_usuario_id);
    const crear = cambios.filter(c => !c.item.precio_usuario_id);

    await sequelize.transaction(async (transaction) => {
      for (let i = 0; i < actualizar.length; i += LOTE_ESCRITURA) {
        const lote = actualizar.slice(i, i + LOTE_ESCRITURA);
        const replacements = { usuario_id };
        const values = lote.map((c, j) => {
          replacements[`id${j}`] = c.item.precio_usuario_id;
          replacements[`p${j}`] = c.precio_nuevo;
          return `(CAST(:id${j} AS INTEGER), CAST(:p${j} AS NUMERIC))`;
        }).join(', ');
        await sequelize.query(`
          UPDATE precios_usuario AS pu
          SET precio = v.precio, updated_at = NOW()
          FROM (VALUES ${values}) AS v(id, precio)
          WHERE pu.id = v.id AND pu.usuario_id = :usuario_id
        `, { replacements, transaction });
      }

      for (let i = 0; i < crear.length; i += LOTE_ESCRITURA) {
        await PrecioUsuario.bulkCreate(
          crear.slice(i, i + LOTE_ESCRITURA).map(c => ({
            usuario_id,
            inquilino_id,
            tipo: c.item.tipo,
            referencia_id: c.item.id,
            precio: c.precio_nuevo,
          })),
          { transaction, validate: false },
        );
      }
    });

    return cambios.length;
  }
}

PrecioUsuarioExcelService._internals = { parsearPrecio, columnaDeHeader, normalizarSku };

module.exports = PrecioUsuarioExcelService;
