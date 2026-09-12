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
  LandingTemplate,
  Producto,
  Envio,
  EnvioItem,
} = require('../models');
const { parsearCSV } = require('../utils/csvParser');

// Gasto de Ads en Paraguay se reporta sin IVA en el export de Meta —
// se aplica acá el mismo ajuste que ya usaba la planilla manual del
// usuario para que el CPA refleje el costo real.
const MULTIPLICADOR_IVA = 1.1;

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L) para que el código sea
// fácil de leer/tipear cuando el usuario lo pega a mano en Meta Ads Manager.
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 6;
const PREFIJO = 'GSC';

// Matchea "[GSC-A3F9K1]" en cualquier parte del nombre de campaña.
const REGEX_CODIGO = /\[GSC-([A-Z0-9]{4,10})\]/i;

// Paginación de las consultas de reportes. Las vistas de Ads & Campañas
// muestran 10 por página: son tablas anchas, y con más filas la pantalla
// deja de leerse de un vistazo.
const LIMITE_POR_DEFECTO = 10;
const LIMITE_MAXIMO = 100;

/** Escapa los comodines de LIKE en un texto que viene del usuario. */
function escaparLike(texto) {
  return String(texto).trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

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
  'nombre de la campana': { campo: 'nombre_campana_meta', tipo: 'texto' },
  'entrega de la campana': { campo: 'entrega', tipo: 'texto' },
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
  'visitas a la pagina de destino': { campo: 'visitas_pagina', tipo: 'entero' },
  'costo por visita a la pagina de destino (pyg)': { campo: 'costo_por_visita', tipo: 'decimal' },
  'pagos iniciados': { campo: 'pagos_iniciados', tipo: 'entero' },
  'costo por pago iniciado (pyg)': { campo: 'costo_por_pago_iniciado', tipo: 'decimal' },
  'valor de conversion de compras': { campo: 'valor_conversion_compras', tipo: 'decimal' },
  'roas de compras en el sitio web': { campo: 'roas', tipo: 'decimal' },
  'compras': { campo: 'compras', tipo: 'entero' },
  'costo por compra (pyg)': { campo: 'costo_por_compra', tipo: 'decimal' },
  'frecuencia': { campo: 'frecuencia', tipo: 'decimal' },
  'porcentaje de compras por visitas a la pagina de destino': { campo: 'pct_compra_por_visita', tipo: 'decimal' },
  'porcentaje de visitas a la pagina de destino por clics en el enlace': { campo: 'pct_visita_por_clic', tipo: 'decimal' },
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
  // El export de Meta en PYG viene sin IVA. Lo consume también el dashboard
  // de rentabilidad, que tiene que mostrar el MISMO gasto que esta sección.
  static get MULTIPLICADOR_IVA() { return MULTIPLICADOR_IVA; }

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

  static async listarCampanas(inquilino_id, usuario_id, filtros = {}) {
    // Cada usuario ve únicamente sus propias campañas — nunca se confía en
    // un usuario_id que venga por query string (cualquiera podría pedir el
    // de otra cuenta). Ver bug real: el dashboard de una tienda recién
    // creada mostraba gasto de Ads de otra tienda del mismo tenant.
    const where = { inquilino_id, usuario_id };
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.meta_integration_id) where.meta_integration_id = filtros.meta_integration_id;
    if (filtros.producto_id) {
      // JSON contains — Postgres. producto_ids es un array de enteros.
      where.producto_ids = { [Op.contains]: [parseInt(filtros.producto_id, 10)] };
    }

    const campanas = await MetaCampanaInterna.findAll({
      where,
      include: [{
        model: Landing,
        as: 'funnel',
        attributes: ['id', 'nombre', 'titulo', 'slug', 'tipo_pagina'],
        // Se conserva la relación con Landing para campañas antiguas; las
        // campañas nuevas ya no crean ni editan embudos desde Meta Ads.
        include: [{ model: LandingTemplate, as: 'template', attributes: ['kind'] }],
      }],
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

  static async obtenerCampana(id, inquilino_id, usuario_id) {
    const campana = await MetaCampanaInterna.findOne({
      where: { id, inquilino_id, usuario_id },
      include: [{
        model: Landing,
        as: 'funnel',
        attributes: ['id', 'nombre', 'titulo', 'slug', 'tipo_pagina'],
        // Se conserva la relación con Landing para campañas antiguas; las
        // campañas nuevas ya no crean ni editan embudos desde Meta Ads.
        include: [{ model: LandingTemplate, as: 'template', attributes: ['kind'] }],
      }],
    });
    if (!campana) throw new Error('Campaña no encontrada.');
    return campana;
  }

  static async actualizarCampana(id, inquilino_id, usuario_id, datos) {
    const campana = await this.obtenerCampana(id, inquilino_id, usuario_id);

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

  static async eliminarCampana(id, inquilino_id, usuario_id) {
    const campana = await this.obtenerCampana(id, inquilino_id, usuario_id);
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
   * Columnas del export que, si faltan, dejan métricas enteras en cero.
   * No se rechaza el archivo por esto: se avisa antes de importar.
   */
  static get COLUMNAS_CLAVE() {
    return [
      { header: 'importe gastado (pyg)', label: 'Importe gastado', consecuencia: 'el gasto y todos los CPA quedan en cero' },
      { header: 'compras', label: 'Compras', consecuencia: 'no se puede calcular CPA ni tasa de conversión' },
      { header: 'valor de conversion de compras', label: 'Valor de conversión de compras', consecuencia: 'el ROAS queda en cero' },
      { header: 'impresiones', label: 'Impresiones', consecuencia: 'sin CPM ni CTR' },
      { header: 'clics en el enlace', label: 'Clics en el enlace', consecuencia: 'sin CTR ni CPC' },
    ];
  }

  /** Lee el CSV y valida que sea un export de Meta usable. */
  static _leerCSV(archivoBuffer) {
    const texto = archivoBuffer.toString('utf8');
    const { headers, filas } = parsearCSV(texto);

    if (headers.length === 0 || filas.length === 0) {
      throw new Error('El archivo está vacío o no se pudo leer como CSV.');
    }
    if (!headers.some(h => normalizarHeader(h) === 'nombre de la campana')) {
      throw new Error('El CSV no tiene la columna "Nombre de la campaña" — ¿es un export de Meta Ads Manager?');
    }

    return { headers, filas };
  }

  /**
   * Mapea las filas del CSV a filas de `meta_reporte_filas` y resuelve a
   * qué campaña interna va cada una.
   *
   * Dos caminos de vínculo, en este orden:
   *  1. Código [GSC-XXXX] en el nombre de la campaña de Meta — exacto.
   *  2. `relaciones`: lo que el usuario eligió a mano en el paso de
   *     revisión del asistente de importación, indexado por nombre de
   *     campaña de Meta. Solo se aplica a las que NO matchearon por
   *     código, así que nunca puede pisar un vínculo exacto.
   *
   * Lo usan tanto el análisis previo (sin escribir nada) como la
   * importación real, para que lo que se muestra en la revisión sea
   * exactamente lo que después se guarda.
   */
  static async _prepararFilas(inquilino_id, usuario_id, headers, filas, relaciones = {}) {
    // Solo se matchea contra las campañas del propio usuario: si no, un CSV
    // con un código que por azar (o a propósito) coincide con el de otra
    // cuenta terminaría vinculando la fila importada a una campaña ajena,
    // filtrando su nombre/productos a través del listado de filas.
    const campanas = await MetaCampanaInterna.findAll({
      where: { inquilino_id, usuario_id },
      attributes: ['id', 'codigo', 'nombre_display'],
    });
    const mapaCodigo = new Map(campanas.map(c => [c.codigo.toUpperCase(), c.id]));
    const mapaNombre = new Map(campanas.map(c => [c.id, c.nombre_display]));

    // Solo se aceptan ids de campaña del propio tenant: `relaciones` viene
    // del cliente y no se confía en él.
    const relacionesValidas = new Map();
    for (const [nombreMeta, campanaId] of Object.entries(relaciones || {})) {
      const id = parseInt(campanaId, 10);
      if (Number.isInteger(id) && mapaNombre.has(id)) relacionesValidas.set(nombreMeta, id);
    }

    let matcheadas = 0;
    let porRelacionManual = 0;
    let sinMatch = 0;
    let fechaMin = null;
    let fechaMax = null;

    // Agrupado por nombre de campaña de Meta: es la unidad con la que el
    // usuario decide en el paso de revisión (no la fila suelta).
    const porCampanaMeta = new Map();

    const filasParaInsertar = filas.map((fila) => {
      const mapeada = MetaReportesService._mapearFila(headers, fila);
      const nombreCampanaMeta = (fila['Nombre de la campaña'] || '').trim();

      const match = nombreCampanaMeta.match(REGEX_CODIGO);
      const codigoMatcheado = match ? match[1].toUpperCase() : null;
      const idPorCodigo = codigoMatcheado ? (mapaCodigo.get(codigoMatcheado) || null) : null;
      const idManual = idPorCodigo ? null : (relacionesValidas.get(nombreCampanaMeta) || null);
      const campanaInternaId = idPorCodigo || idManual;

      if (idPorCodigo) matcheadas++;
      else if (idManual) { matcheadas++; porRelacionManual++; }
      else sinMatch++;

      if (mapeada.fecha_inicio && (!fechaMin || mapeada.fecha_inicio < fechaMin)) fechaMin = mapeada.fecha_inicio;
      if (mapeada.fecha_fin && (!fechaMax || mapeada.fecha_fin > fechaMax)) fechaMax = mapeada.fecha_fin;

      if (!porCampanaMeta.has(nombreCampanaMeta)) {
        porCampanaMeta.set(nombreCampanaMeta, {
          nombre_campana_meta: nombreCampanaMeta,
          filas: 0,
          gasto: 0,
          compras: 0,
          codigo: codigoMatcheado,
          origen: idPorCodigo ? 'codigo' : (idManual ? 'manual' : null),
          campana_id: campanaInternaId,
          campana_nombre: campanaInternaId ? (mapaNombre.get(campanaInternaId) || null) : null,
          fecha_inicio: mapeada.fecha_inicio || null,
          fecha_fin: mapeada.fecha_fin || null,
        });
      }
      const grupo = porCampanaMeta.get(nombreCampanaMeta);
      grupo.filas += 1;
      grupo.gasto += (Number(mapeada.importe_gastado) || 0) * MULTIPLICADOR_IVA;
      grupo.compras += Number(mapeada.compras) || 0;
      if (mapeada.fecha_inicio && (!grupo.fecha_inicio || mapeada.fecha_inicio < grupo.fecha_inicio)) grupo.fecha_inicio = mapeada.fecha_inicio;
      if (mapeada.fecha_fin && (!grupo.fecha_fin || mapeada.fecha_fin > grupo.fecha_fin)) grupo.fecha_fin = mapeada.fecha_fin;

      return {
        inquilino_id,
        nombre_campana_meta: nombreCampanaMeta,
        codigo_matcheado: codigoMatcheado,
        meta_campana_interna_id: campanaInternaId,
        datos_crudos: fila,
        ...mapeada,
      };
    });

    return {
      filasParaInsertar,
      matcheadas,
      sinMatch,
      porRelacionManual,
      fechaMin,
      fechaMax,
      campanasDetectadas: [...porCampanaMeta.values()].sort((a, b) => b.gasto - a.gasto),
    };
  }

  /**
   * Análisis previo del CSV: lee, valida y muestra qué se va a importar y
   * a qué campaña iría cada dato — SIN escribir nada en la base.
   *
   * Es el paso 2-3 del asistente de importación. Corre exactamente el
   * mismo `_prepararFilas` que la importación real, así que lo que el
   * usuario revisa es lo que después se guarda.
   */
  static async analizarCSV(archivoBuffer, contexto) {
    const { inquilino_id, usuario_id, nombre_archivo } = contexto;
    const { headers, filas } = MetaReportesService._leerCSV(archivoBuffer);
    const preparado = await MetaReportesService._prepararFilas(inquilino_id, usuario_id, headers, filas);

    const reconocidas = [];
    const noReconocidas = [];
    for (const header of headers) {
      if (MAPEO_COLUMNAS[normalizarHeader(header)]) reconocidas.push(header);
      else noReconocidas.push(header);
    }

    const presentes = new Set(headers.map(normalizarHeader));
    const faltantes = MetaReportesService.COLUMNAS_CLAVE
      .filter(c => !presentes.has(c.header))
      .map(({ label, consecuencia }) => ({ label, consecuencia }));

    return {
      archivo: { nombre_archivo, filas_totales: filas.length },
      periodo: { fecha_inicio: preparado.fechaMin, fecha_fin: preparado.fechaMax },
      columnas: { reconocidas, no_reconocidas: noReconocidas, faltantes },
      campanas_detectadas: preparado.campanasDetectadas,
      resumen: {
        total: filas.length,
        matcheadas: preparado.matcheadas,
        sin_match: preparado.sinMatch,
        campanas: preparado.campanasDetectadas.length,
        campanas_sin_match: preparado.campanasDetectadas.filter(c => !c.campana_id).length,
      },
    };
  }

  /**
   * @param {Buffer} archivoBuffer Contenido crudo del CSV subido.
   * @param {{ inquilino_id, usuario_id, meta_integration_id, nombre_archivo, relaciones }} contexto
   *        `relaciones` es opcional: { "nombre de campaña en Meta": id_campana_interna },
   *        lo que el usuario decidió en la revisión previa.
   */
  static async importarCSV(archivoBuffer, contexto) {
    const { inquilino_id, usuario_id, meta_integration_id, nombre_archivo, relaciones } = contexto;

    const { headers, filas } = MetaReportesService._leerCSV(archivoBuffer);
    const preparado = await MetaReportesService._prepararFilas(inquilino_id, usuario_id, headers, filas, relaciones);

    return sequelize.transaction(async (t) => {
      const importacion = await MetaReporteImport.create({
        inquilino_id,
        usuario_id,
        meta_integration_id: meta_integration_id || null,
        nombre_archivo,
        fecha_inicio_reporte: preparado.fechaMin,
        fecha_fin_reporte: preparado.fechaMax,
        filas_totales: filas.length,
        filas_matcheadas: preparado.matcheadas,
        filas_sin_match: preparado.sinMatch,
      }, { transaction: t });

      await MetaReporteFila.bulkCreate(
        preparado.filasParaInsertar.map(f => ({ ...f, meta_reporte_import_id: importacion.id })),
        { transaction: t },
      );

      return {
        importacion: importacion.toJSON(),
        resumen: {
          total: filas.length,
          matcheadas: preparado.matcheadas,
          sin_match: preparado.sinMatch,
          por_relacion_manual: preparado.porRelacionManual,
        },
      };
    });
  }

  /**
   * Paginación de una consulta. Los filtros llegan por POST (body JSON),
   * así que los tipos son reales — se sigue tolerando el string por si
   * alguien la llama con query params.
   */
  static _paginacion(filtros = {}) {
    const pagina = Math.max(1, parseInt(filtros.pagina ?? filtros.page, 10) || 1);
    const pedido = parseInt(filtros.limite ?? filtros.page_size, 10);
    const limite = Math.min(LIMITE_MAXIMO, Math.max(1, pedido || LIMITE_POR_DEFECTO));
    return { pagina, limite, offset: (pagina - 1) * limite };
  }

  /**
   * Orden validado contra una lista blanca. El campo lo elige el cliente,
   * así que NUNCA se interpola directo en el ORDER BY: si no está en la
   * lista, se usa el orden por defecto.
   */
  static _orden(filtros = {}, permitidos = [], porDefecto = { campo: 'id', direccion: 'DESC' }) {
    const pedido = filtros.orden || {};
    const campo = permitidos.includes(pedido.campo) ? pedido.campo : porDefecto.campo;
    const dir = String(pedido.direccion || '').toUpperCase();
    const direccion = dir === 'ASC' || dir === 'DESC' ? dir : porDefecto.direccion;
    return { campo, direccion };
  }

  /** Un booleano que puede venir como boolean real (POST) o como string. */
  static _bandera(valor) {
    return valor === true || valor === 'true';
  }

  static get ORDEN_IMPORTACIONES() {
    return ['created_at', 'nombre_archivo', 'filas_totales', 'filas_sin_match', 'fecha_inicio_reporte'];
  }

  /**
   * Historial de reportes importados, paginado y filtrable.
   *
   * Filtros: `busqueda` (nombre del archivo), `fecha_desde`/`fecha_hasta`
   * (por solapamiento con el período del informe), `estado`
   * ('con_pendientes' | 'completo') y `orden`.
   */
  static async listarImportaciones(inquilino_id, usuario_id, filtros = {}) {
    const where = { inquilino_id, usuario_id };

    if (filtros.busqueda && String(filtros.busqueda).trim()) {
      where.nombre_archivo = { [Op.iLike]: `%${escaparLike(filtros.busqueda)}%` };
    }

    // Mismo criterio de solapamiento que las filas: un reporte cuenta para
    // el período si su informe lo toca, aunque no lo cubra entero.
    if (filtros.fecha_desde) where.fecha_fin_reporte = { [Op.gte]: filtros.fecha_desde };
    if (filtros.fecha_hasta) where.fecha_inicio_reporte = { [Op.lte]: filtros.fecha_hasta };

    if (filtros.estado === 'con_pendientes') where.filas_sin_match = { [Op.gt]: 0 };
    else if (filtros.estado === 'completo') where.filas_sin_match = 0;

    const { pagina, limite, offset } = MetaReportesService._paginacion(filtros);
    const orden = MetaReportesService._orden(
      filtros, MetaReportesService.ORDEN_IMPORTACIONES, { campo: 'created_at', direccion: 'DESC' },
    );

    const { rows, count } = await MetaReporteImport.findAndCountAll({
      where,
      order: [[orden.campo, orden.direccion], ['id', 'DESC']],
      limit: limite,
      offset,
    });

    return {
      total: count,
      pagina,
      limite,
      total_paginas: Math.max(1, Math.ceil(count / limite)),
      orden,
      importaciones: rows.map(r => r.toJSON()),
    };
  }

  static async eliminarImportacion(id, inquilino_id, usuario_id) {
    const importacion = await MetaReporteImport.findOne({ where: { id, inquilino_id, usuario_id } });
    if (!importacion) throw new Error('Importación no encontrada.');
    await importacion.destroy(); // CASCADE se lleva puestas sus filas (ver models/index.js)
  }

  // ============================================================
  // Consulta de filas / métricas
  // ============================================================

  static get ORDEN_FILAS() {
    return [
      'fecha_inicio', 'fecha_fin', 'nombre_campana_meta', 'importe_gastado',
      'compras', 'roas', 'clics_enlace', 'ctr', 'impresiones', 'alcance',
    ];
  }

  /**
   * Filas de reporte, paginadas y filtrables.
   *
   * Filtros: `busqueda` (nombre de la campaña en Meta), `estado_vinculo`
   * ('vinculadas' | 'sin_vincular' | 'todas'), `meta_reporte_import_id`,
   * `meta_campana_interna_id`, `producto_id`, `desde`/`hasta` y `orden`.
   *
   * `estado_vinculo: 'vinculadas'` existe para que la pestaña
   * "Relacionadas" no tenga que traer una página mezclada y descartar a
   * mano las que siguen sin vincular — con eso el total que se muestra
   * sería el de las dos cosas juntas.
   */
  static async listarFilas(inquilino_id, usuario_id, filtros = {}) {
    const where = { inquilino_id };
    if (filtros.meta_reporte_import_id) where.meta_reporte_import_id = filtros.meta_reporte_import_id;
    if (filtros.meta_campana_interna_id) where.meta_campana_interna_id = filtros.meta_campana_interna_id;

    // `sin_vincular` es la forma vieja del filtro; se sigue aceptando.
    const estadoVinculo = filtros.estado_vinculo
      || (MetaReportesService._bandera(filtros.sin_vincular) ? 'sin_vincular' : null);
    if (estadoVinculo === 'sin_vincular') where.meta_campana_interna_id = null;
    else if (estadoVinculo === 'vinculadas') where.meta_campana_interna_id = { [Op.ne]: null };

    if (filtros.busqueda && String(filtros.busqueda).trim()) {
      where.nombre_campana_meta = { [Op.iLike]: `%${escaparLike(filtros.busqueda)}%` };
    }

    if (filtros.desde || filtros.hasta) {
      where.fecha_inicio = {};
      if (filtros.desde) where.fecha_inicio[Op.gte] = filtros.desde;
      if (filtros.hasta) where.fecha_inicio[Op.lte] = filtros.hasta;
    }

    const productoId = filtros.producto_id ? parseInt(filtros.producto_id, 10) : null;
    if (productoId) {
      const campanasDelProducto = await MetaCampanaInterna.findAll({
        where: { inquilino_id, usuario_id, producto_ids: { [Op.contains]: [productoId] } },
        attributes: ['id'],
      });
      const ids = campanasDelProducto.map(c => c.id);
      where.meta_campana_interna_id = { [Op.in]: ids.length ? ids : [-1] };
    }

    const { pagina, limite, offset } = MetaReportesService._paginacion(filtros);
    const orden = MetaReportesService._orden(
      filtros, MetaReportesService.ORDEN_FILAS, { campo: 'fecha_inicio', direccion: 'DESC' },
    );

    const { rows, count } = await MetaReporteFila.findAndCountAll({
      where,
      include: [
        { model: MetaCampanaInterna, as: 'campana', attributes: ['id', 'nombre_display', 'nombre_interno', 'codigo', 'producto_ids', 'estado', 'landing_id'] },
        // Cada fila pertenece a la importación de un usuario — nunca se
        // devuelven filas de otra cuenta del mismo tenant.
        { model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true },
      ],
      // NULLS LAST: ordenar por una métrica que muchas filas no traen
      // dejaría los huecos arriba y taparía justo lo que se quiere ver.
      // El campo ya pasó por la lista blanca de _orden, y el quoting lo
      // resuelve Sequelize (no se arma SQL a mano).
      order: [[orden.campo, `${orden.direccion} NULLS LAST`], ['id', 'DESC']],
      limit: limite,
      offset,
    });

    return {
      total: count,
      pagina,
      limite,
      total_paginas: Math.max(1, Math.ceil(count / limite)),
      orden,
      estado_vinculo: estadoVinculo || 'todas',
      filas: rows.map(r => r.toJSON()),
    };
  }

  static async vincularFilaManual(filaId, inquilino_id, usuario_id, meta_campana_interna_id) {
    const fila = await MetaReporteFila.findOne({
      where: { id: filaId, inquilino_id },
      include: [{ model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true }],
    });
    if (!fila) throw new Error('Fila de reporte no encontrada.');

    if (meta_campana_interna_id) {
      const campana = await MetaCampanaInterna.findOne({ where: { id: meta_campana_interna_id, inquilino_id, usuario_id } });
      if (!campana) throw new Error('Campaña interna no válida.');
    }

    await fila.update({ meta_campana_interna_id: meta_campana_interna_id || null });
    return fila;
  }

  /**
   * Agregado de métricas por producto — cruza el gasto de Meta Ads
   * (importado vía CSV) con los pedidos reales del módulo de Envíos
   * (Courier), para llegar al mismo tipo de P&L que el usuario ya
   * llevaba a mano: CPA, tasa de confirmación, tasa de entrega, costo
   * de producto/envío, facturación y utilidad bruta — todo por producto.
   *
   * Decisiones de negocio (confirmadas con el usuario, no inventadas):
   *  - Gasto de Ads se multiplica por MULTIPLICADOR_IVA antes de calcular
   *    cualquier CPA (el export de Meta no incluye IVA).
   *  - Pedidos/Confirmados/Entregados salen de TODOS los Envíos que
   *    incluyen el producto en el rango de fechas, sin importar si están
   *    vinculados a una campaña específica — el campo Envio.campaign_name
   *    es texto libre tipeado a mano y hoy no se puede usar como join
   *    confiable. Si se filtra por `campana_id`, ese filtro solo acota
   *    el gasto de Ads (a esa campaña puntual); confirmados/entregados
   *    siguen siendo los del producto completo en el período.
   *  - Costo del Producto = Producto.precio_costo (estático, no snapshot
   *    histórico). Precio de Venta = facturación real / unidades
   *    entregadas (promedio ponderado). Costo de Envío = promedio de
   *    Envio.costo_envio entre los envíos entregados que incluyen el
   *    producto (no se prorratea entre productos de un mismo envío).
   *  - Si una campaña cubre varios productos, cada producto recibe el
   *    100% del gasto de esa campaña (no se prorratea).
   *  - Envio es privado por usuario_id (cada cuenta ve solo sus propios
   *    pedidos, nunca los de otra cuenta del mismo tenant) — mismo
   *    criterio que pedidosAnalyticsService.getAnalyticsCompleto.
   */
  static get ORDEN_METRICAS() {
    return [
      'nombre', 'gasto_ads', 'pedidos', 'cpa', 'confirmados', 'pct_confirmacion',
      'entregados', 'pct_entrega', 'facturacion', 'utilidad_bruta', 'margen_bruto',
    ];
  }

  static async metricasPorProducto(inquilino_id, usuario_id, filtros = {}) {
    const { pagina, limite, offset } = MetaReportesService._paginacion(filtros);
    const { fecha_desde, fecha_hasta } = filtros;
    const orden = MetaReportesService._orden(
      filtros, MetaReportesService.ORDEN_METRICAS, { campo: 'nombre', direccion: 'ASC' },
    );

    // 1. Resolver el set de productos objetivo (filtros de producto/campaña + paginación)
    let campanaFiltro = null;
    if (filtros.campana_id) {
      campanaFiltro = await MetaCampanaInterna.findOne({ where: { id: filtros.campana_id, inquilino_id, usuario_id } });
      if (!campanaFiltro) throw new Error('Campaña no encontrada.');
    }

    const soloConGasto = filtros.solo_con_gasto !== false && filtros.solo_con_gasto !== 'false';
    const import_id = filtros.import_id || null;
    const idsForzados = await MetaReportesService._resolverIdsProducto(
      inquilino_id, usuario_id, { ...filtros, import_id, solo_con_gasto: soloConGasto }, campanaFiltro,
    );

    const whereProducto = idsForzados
      ? { id: { [Op.in]: idsForzados.length ? idsForzados : [-1] }, inquilino_id }
      : { inquilino_id, activo: true };

    if (filtros.busqueda && String(filtros.busqueda).trim()) {
      const patron = `%${escaparLike(filtros.busqueda)}%`;
      whereProducto[Op.or] = [{ nombre: { [Op.iLike]: patron } }, { sku: { [Op.iLike]: patron } }];
    }

    // Todas las métricas menos el nombre son CALCULADAS (cruzan gasto de
    // Ads con pedidos), así que no se pueden ordenar en SQL: hay que
    // calcularlas para todo el set y recién después paginar. Eso solo es
    // viable si el set está acotado — con el catálogo completo se ordena
    // por nombre y la respuesta lo aclara en `orden`.
    const puedeOrdenarCalculado = Boolean(idsForzados);
    const ordenarEnMemoria = orden.campo !== 'nombre' && puedeOrdenarCalculado;
    const ordenAplicado = (orden.campo !== 'nombre' && !puedeOrdenarCalculado)
      ? { campo: 'nombre', direccion: 'ASC', motivo: 'ordenar por una métrica calculada requiere acotar los productos' }
      : orden;

    const attributes = ['id', 'nombre', 'sku', 'precio_costo', 'precio_base'];
    const ordenNombre = [['nombre', ordenAplicado.campo === 'nombre' ? ordenAplicado.direccion : 'ASC']];

    let productosObjetivo, total, yaPaginado;
    if (ordenarEnMemoria) {
      productosObjetivo = await Producto.findAll({ where: whereProducto, attributes, order: ordenNombre });
      total = productosObjetivo.length;
      yaPaginado = false;
    } else if (idsForzados) {
      const todos = await Producto.findAll({ where: whereProducto, attributes, order: ordenNombre });
      total = todos.length;
      productosObjetivo = todos.slice(offset, offset + limite);
      yaPaginado = true;
    } else {
      const { rows, count } = await Producto.findAndCountAll({
        where: whereProducto, attributes, order: ordenNombre, limit: limite, offset,
      });
      productosObjetivo = rows;
      total = count;
      yaPaginado = true;
    }

    const base = {
      total,
      pagina,
      limite,
      total_paginas: Math.max(1, Math.ceil(total / limite)),
      orden: ordenAplicado,
      solo_con_gasto: soloConGasto,
    };
    if (productosObjetivo.length === 0) return { productos: [], ...base };

    let productos = await MetaReportesService._calcularMetricasProductos(inquilino_id, usuario_id, {
      productos: productosObjetivo, campanaFiltro, fecha_desde, fecha_hasta, import_id,
    });

    if (!yaPaginado) {
      const signo = ordenAplicado.direccion === 'ASC' ? 1 : -1;
      productos.sort((a, b) => ((Number(a[ordenAplicado.campo]) || 0) - (Number(b[ordenAplicado.campo]) || 0)) * signo);
      productos = productos.slice(offset, offset + limite);
    }

    return { productos, ...base };
  }

  /**
   * Universo de productos de la tabla de métricas. Devuelve `null` para
   * decir "todos los productos activos del tenant" (el caso que se pagina
   * en base de datos), o un array explícito de ids.
   *
   * Por defecto se acota a los productos con gasto de Ads en el período:
   * paginar sobre el catálogo completo llenaba la tabla de filas en cero
   * (un tenant con 294 productos activos y un puñado de campañas veía 25
   * páginas casi todas vacías). `solo_con_gasto=false` recupera el
   * comportamiento anterior para quien quiera revisar el catálogo entero.
   */
  static async _resolverIdsProducto(inquilino_id, usuario_id, filtros, campanaFiltro) {
    let ids = campanaFiltro ? (campanaFiltro.producto_ids || []) : null;

    if (filtros.solo_con_gasto) {
      const conGasto = await MetaReportesService._idsProductosConGasto(inquilino_id, usuario_id, {
        fecha_desde: filtros.fecha_desde,
        fecha_hasta: filtros.fecha_hasta,
        campana_id: campanaFiltro ? campanaFiltro.id : null,
        import_id: filtros.import_id || null,
      });
      ids = ids ? ids.filter((id) => conGasto.includes(id)) : conGasto;
    }

    if (filtros.producto_id) {
      const pid = parseInt(filtros.producto_id, 10);
      ids = ids ? ids.filter((id) => id === pid) : [pid];
    }

    return ids;
  }

  /** Ids de producto alcanzados por alguna campaña con filas de reporte en el período. */
  static async _idsProductosConGasto(inquilino_id, usuario_id, rango = {}) {
    const filas = await MetaReporteFila.findAll({
      where: MetaReportesService._whereFilas(inquilino_id, rango, { solo_vinculadas: true }),
      attributes: ['id'],
      include: [
        { model: MetaCampanaInterna, as: 'campana', attributes: ['producto_ids'] },
        { model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true },
      ],
    });

    const ids = new Set();
    for (const fila of filas) {
      for (const pid of (fila.campana?.producto_ids || [])) ids.add(pid);
    }
    return [...ids];
  }

  /**
   * Filtro de filas de reporte por período. El período se cruza por
   * solapamiento (una fila cuyo informe va del 1 al 7 cuenta para un
   * período que arranca el 5), porque el export de Meta trae una fila por
   * campaña por informe y no una por día.
   */
  static _whereFilas(inquilino_id, { fecha_desde, fecha_hasta, campana_id, import_id } = {}, opciones = {}) {
    const where = { inquilino_id };
    if (opciones.solo_vinculadas) where.meta_campana_interna_id = { [Op.ne]: null };
    if (campana_id) where.meta_campana_interna_id = campana_id;
    // Acota a una importación puntual, para el detalle de un reporte: así
    // las cifras de ese reporte no se mezclan con las de otro que cubra
    // fechas solapadas.
    if (import_id) where.meta_reporte_import_id = import_id;
    if (fecha_desde) where.fecha_fin = { [Op.gte]: fecha_desde };
    if (fecha_hasta) where.fecha_inicio = { [Op.lte]: fecha_hasta };
    return where;
  }

  /**
   * Cruce "gasto de Ads x pedidos reales" para un set concreto de
   * productos (ya resuelto y acotado por quien llama). Devuelve una fila
   * por producto con el P&L completo. Lo usan tanto la tabla paginada de
   * métricas como los totales del resumen, para que los dos den siempre
   * el mismo número.
   */
  static async _calcularMetricasProductos(inquilino_id, usuario_id, opciones = {}) {
    const { productos: productosObjetivo, campanaFiltro = null, fecha_desde, fecha_hasta, import_id = null } = opciones;
    const ids = productosObjetivo.map((p) => p.id);
    if (ids.length === 0) return [];

    // 1. Gasto de Meta Ads por producto (opcionalmente acotado a 1 campaña)
    const filas = await MetaReporteFila.findAll({
      where: MetaReportesService._whereFilas(
        inquilino_id,
        { fecha_desde, fecha_hasta, import_id, campana_id: campanaFiltro ? campanaFiltro.id : null },
        { solo_vinculadas: true },
      ),
      attributes: ['importe_gastado'],
      include: [
        { model: MetaCampanaInterna, as: 'campana', attributes: ['id', 'producto_ids'] },
        { model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true },
      ],
    });

    const gastoPorProducto = new Map();
    for (const filaModel of filas) {
      const fila = filaModel.toJSON();
      const gasto = Number(fila.importe_gastado) || 0;
      for (const pid of (fila.campana?.producto_ids || [])) {
        if (!ids.includes(pid)) continue;
        gastoPorProducto.set(pid, (gastoPorProducto.get(pid) || 0) + gasto);
      }
    }

    // 2. Pedidos/Confirmados/Entregados + facturación real, desde Envíos
    const whereEnvio = { usuario_id };
    if (fecha_desde && fecha_hasta) {
      whereEnvio[Op.or] = [
        { dispatchedAt: { [Op.between]: [fecha_desde, fecha_hasta] } },
        { fecha: { [Op.between]: [fecha_desde, fecha_hasta] } },
      ];
    } else if (fecha_desde) {
      whereEnvio[Op.or] = [{ dispatchedAt: { [Op.gte]: fecha_desde } }, { fecha: { [Op.gte]: fecha_desde } }];
    } else if (fecha_hasta) {
      whereEnvio[Op.or] = [{ dispatchedAt: { [Op.lte]: fecha_hasta } }, { fecha: { [Op.lte]: fecha_hasta } }];
    }

    const envios = await Envio.findAll({
      where: whereEnvio,
      attributes: ['id', 'estado', 'estado_comercial', 'estado_logistico', 'costo_envio'],
      include: [{
        model: EnvioItem,
        as: 'items',
        attributes: ['producto_id', 'cantidad', 'subtotal'],
        where: { producto_id: { [Op.in]: ids } },
        required: true,
      }],
    });

    // Clasificación de estado — mismo criterio que pedidosAnalyticsService
    // (catálogo operativo de 9 estados, ver envioController.ESTADOS_OPERATIVOS).
    const acumPedidos = new Map();
    for (const envioModel of envios) {
      const envio = envioModel.toJSON();
      const st = (envio.estado || '').toLowerCase();
      const stCom = (envio.estado_comercial || '').toLowerCase();
      const stLog = (envio.estado_logistico || '').toLowerCase();
      const isConfirmado = stCom === 'confirmado' || ['confirmado', 'preparado', 'despachado', 'reprogramado', 'entregado', 'devuelto', 'perdido'].includes(st);
      const isEntregado = st === 'entregado' || stLog === 'entregado';

      const productosDelEnvio = new Set();
      for (const item of envio.items) {
        if (!ids.includes(item.producto_id)) continue;
        if (!acumPedidos.has(item.producto_id)) {
          acumPedidos.set(item.producto_id, {
            pedidos: 0, confirmados: 0, entregados: 0,
            unidadesEntregadas: 0, facturacion: 0,
            sumaCostoEnvio: 0, countCostoEnvio: 0,
          });
        }
        const acc = acumPedidos.get(item.producto_id);

        if (!productosDelEnvio.has(item.producto_id)) {
          productosDelEnvio.add(item.producto_id);
          acc.pedidos += 1;
          if (isConfirmado) acc.confirmados += 1;
          if (isEntregado) {
            acc.entregados += 1;
            acc.sumaCostoEnvio += Number(envio.costo_envio) || 0;
            acc.countCostoEnvio += 1;
          }
        }
        if (isEntregado) {
          acc.unidadesEntregadas += item.cantidad || 0;
          acc.facturacion += item.subtotal || 0;
        }
      }
    }

    // 3. Combinar todo por producto
    return productosObjetivo.map((productoModel) => {
      const prod = productoModel.toJSON();
      const gasto = gastoPorProducto.get(prod.id) || 0;
      const gastoConIva = gasto * MULTIPLICADOR_IVA;
      const ped = acumPedidos.get(prod.id) || {
        pedidos: 0, confirmados: 0, entregados: 0,
        unidadesEntregadas: 0, facturacion: 0,
        sumaCostoEnvio: 0, countCostoEnvio: 0,
      };

      const costoProducto = prod.precio_costo != null ? Number(prod.precio_costo) : 0;
      const costoEnvioProm = ped.countCostoEnvio > 0 ? ped.sumaCostoEnvio / ped.countCostoEnvio : 0;
      const precioVentaProm = ped.unidadesEntregadas > 0 ? ped.facturacion / ped.unidadesEntregadas : Number(prod.precio_base) || 0;
      const utilidadBruta = ped.facturacion - (costoEnvioProm * ped.entregados) - (costoProducto * ped.unidadesEntregadas) - gastoConIva;

      return {
        producto_id: prod.id,
        producto: { id: prod.id, nombre: prod.nombre, sku: prod.sku },
        gasto_ads: gastoConIva,
        pedidos: ped.pedidos,
        cpa: ped.pedidos > 0 ? gastoConIva / ped.pedidos : 0,
        confirmados: ped.confirmados,
        pct_confirmacion: ped.pedidos > 0 ? (ped.confirmados / ped.pedidos) * 100 : 0,
        cpa_confirmado: ped.confirmados > 0 ? gastoConIva / ped.confirmados : 0,
        entregados: ped.entregados,
        pct_entrega: ped.confirmados > 0 ? (ped.entregados / ped.confirmados) * 100 : 0,
        cpa_entregado: ped.entregados > 0 ? gastoConIva / ped.entregados : 0,
        costo_producto: costoProducto,
        costo_envio: costoEnvioProm,
        precio_venta: precioVentaProm,
        facturacion: ped.facturacion,
        utilidad_bruta: utilidadBruta,
        // `null` (no "0 sin datos") cuando no hubo facturación: sin
        // facturación el margen no se puede calcular — es indefinido, no
        // cero. Un 0 acá se confundía en pantalla con un producto que de
        // verdad vendió justo en el punto de equilibrio.
        margen_bruto: ped.facturacion > 0 ? utilidadBruta / ped.facturacion : null,
      };
    });
  }

  // ============================================================
  // Resumen (KPIs de la vista principal de Ads & Campañas)
  // ============================================================

  /**
   * KPIs del período + variación contra el período inmediatamente
   * anterior de igual largo, para las tarjetas de "Resumen".
   *
   * Los dos bloques que devuelve NO son intercambiables, y por eso van
   * separados en la respuesta:
   *  - `meta`: inversión, compras, valor de conversión, ROAS, CPA, CTR.
   *    Son cifras del propio export de Meta — atribución de Meta, no
   *    nuestra.
   *  - `courier`: pedidos, confirmados, entregados, facturación y
   *    utilidad de los productos con gasto en el período, sacados de
   *    Envíos. Arrastran la misma advertencia que metricasPorProducto:
   *    son del producto completo, NO están atribuidos a la campaña.
   * Mezclar los dos en una sola tarjeta de "ROAS real" sería inventar una
   * atribución que hoy no existe (Envio.campaign_name es texto libre
   * tipeado a mano, no sirve como join).
   */
  static async resumen(inquilino_id, usuario_id, filtros = {}) {
    const fecha_desde = filtros.fecha_desde || null;
    const fecha_hasta = filtros.fecha_hasta || null;
    const import_id = filtros.import_id || null;

    const actual = await MetaReportesService._totalesPeriodo(inquilino_id, usuario_id, { fecha_desde, fecha_hasta, import_id });

    // Con `import_id` no hay período anterior contra el que comparar: el
    // universo es un archivo, no un rango.
    const rangoAnterior = import_id ? null : MetaReportesService._periodoAnterior(fecha_desde, fecha_hasta);
    const anterior = rangoAnterior
      ? await MetaReportesService._totalesPeriodo(inquilino_id, usuario_id, rangoAnterior)
      : null;

    const [relacionesPendientes, ultimaImportacion] = await Promise.all([
      MetaReporteFila.count({
        where: { inquilino_id, meta_campana_interna_id: null },
        include: [{ model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true }],
      }),
      MetaReporteImport.findOne({ where: { inquilino_id, usuario_id }, order: [['created_at', 'DESC']] }),
    ]);

    // Comparar contra el período anterior solo tiene sentido si los datos
    // caen realmente dentro del período. Con informes que abarcan meses, la
    // misma fila entra en los dos períodos y toda variación da 0%.
    const comparable = Boolean(anterior) && (actual.meta.cobertura?.filas_que_exceden || 0) === 0;

    return {
      periodo: { fecha_desde, fecha_hasta },
      import_id,
      periodo_anterior: rangoAnterior,
      comparable,
      actual,
      anterior,
      relaciones_pendientes: relacionesPendientes,
      ultima_importacion: ultimaImportacion,
    };
  }

  /** Período inmediatamente anterior, de igual largo. `null` si el rango es abierto. */
  static _periodoAnterior(fecha_desde, fecha_hasta) {
    if (!fecha_desde || !fecha_hasta) return null;
    const desde = new Date(`${fecha_desde}T00:00:00Z`);
    const hasta = new Date(`${fecha_hasta}T00:00:00Z`);
    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime()) || hasta < desde) return null;

    const UN_DIA = 24 * 60 * 60 * 1000;
    const largoDias = Math.round((hasta - desde) / UN_DIA) + 1;
    const hastaPrev = new Date(desde.getTime() - UN_DIA);
    const desdePrev = new Date(hastaPrev.getTime() - (largoDias - 1) * UN_DIA);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { fecha_desde: iso(desdePrev), fecha_hasta: iso(hastaPrev) };
  }

  static async _totalesPeriodo(inquilino_id, usuario_id, rango = {}) {
    // Todas las filas del período, vinculadas o no: el gasto es gasto
    // aunque la fila todavía no esté relacionada con una campaña interna.
    const filas = await MetaReporteFila.findAll({
      where: MetaReportesService._whereFilas(inquilino_id, rango),
      include: [
        { model: MetaCampanaInterna, as: 'campana', attributes: ['id', 'nombre_display', 'tipo', 'estado', 'producto_ids'] },
        { model: MetaReporteImport, attributes: [], where: { usuario_id }, required: true },
      ],
    });

    const meta = {
      inversion: 0, compras: 0, clics: 0, impresiones: 0, alcance: 0,
      valor_conversion: 0, resultados: 0, filas: filas.length, filas_sin_vincular: 0,
    };
    const porCampana = new Map();

    // Cobertura real de los datos que entraron al período. Meta exporta una
    // fila por campaña por informe, y un informe puede abarcar meses: en ese
    // caso la fila entra COMPLETA en cualquier período que toque, así que
    // "últimos 30 días" puede estar mostrando 8 meses de gasto. No se
    // prorratea (sería inventar una distribución diaria que el archivo no
    // trae): se informa, y el resumen marca el período como no comparable.
    const cobertura = { fecha_min: null, fecha_max: null, filas_que_exceden: 0 };

    for (const filaModel of filas) {
      const f = filaModel.toJSON();
      const gastoConIva = (Number(f.importe_gastado) || 0) * MULTIPLICADOR_IVA;
      meta.inversion += gastoConIva;
      meta.compras += Number(f.compras) || 0;
      meta.clics += Number(f.clics_enlace) || 0;
      meta.impresiones += Number(f.impresiones) || 0;
      meta.alcance += Number(f.alcance) || 0;
      meta.valor_conversion += Number(f.valor_conversion_compras) || 0;
      meta.resultados += Number(f.resultados) || 0;

      if (f.fecha_inicio && (!cobertura.fecha_min || f.fecha_inicio < cobertura.fecha_min)) cobertura.fecha_min = f.fecha_inicio;
      if (f.fecha_fin && (!cobertura.fecha_max || f.fecha_fin > cobertura.fecha_max)) cobertura.fecha_max = f.fecha_fin;
      const excedePorIzquierda = rango.fecha_desde && f.fecha_inicio && f.fecha_inicio < rango.fecha_desde;
      const excedePorDerecha = rango.fecha_hasta && f.fecha_fin && f.fecha_fin > rango.fecha_hasta;
      if (excedePorIzquierda || excedePorDerecha) cobertura.filas_que_exceden += 1;

      if (!f.meta_campana_interna_id) { meta.filas_sin_vincular += 1; continue; }

      if (!porCampana.has(f.meta_campana_interna_id)) {
        porCampana.set(f.meta_campana_interna_id, {
          campana_id: f.meta_campana_interna_id,
          nombre: f.campana?.nombre_display || f.nombre_campana_meta,
          tipo: f.campana?.tipo || null,
          estado: f.campana?.estado || null,
          inversion: 0, compras: 0, valor_conversion: 0, clics: 0, impresiones: 0,
        });
      }
      const acc = porCampana.get(f.meta_campana_interna_id);
      acc.inversion += gastoConIva;
      acc.compras += Number(f.compras) || 0;
      acc.valor_conversion += Number(f.valor_conversion_compras) || 0;
      acc.clics += Number(f.clics_enlace) || 0;
      acc.impresiones += Number(f.impresiones) || 0;
    }

    meta.roas = meta.inversion > 0 ? meta.valor_conversion / meta.inversion : 0;
    meta.cpa = meta.compras > 0 ? meta.inversion / meta.compras : 0;
    meta.ctr = meta.impresiones > 0 ? (meta.clics / meta.impresiones) * 100 : 0;
    meta.cpc = meta.clics > 0 ? meta.inversion / meta.clics : 0;
    meta.cpm = meta.impresiones > 0 ? (meta.inversion / meta.impresiones) * 1000 : 0;
    meta.cobertura = cobertura;

    const campanas = [...porCampana.values()]
      .map((c) => ({
        ...c,
        roas: c.inversion > 0 ? c.valor_conversion / c.inversion : 0,
        cpa: c.compras > 0 ? c.inversion / c.compras : 0,
      }))
      .sort((a, b) => b.inversion - a.inversion);

    // Lado Courier: solo los productos que tuvieron gasto en el período.
    const idsConGasto = await MetaReportesService._idsProductosConGasto(inquilino_id, usuario_id, rango);
    const courier = {
      productos_con_gasto: idsConGasto.length,
      pedidos: 0, confirmados: 0, entregados: 0, facturacion: 0, utilidad_bruta: 0,
    };

    if (idsConGasto.length > 0) {
      const productos = await Producto.findAll({
        where: { id: { [Op.in]: idsConGasto }, inquilino_id },
        attributes: ['id', 'nombre', 'sku', 'precio_costo', 'precio_base'],
      });
      const metricas = await MetaReportesService._calcularMetricasProductos(inquilino_id, usuario_id, {
        productos, fecha_desde: rango.fecha_desde, fecha_hasta: rango.fecha_hasta, import_id: rango.import_id || null,
      });
      for (const m of metricas) {
        courier.pedidos += m.pedidos;
        courier.confirmados += m.confirmados;
        courier.entregados += m.entregados;
        courier.facturacion += m.facturacion;
        courier.utilidad_bruta += m.utilidad_bruta;
      }
    }

    courier.pct_confirmacion = courier.pedidos > 0 ? (courier.confirmados / courier.pedidos) * 100 : 0;
    courier.pct_entrega = courier.confirmados > 0 ? (courier.entregados / courier.confirmados) * 100 : 0;
    courier.cpa_entregado = courier.entregados > 0 ? meta.inversion / courier.entregados : 0;
    // Mismo criterio que en metricasPorProducto: sin facturación el margen
    // es indefinido, no cero.
    courier.margen_bruto = courier.facturacion > 0 ? courier.utilidad_bruta / courier.facturacion : null;

    return { meta, courier, campanas };
  }
}

module.exports = MetaReportesService;
