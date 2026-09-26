'use strict';

/**
 * Servicio de Inteligencia Artificial para Gesicomm.
 * Llama al microservicio RAG (FastAPI) a través de la red interna Docker.
 */

const { Op } = require('sequelize');
const { Producto, Tienda } = require('../models');
const LandingSimpleService = require('./landingSimple.service');
const LandingCodigoService = require('./landingCodigo.service');
const AICodeValidator = require('./aiCodeValidator.service');
const AiGenerationLogService = require('./aiGenerationLog.service');

// Reemplazamos localhost por 127.0.0.1 para evitar problemas de IPv6 en Node 18+ con docker
const rawUrl = process.env.RAG_INTERNAL_URL || 'http://rag-backend:8000';
const RAG_URL = rawUrl.replace('localhost', '127.0.0.1');

class AILandingService {

  /**
   * POST genérico al microservicio RAG, con el header X-API-Key y timeout.
   * `err.status` queda seteado con el código HTTP cuando la respuesta no es
   * ok — si el RAG no tiene /ai/code/* desplegado, el flujo falla de forma
   * explícita para no volver al generador rígido basado en PageSchema.
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

  static _extraerVariableCss(css, nombre) {
    const escapado = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(css || '').match(new RegExp(`${escapado}\\s*:\\s*([^;]+)`, 'i'));
    return match ? match[1].trim() : '';
  }

  static _extraerFuente(css, variable) {
    const valor = this._extraerVariableCss(css, variable);
    const match = valor.match(/['"]([^'"]+)['"]|([^,\s][^,]*)/);
    return (match?.[1] || match?.[2] || '').trim();
  }

  static designContextDesdeCodigo(codigo, tienda) {
    const css = String(codigo?.css || '');
    const existente = codigo?.design_context && typeof codigo.design_context === 'object' ? codigo.design_context : {};
    return {
      brand: {
        primary: existente.brand?.primary || this._extraerVariableCss(css, '--gc-primario') || tienda.color_primario || '#2563eb',
        secondary: existente.brand?.secondary || this._extraerVariableCss(css, '--gc-secundario') || tienda.color_secundario || null,
        background: existente.brand?.background || this._extraerVariableCss(css, '--gc-fondo') || '#ffffff',
        surface: existente.brand?.surface || this._extraerVariableCss(css, '--gc-superficie') || this._extraerVariableCss(css, '--surface') || null,
        text: existente.brand?.text || this._extraerVariableCss(css, '--gc-texto') || '#111827',
      },
      typography: {
        heading: existente.typography?.heading || this._extraerFuente(css, '--font-display'),
        body: existente.typography?.body || this._extraerFuente(css, '--font-text'),
      },
      visual_style: existente.visual_style || existente.visualStyle || 'derivado del inicio generado',
      radius: existente.radius || (css.includes('999px') ? 'pill' : css.includes('14px') || css.includes('16px') ? 'medium' : 'subtle'),
      spacing: existente.spacing || (css.includes('--esp-5') || css.includes('--space-5') ? 'generous' : 'balanced'),
      motion: existente.motion || (css.includes('cubic-bezier') ? 'smooth cinematic' : css.includes('transition') || css.includes('animation') ? 'smooth' : 'minimal'),
      button_style: existente.button_style || (css.includes('999px') ? 'solid pill' : 'solid'),
    };
  }

  static referenciaVisualInicio(landingModel) {
    const codigoInicio = landingModel?.content?.codigo || {};
    const fonts = Array.isArray(codigoInicio.fonts) ? codigoInicio.fonts : [];
    const designContext = codigoInicio.design_context || landingModel?.content?.design_context || null;
    if (!fonts.length && !designContext) return '';
    return [
      'DESIGN_CONTEXT DEL INICIO YA PUBLICADO:',
      'Usá este resumen como guía de marca para la ficha: mantené familias tipográficas, escala, paleta, ritmo de espaciado, tono visual y nivel de efecto. No copies secciones del inicio ni cambies el motor comercial.',
      JSON.stringify({ fonts, design_context: designContext }, null, 2),
    ].join('\n\n');
  }

  /**
   * HTML/CSS/JS libre desde un prompt — ver docs/ai-code-generation.md.
   * Reemplaza al antiguo PageSchema como motor de diseño creativo: acá
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
    return this._codigoConMetadata(data);
  }

  /**
   * Edita el HTML/CSS/JS que ya existe con una instrucción nueva, en vez de
   * rehacerlo todo — esto es lo que hace que "hacela más animada" ajuste la
   * landing existente en vez de regenerarla entera con textos distintos.
   */
  static async solicitarEdicionRAG({ instruction, current, tienda, productos, pageType = 'landing', producto = null }) {
    const data = await this._fetchRAG('/ai/code/edit', {
      instruction,
      current: {
        html: current?.html || '',
        css: current?.css || '',
        js: current?.js || '',
        fonts: Array.isArray(current?.fonts) ? current.fonts : [],
        design_context: current?.design_context || {},
      },
      page_type: pageType,
      context: { store: this.storeContextParaRAG(tienda), products: productos, product: producto },
    });
    if (!data.ok || !data.html) throw new Error('Respuesta del microservicio de IA inválida.');
    return this._codigoConMetadata(data);
  }

