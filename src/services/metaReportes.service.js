'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize,
  MetaCampanaInterna,
  MetaReporteImport,
  MetaReporteFila,
  MetaIntegration,
  Landing,
  Producto,
} = require('../models');
const { parsearCSV } = require('../utils/csvParser');

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) para que el código sea
// fácil de leer/tipear cuando el usuario lo pega a mano en Meta Ads Manager.
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 6;
const PREFIJO = 'GSC';

// Matchea "[GSC-A3F9K1]" en cualquier parte del nombre de campaña.
const REGEX_CODIGO = /\[GSC-([A-Z0-9]{4,10})\]/i;

function generarCodigoAleatorio() {
  let codigo = '';
  const bytes = crypto.randomBytes(LARGO_CODIGO);
  for (let i = 0; i < LARGO_CODIGO; i++) {
    codigo += ALFABETO_CODIGO[bytes[i] % ALFABETO_CODIGO.length];
  }
  return codigo;
}

/** Header del CSV (español, export "Rendimiento de campaña" de Meta Ads Manager) -> campo del modelo. */
const MAPEO_COLUMNAS = {
  'inicio del informe': { campo: 'fecha_inicio', tipo: 'fecha' },
  'fin del informe': { campo: 'fecha_fin', tipo: 'fecha' },
  'nombre de la campaña': { campo: 'nombre_campana_meta', tipo: 'texto' },
  'entrega de la campaña': { campo: 'entrega', tipo: 'texto' },
  'presupuesto del conjunto de anuncios': { campo: 'presupuesto', tipo: 'decimal' },
  'tipo de presupuesto del conjunto de anuncios': { campo: 'tipo_presupuesto', tipo: 'texto' },
  'importe gastado (pyg)': { campo: 'importe_gastado', tipo: 'decimal' },
  'resultados': { campo: 'resultados', tipo: 'decimal' },
  'indicador de resultado': { campo: 'indicador_resultado', tipo: 'texto' },
  'costo por resultados': { campo: 'costo_por_resultado', tipo: 'decimal' },
  'alcance': { campo: 'alcance', tipo: 'entero' },
  'impresiones': { campo: 'impresiones', tipo: 'entero' },
  'cpm (costo por mil impresiones) (pyg)': { campo: 'cpm', tipo: 'decimal' },
  'clics en el enlace': { campo: 'clics_enlace', tipo: 'entero' },
  'cpc (costo por clic en el enlace) (pyg)': { campo: 'cpc', tipo: 'decimal' },
  'ctr (porcentaje de clics en el enlace)': { campo: 'ctr', tipo: 'decimal' },
  'visitas a la página de destino': { campo: 'visitas_pagina', tipo: 'entero' },
  'costo por visita a la página de destino (pyg)': { campo: 'costo_por_visita', tipo: 'decimal' },
  'pagos iniciados': { campo: 'pagos_iniciados', tipo: 'entero' },
  'costo por pago iniciado (pyg)': { campo: 'costo_por_pago_iniciado', tipo: 'decimal' },
  'valor de conversión de compras': { campo: 'valor_conversion_compras', tipo: 'decimal' },
  'roas de compras en el sitio web': { campo: 'roas', tipo: 'decimal' },
  'compras': { campo: 'compras', tipo: 'entero' },
  'costo por compra (pyg)': { campo: 'costo_por_compra', tipo: 'decimal' },
  'frecuencia': { campo: 'frecuencia', tipo: 'decimal' },
  'porcentaje de compras por visitas a la página de destino': { campo: 'pct_compra_por_visita', tipo: 'decimal' },
  'porcentaje de visitas a la página de destino por clics en el enlace': { campo: 'pct_visita_por_clic', tipo: 'decimal' },
};

function normalizarHeader(h) {
  return (h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, ''); // quita acentos
}

function parsearNumero(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const limpio = String(valor).replace(/[^0-9.\-]/g, '');
  if (limpio === '' || limpio === '-') return null;
  const n = parseFloat(limpio);
  return Number.isFinite(n) ? n : null;
}

function parsearEntero(valor) {
  const n = parsearNumero(valor);
  return n === null ? null : Math.round(n);
}

