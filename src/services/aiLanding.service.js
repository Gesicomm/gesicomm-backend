'use strict';

/**
 * Servicio de Inteligencia Artificial para Gesicomm.
 * Llama al microservicio RAG (FastAPI) a través de la red interna Docker.
 */

const { Op } = require('sequelize');
const { Producto, Tienda } = require('../models');
const LandingSimpleService = require('./landingSimple.service');
const { construirCodigoDesdeSchema } = require('./aiLandingSchemaToCodigo');
const AICodeValidator = require('./aiCodeValidator.service');

// Reemplazamos localhost por 127.0.0.1 para evitar problemas de IPv6 en Node 18+ con docker
const rawUrl = process.env.RAG_INTERNAL_URL || 'http://rag-backend:8000';
const RAG_URL = rawUrl.replace('localhost', '127.0.0.1');

class AILandingService {

  /**
   * POST genérico al microservicio RAG, con el header X-API-Key y timeout.
   * `err.status` queda seteado con el código HTTP cuando la respuesta no es
   * ok — lo usan crearDesdeIA/regenerarConIA para caer al motor viejo
   * (PageSchema) si el RAG todavía no tiene desplegado /ai/code/* (404).
   */
  static async _fetchRAG(path, payload, timeoutMs = 90000) {
    const ragKey = process.env.RAG_API_KEY;
    if (!ragKey) {
      throw new Error('La variable de entorno RAG_API_KEY no está configurada en el servidor.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${RAG_URL}${path}`, {
        method: 'POST',
        headers: {
          'X-API-Key': ragKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.detail || `Error del microservicio de IA (${response.status})`);
        err.status = response.status;
        throw err;
      }

      return response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('La generación con IA tardó demasiado tiempo. Intentá de nuevo.');
      }
      throw err;
    }
  }

  static storeContextParaRAG(tienda) {
    return {
      nombre: tienda.nombre || 'Mi Tienda',
      descripcion: tienda.descripcion || '',
      whatsapp: tienda.contacto_whatsapp || tienda.telefono || '',
      color_primario: tienda.color_primario || '#2563eb',
      color_secundario: tienda.color_secundario || null,
    };
  }

  /**
   * HTML/CSS/JS libre desde un prompt — ver docs/ai-code-generation.md.
   * Reemplaza a solicitarBorradorRAG() como motor de diseño creativo: acá
   * el LLM escribe código de verdad (animaciones, layouts) en vez de
   * rellenar un JSON tipado sin lugar para eso.
   */
  static async solicitarCodigoRAG({ prompt, tienda, productos, pageType = 'landing', producto = null }) {
    const data = await this._fetchRAG('/ai/code/generate', {
      page_type: pageType,
      prompt,
      context: { store: this.storeContextParaRAG(tienda), products: productos, product: producto },
    });
    if (!data.ok || !data.html) throw new Error('Respuesta del microservicio de IA inválida.');
    return { html: data.html, css: data.css || '', js: data.js || '' };
  }

  /**
   * Edita el HTML/CSS/JS que ya existe con una instrucción nueva, en vez de
   * rehacerlo todo — esto es lo que hace que "hacela más animada" ajuste la
   * landing existente en vez de regenerarla entera con textos distintos.
   */
  static async solicitarEdicionRAG({ instruction, current, tienda, productos, pageType = 'landing', producto = null }) {
    const data = await this._fetchRAG('/ai/code/edit', {
      instruction,
      current: { html: current?.html || '', css: current?.css || '', js: current?.js || '' },
      page_type: pageType,
      context: { store: this.storeContextParaRAG(tienda), products: productos, product: producto },
    });
    if (!data.ok || !data.html) throw new Error('Respuesta del microservicio de IA inválida.');
    return { html: data.html, css: data.css || '', js: data.js || '' };
  }

  /**
   * Envía la solicitud al microservicio RAG (PageSchema tipado). Se
   * mantiene solo como FALLBACK de crearDesdeIA/regenerarConIA mientras el
   * RAG no tenga desplegados /ai/code/generate y /ai/code/edit (404) — una
   * vez desplegados, este método y aiLandingSchemaToCodigo.js dejan de
   * usarse en el camino normal.
   */
  static async solicitarBorradorRAG({ prompt, tienda, productos }) {
    const data = await this._fetchRAG('/ai/landing/draft', {
      prompt,
      tienda_context: {
        ...this.storeContextParaRAG(tienda),
        // Se envían los productos reales del catálogo con sus precios reales de la BD
        productos: productos.map(p => ({
          id: p.id,
          nombre: p.nombre,
          precio: p.precio ? Number(p.precio) : 0,
          descripcion: p.descripcion || '',
        })),
      },
    });
    if (!data.ok || !data.draft) {
      throw new Error('Respuesta del microservicio de IA inválida.');
    }
    return data.draft;
  }

  /**
   * Productos/combos reales (id, nombre, precio, descripción) que se le
   * mandan al RAG como contexto — misma forma para crear y para regenerar,
   * así el LLM siempre ve datos reales y nunca inventa precios.
   */
  static async catalogoParaRAG(inquilino_id, items) {
    const { Combo } = require('../models');
    const lista = Array.isArray(items) ? items : [];
    const idsProductos = lista.filter(i => i.tipo === 'producto').map(i => Number(i.referencia_id ?? i.id));
    const idsCombos = lista.filter(i => i.tipo === 'combo').map(i => Number(i.referencia_id ?? i.id));

    let productos = [];
    let combos = [];
    if (idsProductos.length || idsCombos.length) {
      [productos, combos] = await Promise.all([
        idsProductos.length
          ? Producto.findAll({ where: { inquilino_id, activo: true, id: { [Op.in]: idsProductos } } })
          : Promise.resolve([]),
        idsCombos.length
          ? Combo.findAll({ where: { inquilino_id, activo: true, id: { [Op.in]: idsCombos } } })
          : Promise.resolve([]),
      ]);
    } else {
      // Sin selección (fallback inicial): primeros 10 productos activos.
      productos = await Producto.findAll({
        where: { inquilino_id, activo: true },
        limit: 10,
        order: [['created_at', 'DESC']],
      });
    }

    return [
      ...productos.map(p => ({ id: `producto_${p.id}`, nombre: p.nombre, precio: p.precio_base || p.precio, descripcion: p.descripcion_corta || '' })),
      ...combos.map(c => ({ id: `combo_${c.id}`, nombre: c.nombre, precio: c.precio, descripcion: c.descripcion || '' })),
    ];
  }

  /**
   * Corre el CommerceCodeValidator sobre el HTML antes de guardarlo — hoy
   * el conversor es determinístico y prácticamente nunca dispara un error
   * acá, pero es el mismo punto donde va a engancharse el repair loop el
   * día que el generador pase a devolver HTML/CSS/JS libre (ver el plan de
   * /ai/code/generate y /ai/code/edit): la landing nunca se guarda con
   * atributos inventados o sin ninguna acción de compra.
   */
  static asegurarCodigoValido(codigo, vista = 'inicio') {
    const { errores } = AICodeValidator.validar(codigo.html, { vista });
    if (errores.length) {
      const err = new Error('La IA generó un código que Gesicomm no puede publicar.');
      err.errores = errores;
      throw err;
    }
  }

  /**
   * Crea un borrador de landing generado por IA en Gesicomm.
   * La landing se guarda con activo: false (borrador) para revisión previa.
   */
  static async crearDesdeIA({ tienda_id, inquilino_id, prompt, items = [] }) {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('Escribí una descripción de al menos 5 caracteres para que la IA arme tu landing.');
    }

    const tienda = await Tienda.findByPk(tienda_id);
    if (!tienda) throw new Error('Tienda no encontrada.');

    const catalogoRAG = await this.catalogoParaRAG(inquilino_id, items);

    // Antes se guardaba en pages/page_versions (arquitectura aparte del
    // Page Builder) y esa fila nunca aparecía en /api/mis-landings-simples
    // ni se podía publicar: "Ver página publicada" siempre mostraba la
    // landing vacía. Ahora se guarda como lienzo en blanco — mismo modelo
    // Landing/LandingItem que usa el resto del editor, publicar
    // (cambiarEstado) y la vista pública (LandingCodigoPublica).
    let codigo;
    let titulo = tienda.nombre;
    try {
      codigo = await this.solicitarCodigoRAG({ prompt: prompt.trim(), tienda, productos: catalogoRAG, pageType: 'landing' });
    } catch (err) {
      // /ai/code/generate todavía no desplegado en el RAG (404): se cae al
      // motor viejo (PageSchema tipado) en vez de romper el wizard entero.
      if (err.status !== 404) throw err;
      const draft = await this.solicitarBorradorRAG({ prompt: prompt.trim(), tienda, productos: catalogoRAG });
      codigo = construirCodigoDesdeSchema(draft);
      titulo = draft.seo?.title || tienda.nombre;
    }
    this.asegurarCodigoValido(codigo, 'inicio');
    // crearLienzoBlanco → resolverItemsCatalogo/sincronizarItems esperan
    // `referencia_id`, no `id` (que es lo que manda el wizard del frontend).
    const itemsLanding = (Array.isArray(items) ? items : [])
      .filter(i => i && (i.tipo === 'producto' || i.tipo === 'combo') && Number(i.id) > 0)
      .map(i => ({ tipo: i.tipo, referencia_id: Number(i.id) }));
    const creada = await LandingSimpleService.crearLienzoBlanco(tienda_id, inquilino_id, tienda.nombre, itemsLanding);
    const landingModel = await LandingSimpleService.buscarPropia(creada.id, tienda_id);
    return LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
      titulo,
      codigo,
      venta: { configurado: true, tipo: 'catalogo', seleccion: 'manual' },
    });
  }

  /**
   * Vuelve a pedirle un ajuste al RAG con un prompt nuevo y lo aplica SOBRE
   * la landing que ya existe (misma fila, mismo id, mismo slug) — a
   * diferencia de crearDesdeIA, que siempre arranca una landing nueva. Así
   * el comercio puede seguir hablando con la IA ("hacela más minimalista",
   * "agregá una sección de testimonios") desde el editor completo, sin
   * perder la landing ni volver al asistente inicial.
   *
   * `target`: 'inicio' | 'producto' — a CUÁL de las dos vistas de la
   * landing se le habla. Antes esto siempre tocaba "Inicio" sin importar
   * qué pidiera el comercio ("agregame la vista por productos" terminaba
   * reescribiendo el inicio, porque no había forma de apuntar a la ficha).
   * Ahora el frontend manda la vista en la que está parado el usuario.
   *
   * Reutiliza los productos ya cargados en la landing (los de "Configurar
   * venta"): la IA no vuelve a preguntar qué vender, solo cómo mostrarlo.
   */
  static async regenerarConIA({ tienda_id, inquilino_id, landing_id, prompt, target = 'inicio' }) {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('Escribí una descripción de al menos 5 caracteres para que la IA modifique tu landing.');
    }
    const esFicha = target === 'producto';

    const tienda = await Tienda.findByPk(tienda_id);
    if (!tienda) throw new Error('Tienda no encontrada.');

    const landingModel = await LandingSimpleService.buscarPropia(landing_id, tienda_id);
    if (landingModel.template?.kind !== 'codigo') {
      throw new Error('Solo se puede regenerar con IA una landing de lienzo en blanco.');
    }

    const { LandingItem } = require('../models');
    const items = await LandingItem.findAll({ where: { landing_id: landingModel.id }, attributes: ['tipo', 'referencia_id'] });
    const catalogoRAG = await this.catalogoParaRAG(inquilino_id, items.map(i => i.toJSON()));

    const actual = esFicha ? landingModel.content?.vistas?.producto : landingModel.content?.codigo;
    const instruccion = prompt.trim();

    let codigo;
    let titulo = landingModel.titulo;
    try {
      // /ai/code/edit — conserva el código actual y solo ajusta lo que pide
      // la instrucción, en vez de reescribir toda la vista de cero.
      codigo = await this.solicitarEdicionRAG({
        instruction: instruccion,
        current: actual,
        tienda,
        productos: catalogoRAG,
        pageType: esFicha ? 'product' : 'landing',
      });
    } catch (err) {
      if (err.status !== 404) throw err;
      // Fallback: el RAG todavía no tiene /ai/code/edit — regenera todo de
      // cero con el motor viejo (PageSchema, solo sirve para "Inicio").
      if (esFicha) throw new Error('La generación con IA de la ficha de producto todavía no está disponible.');
      const draft = await this.solicitarBorradorRAG({ prompt: instruccion, tienda, productos: catalogoRAG });
      codigo = construirCodigoDesdeSchema(draft);
      titulo = draft.seo?.title || landingModel.titulo;
    }

    // "Agregá una sección de beneficios" no debería volver con 70% menos
    // HTML o sin botón de compra — eso es la IA yéndose de tema, no editando.
    const { errores: erroresPreservacion } = AICodeValidator.validarPreservacion(actual, codigo, instruccion);
    if (erroresPreservacion.length) {
      const err = new Error('La IA devolvió un cambio mucho más grande de lo que pediste — no se guardó.');
      err.errores = erroresPreservacion;
      throw err;
    }

    this.asegurarCodigoValido(codigo, esFicha ? 'ficha' : 'inicio');

    if (esFicha) {
      return LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
        vistas: { producto: codigo },
      });
    }
    return LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
      titulo,
      codigo,
    });
  }
}

module.exports = AILandingService;