  /**
   * Le pide al RAG UN intento de corrección puntual (ver
   * _conRepairAutomatico) — no vuelve a diseñar, solo arregla los errores
   * que le mandamos.
   */
  static async solicitarRepairRAG({ current, errores, tienda, productos, pageType = 'landing', producto = null }) {
    const data = await this._fetchRAG('/ai/code/repair', {
      current: {
        html: current?.html || '',
        css: current?.css || '',
        js: current?.js || '',
        fonts: Array.isArray(current?.fonts) ? current.fonts : [],
        design_context: current?.design_context || {},
      },
      errores,
      page_type: pageType,
      context: { store: this.storeContextParaRAG(tienda), products: productos, product: producto },
    });
    if (!data.ok || !data.html) throw new Error('Respuesta del microservicio de IA inválida.');
    return this._codigoConMetadata(data);
  }

  /**
   * {html, css, js} + metadata de telemetría (modelo, intentos, tokens) que
   * viene en la respuesta de /ai/code/generate|edit|repair. Los campos
   * extra no molestan a nadie que solo lea .html/.css/.js (sanitizar(),
   * AICodeValidator, actualizarCodigo) — así no hace falta pasear un
   * segundo objeto en paralelo por todos lados.
   */
  static _codigoConMetadata(data) {
    return {
      html: data.html,
      css: data.css || '',
      js: data.js || '',
      fonts: Array.isArray(data.fonts) ? data.fonts : [],
      design_context: data.design_context && typeof data.design_context === 'object' ? data.design_context : null,
      _modelo: data.model || null,
      _intentos: data.intentos || 1,
      _tokensInput: data.tokens_input || 0,
      _tokensOutput: data.tokens_output || 0,
    };
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
   * Datos reales del producto/combo de una ficha PROPIA, a partir de su
   * content_id público (el mismo que arma contentIdPanel() en el frontend:
   * el slug del producto, o "combo-<id>"). Sin esto no se le puede decir al
   * RAG "esta ficha es de ESTE producto puntual" — page_type="product" con
   * context.product real es lo que permite pedirle una ficha distinta por
   * producto ("este termo estilo outdoor", "este auricular tech").
   */
  static async resolverProductoPorContentId(inquilino_id, contentId) {
    const comboMatch = /^combo-(\d+)$/.exec(String(contentId || ''));
    if (comboMatch) {
      const { Combo } = require('../models');
      const combo = await Combo.findOne({ where: { id: Number(comboMatch[1]), inquilino_id, activo: true } });
      if (!combo) return null;
      return { id: `combo_${combo.id}`, tipo: 'combo', nombre: combo.nombre, precio: combo.precio, descripcion: combo.descripcion || '' };
    }
    let producto = await Producto.findOne({ where: { slug: contentId, inquilino_id, activo: true } });
    const idMatch = !producto && /^producto-(\d+)$/.exec(String(contentId || ''));
    if (idMatch) {
      producto = await Producto.findOne({ where: { id: Number(idMatch[1]), inquilino_id, activo: true } });
    }
    if (!producto) return null;
    return {
      id: `producto_${producto.id}`,
      tipo: 'producto',
      nombre: producto.nombre,
      precio: producto.precio_base || producto.precio,
      descripcion: producto.descripcion_corta || '',
      ficha_rubro: producto.ficha_rubro || null,
      ficha_datos: producto.ficha_datos || null,
      propuesta_valor: producto.propuesta_valor || null,
    };
  }

  /**
   * Pipeline completo de validación de un código antes de guardarlo:
   * sanitizador (seguridad + sintaxis JS) → preservación (¿se comió
   * secciones que el pedido no mencionaba?) → CommerceCodeValidator
   * (negocio: atributos/listas reales, acción de compra). Se usa tanto
   * para el intento inicial como para el resultado del repair.
   *
   * @returns {string[]} errores (vacío = todo OK)
   */
  static validarTodo(anterior, nuevo, instruccion, vista) {
    const errores = [];
    try {
      LandingCodigoService.sanitizar(nuevo);
    } catch (err) {
      errores.push(...(err.errores || [err.message]));
    }
    if (anterior) {
      errores.push(...AICodeValidator.validarPreservacion(anterior, nuevo, instruccion).errores);
    }
    errores.push(...AICodeValidator.validar(nuevo.html, { vista }).errores);
    return errores;
  }

  /**
   * Genera/edita con UN reintento automático de corrección si la
   * validación falla — así el comercio no ve un error técnico por algo que
   * la IA puede arreglar sola (un atributo inventado, faltó el botón de
   * compra). Nunca más de un repair: si sigue fallando, se tira el error
   * con el detalle para que el usuario reformule.
   *
   * `generar` es la función que pide el primer intento (generate o edit);
   * si el RAG todavía no tiene /ai/code/repair desplegado (404), se
   * mantienen los errores de la primera validación tal cual.
   *
   * Devuelve { codigo, repairUsed, erroresPreRepair, tokensInput,
   * tokensOutput, modelo } — el detalle es para AiGenerationLog (ver
   * registrarLog más abajo), no hace falta en el camino feliz.
   */
  static async _conRepairAutomatico({ generar, anterior, instruccion, vista, tienda, productos, pageType, producto }) {
    let codigo = await generar();
    let errores = this.validarTodo(anterior, codigo, instruccion, vista);
    const erroresPreRepair = errores;
    let repairUsed = false;
    let tokensInput = codigo._tokensInput || 0;
    let tokensOutput = codigo._tokensOutput || 0;
    let modelo = codigo._modelo || null;

    if (errores.length) {
      try {
        const reparado = await this.solicitarRepairRAG({ current: codigo, errores, tienda, productos, pageType, producto });
        repairUsed = true;
        tokensInput += reparado._tokensInput || 0;
        tokensOutput += reparado._tokensOutput || 0;
        modelo = reparado._modelo || modelo;
        codigo = reparado;
        errores = this.validarTodo(anterior, codigo, instruccion, vista);
      } catch (err) {
        if (err.status !== 404) throw err;
        // /ai/code/repair todavía no desplegado: se mantienen los errores originales.
      }
    }

    if (errores.length) {
      const err = new Error(
        'La IA generó un código que Gesicomm no puede publicar, ni siquiera después de un intento de corrección.',
      );
      err.errores = errores;
      err.telemetria = { repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo };
      throw err;
    }
    return { codigo, repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo };
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
    const instruccion = prompt.trim();
    const inicio = Date.now();
    let codigo;
    let titulo = tienda.nombre;
    let repairUsed = false;
    let erroresPreRepair = [];
    let tokensInput = 0;
    let tokensOutput = 0;
    let modelo = null;
    try {
      const resultado = await this._conRepairAutomatico({
        generar: () => this.solicitarCodigoRAG({ prompt: instruccion, tienda, productos: catalogoRAG, pageType: 'landing' }),
        anterior: null,
        instruccion,
        vista: 'inicio',
        tienda,
        productos: catalogoRAG,
        pageType: 'landing',
        producto: null,
      });
      ({ codigo, repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo } = resultado);
      codigo.design_context = this.designContextDesdeCodigo(codigo, tienda);
    } catch (err) {
      await AiGenerationLogService.registrar({
        tiendaId: tienda_id, operacion: 'generate', pageType: 'landing', target: 'inicio',
        prompt: instruccion, latenciaMs: Date.now() - inicio, exitoso: false,
        validationErrors: err.status === 404
          ? ['El RAG configurado no tiene /ai/code/generate desplegado. No se usa el fallback PageSchema porque genera landings rígidas.']
          : (err.errores || [err.message]),
        ...(err.status === 404 ? {} : (err.telemetria || {})),
      });
      if (err.status === 404) {
        throw new Error('El motor de código libre del RAG no está disponible (/ai/code/generate). Reiniciá o redeployá el RAG antes de generar landings con IA.');
      }
      throw err;
    }
    // crearLienzoBlanco → resolverItemsCatalogo/sincronizarItems esperan
    // `referencia_id`, no `id` (que es lo que manda el wizard del frontend).
    const itemsLanding = (Array.isArray(items) ? items : [])
      .filter(i => i && (i.tipo === 'producto' || i.tipo === 'combo') && Number(i.id) > 0)
      .map(i => ({ tipo: i.tipo, referencia_id: Number(i.id) }));
    const creada = await LandingSimpleService.crearLienzoBlanco(tienda_id, inquilino_id, tienda.nombre, itemsLanding);
    const landingModel = await LandingSimpleService.buscarPropia(creada.id, tienda_id);
    const guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
      titulo,
      codigo,
      venta: { configurado: true, tipo: 'catalogo', seleccion: 'manual' },
    });
    await AiGenerationLogService.registrar({
      tiendaId: tienda_id, landingId: guardada.id, operacion: 'generate', pageType: 'landing', target: 'inicio',
      prompt: instruccion, modelo, latenciaMs: Date.now() - inicio, tokensInput, tokensOutput,
      repairUsed, exitoso: true, validationErrorsPreRepair: erroresPreRepair,
    });
    return guardada;
  }

  /**
   * Vuelve a pedirle un ajuste al RAG con un prompt nuevo y lo aplica SOBRE
   * la landing que ya existe (misma fila, mismo id, mismo slug) — a
   * diferencia de crearDesdeIA, que siempre arranca una landing nueva. Así
   * el comercio puede seguir hablando con la IA ("hacela más minimalista",
   * "agregá una sección de testimonios") desde el editor completo, sin
   * perder la landing ni volver al asistente inicial.
   *
   * `target`: a CUÁL parte de la landing se le habla. Antes esto siempre
   * tocaba "Inicio" sin importar qué pidiera el comercio.
   *   - 'inicio' → content.codigo (el inicio de la tienda).
   *   - 'producto' → content.vistas.producto (la ficha general, la que usan
   *     todos los productos sin ficha propia).
   *   - 'producto_especifico' → content.vistas.productos[contentId] (la
   *     ficha PROPIA de un producto puntual — requiere `contentId`). Esto
   *     es lo que permite "este termo quiero una ficha outdoor premium" y
   *     "este auricular quiero que se vea tech futurista" sin que
   *     compartan diseño: cada ficha propia vive en su propia clave, y un
   *     producto sin ficha propia sigue cayendo en la ficha general.
   *
   * Reutiliza los productos ya cargados en la landing (los de "Configurar
   * venta"): la IA no vuelve a preguntar qué vender, solo cómo mostrarlo.
   */
  static async regenerarConIA({ tienda_id, inquilino_id, landing_id, prompt, target = 'inicio', contentId = null }) {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('Escribí una descripción de al menos 5 caracteres para que la IA modifique tu landing.');
    }
    const esFichaEspecifica = target === 'producto_especifico';
    const esFicha = target === 'producto' || esFichaEspecifica;
    if (esFichaEspecifica && !contentId) {
      throw new Error('Falta indicar de qué producto es la ficha.');
    }

    const tienda = await Tienda.findByPk(tienda_id);
    if (!tienda) throw new Error('Tienda no encontrada.');

    const landingModel = await LandingSimpleService.buscarPropia(landing_id, tienda_id);
    if (landingModel.template?.kind !== 'codigo') {
      throw new Error('Solo se puede regenerar con IA una landing de lienzo en blanco.');
    }

    const { LandingItem } = require('../models');
    const items = await LandingItem.findAll({ where: { landing_id: landingModel.id }, attributes: ['tipo', 'referencia_id'] });
    const catalogoRAG = await this.catalogoParaRAG(inquilino_id, items.map(i => i.toJSON()));

    let productoContexto = null;
    if (esFichaEspecifica) {
      productoContexto = await this.resolverProductoPorContentId(inquilino_id, contentId);
      if (!productoContexto) throw new Error('No se encontró ese producto en esta landing.');
    }

    const actual = esFichaEspecifica
      ? landingModel.content?.vistas?.productos?.[contentId]
      : esFicha
        ? landingModel.content?.vistas?.producto
        : landingModel.content?.codigo;
    const instruccion = prompt.trim();
    const referenciaVisual = esFicha ? this.referenciaVisualInicio(landingModel) : '';
    const instruccionParaRAG = referenciaVisual
      ? `${instruccion}\n\n${referenciaVisual}`
      : instruccion;
    const pageType = esFicha ? 'product' : 'landing';

    const inicio = Date.now();
    let codigo;
    let titulo = landingModel.titulo;
    let repairUsed = false;
    let erroresPreRepair = [];
    let tokensInput = 0;
    let tokensOutput = 0;
    let modelo = null;
    const logBase = { tiendaId: tienda_id, landingId: landing_id, operacion: actual?.html?.trim() ? 'edit' : 'generate', pageType, target, contentId, prompt: instruccion };
    try {
      const resultado = await this._conRepairAutomatico({
        // Sin código previo en esta ficha puntual (primera vez), se genera
        // desde cero; si ya había algo, se edita conservando lo que no
        // haga falta cambiar.
        generar: () => (actual?.html?.trim()
          ? this.solicitarEdicionRAG({ instruction: instruccionParaRAG, current: actual, tienda, productos: catalogoRAG, pageType, producto: productoContexto })
          : this.solicitarCodigoRAG({ prompt: instruccionParaRAG, tienda, productos: catalogoRAG, pageType, producto: productoContexto })),
        anterior: actual,
        instruccion,
        vista: esFicha ? 'ficha' : 'inicio',
        tienda,
        productos: catalogoRAG,
        pageType,
        producto: productoContexto,
      });
      ({ codigo, repairUsed, erroresPreRepair, tokensInput, tokensOutput, modelo } = resultado);
      codigo.design_context = this.designContextDesdeCodigo(codigo, tienda);
    } catch (err) {
      await AiGenerationLogService.registrar({
        ...logBase, latenciaMs: Date.now() - inicio, exitoso: false,
        validationErrors: err.status === 404
          ? ['El RAG configurado no tiene /ai/code/edit o /ai/code/generate desplegado. No se usa el fallback PageSchema porque genera landings rígidas.']
          : (err.errores || [err.message]),
        ...(err.status === 404 ? {} : (err.telemetria || {})),
      });
      if (err.status === 404) {
        throw new Error('El motor de código libre del RAG no está disponible (/ai/code/edit o /ai/code/generate). Reiniciá o redeployá el RAG antes de editar landings con IA.');
      }
      throw err;
    }

    let guardada;
    if (esFichaEspecifica) {
      guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
        vistas: { productos: { [contentId]: codigo } },
      });
    } else if (esFicha) {
      guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
        vistas: { producto: codigo },
      });
    } else {
      guardada = await LandingSimpleService.actualizarCodigo(landingModel, tienda_id, inquilino_id, {
        titulo,
        codigo,
      });
    }
    await AiGenerationLogService.registrar({
      ...logBase, modelo, latenciaMs: Date.now() - inicio, tokensInput, tokensOutput,
      repairUsed, exitoso: true, validationErrorsPreRepair: erroresPreRepair,
    });
    return guardada;
  }
}

module.exports = AILandingService;