/** "1/1/2026" (M/D/YYYY, formato de export de Meta) -> "2026-01-01" */
function parsearFechaMeta(valor) {
  if (!valor) return null;
  const partes = String(valor).trim().split('/');
  if (partes.length !== 3) return null;
  const [mes, dia, anio] = partes.map(p => parseInt(p, 10));
  if (!mes || !dia || !anio) return null;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

class MetaReportesService {
  // ============================================================
  // Campañas internas
  // ============================================================

  static async generarNombreInterno(nombreDisplay, transaction) {
    let codigo;
    let intentos = 0;
    do {
      codigo = generarCodigoAleatorio();
      intentos++;
      if (intentos > 20) throw new Error('No se pudo generar un código único. Reintentá.');
      // eslint-disable-next-line no-await-in-loop
      var existe = await MetaCampanaInterna.findOne({ where: { codigo }, transaction });
    } while (existe);

    const nombreInterno = `[${PREFIJO}-${codigo}] ${nombreDisplay}`.slice(0, 255);
    return { codigo, nombreInterno };
  }

  static async crearCampana(inquilino_id, usuario_id, datos) {
    const { nombre_display, producto_ids = [], landing_id, meta_integration_id, notas, tipo } = datos;

    if (!nombre_display || !nombre_display.trim()) {
      throw new Error('El nombre de la campaña es obligatorio.');
    }
    if (!Array.isArray(producto_ids) || producto_ids.length === 0) {
      throw new Error('Elegí al menos un producto para la campaña.');
    }
    if (tipo !== undefined && !['whatsapp', 'web'].includes(tipo)) {
      throw new Error('El tipo de campaña debe ser "whatsapp" o "web".');
    }

    // Validar que los productos sean del tenant (evita mezclar IDs ajenos)
    const productosValidos = await Producto.findAll({
      where: { id: { [Op.in]: producto_ids }, inquilino_id },
      attributes: ['id'],
    });
    if (productosValidos.length !== producto_ids.length) {
      throw new Error('Uno o más productos seleccionados no son válidos.');
    }

    if (landing_id) {
      const landing = await Landing.findOne({ where: { id: landing_id, inquilino_id } });
      if (!landing) throw new Error('El funnel seleccionado no es válido.');
    }

    if (meta_integration_id) {
      const integracion = await MetaIntegration.findOne({ where: { id: meta_integration_id, inquilino_id, usuario_id } });
      if (!integracion) throw new Error('La cuenta de Meta seleccionada no es válida.');
    }

    return sequelize.transaction(async (t) => {
      const { codigo, nombreInterno } = await this.generarNombreInterno(nombre_display.trim(), t);

      const campana = await MetaCampanaInterna.create({
        inquilino_id,
        usuario_id,
        meta_integration_id: meta_integration_id || null,
        landing_id: landing_id || null,
        producto_ids,
        tipo: tipo || 'web',
        codigo,
        nombre_interno: nombreInterno,
        nombre_display: nombre_display.trim(),
        estado: 'borrador',
        notas: notas || null,
      }, { transaction: t });

      return campana.toJSON();
    });
  }

  static async listarCampanas(inquilino_id, filtros = {}) {
    const where = { inquilino_id };
    if (filtros.usuario_id) where.usuario_id = filtros.usuario_id;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.meta_integration_id) where.meta_integration_id = filtros.meta_integration_id;
    if (filtros.producto_id) {
      // JSON contains — Postgres. producto_ids es un array de enteros.
      where.producto_ids = { [Op.contains]: [parseInt(filtros.producto_id, 10)] };
    }

    const campanas = await MetaCampanaInterna.findAll({
      where,
      include: [{ model: Landing, as: 'funnel', attributes: ['id', 'nombre', 'titulo', 'tipo_pagina'] }],
      order: [['created_at', 'DESC']],
    });

    // Adjuntar datos básicos de los productos (nombre) para no forzar al
    // frontend a cruzar por su cuenta.
    const todosLosIds = [...new Set(campanas.flatMap(c => c.producto_ids || []))];
    const productos = todosLosIds.length
      ? await Producto.findAll({ where: { id: { [Op.in]: todosLosIds }, inquilino_id }, attributes: ['id', 'nombre', 'sku'] })
      : [];
    const mapaProductos = new Map(productos.map(p => [p.id, p.toJSON()]));

    return campanas.map(c => {
      const json = c.toJSON();
      json.productos = (json.producto_ids || []).map(id => mapaProductos.get(id)).filter(Boolean);
      return json;
    });
  }

  static async obtenerCampana(id, inquilino_id) {
    const campana = await MetaCampanaInterna.findOne({
      where: { id, inquilino_id },
      include: [{ model: Landing, as: 'funnel', attributes: ['id', 'nombre', 'titulo', 'tipo_pagina'] }],
    });
    if (!campana) throw new Error('Campaña no encontrada.');
    return campana;
  }

  static async actualizarCampana(id, inquilino_id, datos) {
    const campana = await this.obtenerCampana(id, inquilino_id);

    const permitido = {};
    if (datos.nombre_display !== undefined) permitido.nombre_display = datos.nombre_display.trim();
    if (datos.landing_id !== undefined) permitido.landing_id = datos.landing_id || null;
    if (datos.meta_integration_id !== undefined) permitido.meta_integration_id = datos.meta_integration_id || null;
    if (datos.estado !== undefined) permitido.estado = datos.estado;
    if (datos.notas !== undefined) permitido.notas = datos.notas || null;
    if (datos.tipo !== undefined) {
      if (!['whatsapp', 'web'].includes(datos.tipo)) throw new Error('El tipo de campaña debe ser "whatsapp" o "web".');
      permitido.tipo = datos.tipo;
    }
    if (datos.producto_ids !== undefined) {
      if (!Array.isArray(datos.producto_ids) || datos.producto_ids.length === 0) {
        throw new Error('Elegí al menos un producto para la campaña.');
      }
      const productosValidos = await Producto.findAll({
        where: { id: { [Op.in]: datos.producto_ids }, inquilino_id },
        attributes: ['id'],
      });
      if (productosValidos.length !== datos.producto_ids.length) {
        throw new Error('Uno o más productos seleccionados no son válidos.');
      }
      permitido.producto_ids = datos.producto_ids;
    }
    // codigo y nombre_interno son inmutables a propósito (ver comentario en el modelo).

    await campana.update(permitido);
    return campana.reload();
  }

  static async eliminarCampana(id, inquilino_id) {
    const campana = await this.obtenerCampana(id, inquilino_id);
    const filasVinculadas = await MetaReporteFila.count({ where: { meta_campana_interna_id: id } });
    if (filasVinculadas > 0) {
      throw new Error(`Esta campaña ya tiene ${filasVinculadas} fila(s) de reporte importadas. Archivala en vez de eliminarla para no perder el historial.`);
    }
    await campana.destroy();
  }

  // ============================================================
  // Importación de reportes CSV
  // ============================================================

  static _mapearFila(headers, fila) {
    const resultado = {};
    headers.forEach((headerOriginal) => {
      const key = normalizarHeader(headerOriginal);
      const mapeo = MAPEO_COLUMNAS[key];
      if (!mapeo) return;
      const valorCrudo = fila[headerOriginal];

      if (mapeo.tipo === 'fecha') resultado[mapeo.campo] = parsearFechaMeta(valorCrudo);
      else if (mapeo.tipo === 'entero') resultado[mapeo.campo] = parsearEntero(valorCrudo);
      else if (mapeo.tipo === 'decimal') resultado[mapeo.campo] = parsearNumero(valorCrudo);
      else resultado[mapeo.campo] = valorCrudo || null;
    });
    return resultado;
  }

  /**
   * @param {Buffer} archivoBuffer Contenido crudo del CSV subido.
   * @param {{ inquilino_id, usuario_id, meta_integration_id, nombre_archivo }} contexto
   */
  static async importarCSV(archivoBuffer, contexto) {
    const { inquilino_id, usuario_id, meta_integration_id, nombre_archivo } = contexto;

    const texto = archivoBuffer.toString('utf8');
    const { headers, filas } = parsearCSV(texto);

    if (headers.length === 0 || filas.length === 0) {
      throw new Error('El archivo está vacío o no se pudo leer como CSV.');
    }
    if (!headers.some(h => normalizarHeader(h) === 'nombre de la campaña')) {
      throw new Error('El CSV no tiene la columna "Nombre de la campaña" — ¿es un export de Meta Ads Manager?');
    }

    // Campañas internas del tenant, para matchear por código sin una
    // consulta por fila.
    const campanas = await MetaCampanaInterna.findAll({ where: { inquilino_id }, attributes: ['id', 'codigo'] });
    const mapaCodigoCampana = new Map(campanas.map(c => [c.codigo.toUpperCase(), c.id]));

    let matcheadas = 0;
    let sinMatch = 0;
    let fechaMin = null;
    let fechaMax = null;

    const filasParaInsertar = filas.map((fila) => {
      const mapeada = this._mapearFila(headers, fila);
      const nombreCampanaMeta = (fila['Nombre de la campaña'] || '').trim();

      const match = nombreCampanaMeta.match(REGEX_CODIGO);
      const codigoMatcheado = match ? match[1].toUpperCase() : null;
      const campanaInternaId = codigoMatcheado ? (mapaCodigoCampana.get(codigoMatcheado) || null) : null;

      if (campanaInternaId) matcheadas++; else sinMatch++;

      if (mapeada.fecha_inicio && (!fechaMin || mapeada.fecha_inicio < fechaMin)) fechaMin = mapeada.fecha_inicio;
      if (mapeada.fecha_fin && (!fechaMax || mapeada.fecha_fin > fechaMax)) fechaMax = mapeada.fecha_fin;

      return {
        inquilino_id,
        nombre_campana_meta: nombreCampanaMeta,
        codigo_matcheado: codigoMatcheado,
        meta_campana_interna_id: campanaInternaId,
        datos_crudos: fila,
        ...mapeada,
      };
    });

    return sequelize.transaction(async (t) => {
      const importacion = await MetaReporteImport.create({
        inquilino_id,
        usuario_id,
        meta_integration_id: meta_integration_id || null,
        nombre_archivo,
        fecha_inicio_reporte: fechaMin,
        fecha_fin_reporte: fechaMax,
        filas_totales: filas.length,
        filas_matcheadas: matcheadas,
        filas_sin_match: sinMatch,
      }, { transaction: t });

      await MetaReporteFila.bulkCreate(
        filasParaInsertar.map(f => ({ ...f, meta_reporte_import_id: importacion.id })),
        { transaction: t },
      );

      return {
        importacion: importacion.toJSON(),
        resumen: { total: filas.length, matcheadas, sin_match: sinMatch },
      };
    });
  }

  static async listarImportaciones(inquilino_id) {
    return MetaReporteImport.findAll({ where: { inquilino_id }, order: [['created_at', 'DESC']] });
  }

  static async eliminarImportacion(id, inquilino_id) {
    const importacion = await MetaReporteImport.findOne({ where: { id, inquilino_id } });
    if (!importacion) throw new Error('Importación no encontrada.');
    await importacion.destroy(); // CASCADE se lleva puestas sus filas (ver models/index.js)
  }

  // ============================================================
  // Consulta de filas / métricas
  // ============================================================

  static async listarFilas(inquilino_id, filtros = {}) {
    const where = { inquilino_id };
    if (filtros.meta_reporte_import_id) where.meta_reporte_import_id = filtros.meta_reporte_import_id;
    if (filtros.meta_campana_interna_id) where.meta_campana_interna_id = filtros.meta_campana_interna_id;
    // filtros viene de req.query en la mayoría de los casos (todo string), así que hay que aceptar 'true' además de true.
    if (filtros.sin_vincular === true || filtros.sin_vincular === 'true') where.meta_campana_interna_id = null;
    if (filtros.desde || filtros.hasta) {
      where.fecha_inicio = {};
      if (filtros.desde) where.fecha_inicio[Op.gte] = filtros.desde;
      if (filtros.hasta) where.fecha_inicio[Op.lte] = filtros.hasta;
    }

    const pagina = Math.max(1, parseInt(filtros.pagina, 10) || 1);
    const limite = Math.min(200, parseInt(filtros.limite, 10) || 50);

    let productoId = filtros.producto_id ? parseInt(filtros.producto_id, 10) : null;
    let campanaIdsPorProducto = null;
    if (productoId) {
      const campanasDelProducto = await MetaCampanaInterna.findAll({
        where: { inquilino_id, producto_ids: { [Op.contains]: [productoId] } },
        attributes: ['id'],
      });
      campanaIdsPorProducto = campanasDelProducto.map(c => c.id);
      where.meta_campana_interna_id = { [Op.in]: campanaIdsPorProducto.length ? campanaIdsPorProducto : [-1] };
    }

    const { rows, count } = await MetaReporteFila.findAndCountAll({
      where,
      include: [{ model: MetaCampanaInterna, as: 'campana', attributes: ['id', 'nombre_display', 'nombre_interno', 'codigo', 'producto_ids', 'estado', 'landing_id'] }],
      order: [['fecha_inicio', 'DESC'], ['id', 'DESC']],
      limit: limite,
      offset: (pagina - 1) * limite,
    });

    return {
      total: count,
      pagina,
      total_paginas: Math.ceil(count / limite),
      filas: rows.map(r => r.toJSON()),
    };
  }

  static async vincularFilaManual(filaId, inquilino_id, meta_campana_interna_id) {
    const fila = await MetaReporteFila.findOne({ where: { id: filaId, inquilino_id } });
    if (!fila) throw new Error('Fila de reporte no encontrada.');

    if (meta_campana_interna_id) {
      const campana = await MetaCampanaInterna.findOne({ where: { id: meta_campana_interna_id, inquilino_id } });
      if (!campana) throw new Error('Campaña interna no válida.');
    }

    await fila.update({ meta_campana_interna_id: meta_campana_interna_id || null });
    return fila;
  }

  /** Agregado de métricas por producto. Si una campaña cubre varios
   * productos, cada uno de esos productos recibe el 100% de las
   * métricas de esa campaña (no se prorratea el gasto). */
  static async metricasPorProducto(inquilino_id, filtros = {}) {
    const whereFilas = { inquilino_id };
    if (filtros.desde || filtros.hasta) {
      whereFilas.fecha_inicio = {};
      if (filtros.desde) whereFilas.fecha_inicio[Op.gte] = filtros.desde;
      if (filtros.hasta) whereFilas.fecha_inicio[Op.lte] = filtros.hasta;
    }

    const filas = await MetaReporteFila.findAll({
      where: { ...whereFilas, meta_campana_interna_id: { [Op.ne]: null } },
      include: [{ model: MetaCampanaInterna, as: 'campana', attributes: ['id', 'producto_ids', 'nombre_display'] }],
    });

    const acumPorProducto = new Map();
    for (const filaModel of filas) {
      const fila = filaModel.toJSON();
      const productoIds = fila.campana?.producto_ids || [];
      for (const productoId of productoIds) {
        if (!acumPorProducto.has(productoId)) {
          acumPorProducto.set(productoId, {
            producto_id: productoId,
            gasto: 0, compras: 0, valor_conversion: 0, impresiones: 0,
            clics_enlace: 0, alcance: 0, campanas: new Set(),
          });
        }
        const acc = acumPorProducto.get(productoId);
        acc.gasto += Number(fila.importe_gastado) || 0;
        acc.compras += Number(fila.compras) || 0;
        acc.valor_conversion += Number(fila.valor_conversion_compras) || 0;
        acc.impresiones += Number(fila.impresiones) || 0;
        acc.clics_enlace += Number(fila.clics_enlace) || 0;
        acc.alcance += Number(fila.alcance) || 0;
        acc.campanas.add(fila.campana.id);
      }
    }

    const productoIds = [...acumPorProducto.keys()];
    const productos = productoIds.length
      ? await Producto.findAll({ where: { id: { [Op.in]: productoIds }, inquilino_id }, attributes: ['id', 'nombre', 'sku'] })
      : [];
    const mapaProductos = new Map(productos.map(p => [p.id, p.toJSON()]));

    return [...acumPorProducto.values()].map(acc => ({
      producto_id: acc.producto_id,
      producto: mapaProductos.get(acc.producto_id) || null,
      gasto: acc.gasto,
      compras: acc.compras,
      valor_conversion: acc.valor_conversion,
      roas: acc.gasto > 0 ? acc.valor_conversion / acc.gasto : 0,
      costo_por_compra: acc.compras > 0 ? acc.gasto / acc.compras : 0,
      impresiones: acc.impresiones,
      clics_enlace: acc.clics_enlace,
      alcance: acc.alcance,
      cantidad_campanas: acc.campanas.size,
    })).sort((a, b) => b.gasto - a.gasto);
  }
}

module.exports = MetaReportesService;
