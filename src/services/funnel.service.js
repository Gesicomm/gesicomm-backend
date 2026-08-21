'use strict';

/**
 * Servicio de EMBUDOS (funnels): una página de un solo producto, pensada
 * para llevar al comprador de la visita al checkout sin distracciones.
 *
 * Vive aparte de LandingSimpleService (landing de la tienda) y de
 * LandingService (constructor flexible, DEPRECADO) a propósito: mismas
 * tablas (Landing/Faq/LandingBeneficio/Testimonio), pero un whitelist de
 * escritura propio y mucho más chico. Nunca toca LandingSeccion.
 *
 * Un embudo es una Landing discriminada por su template:
 *   template.kind = 'funnel'  ·  producto_id = X  ·  es_home = false
 *
 * El comercio edita SOLO contenido; la estructura de la página vive en el
 * componente React del template (pages/funnel/templates/), no en la base.
 *
 * Reutiliza de LandingService: generarSlugUnico, sincronizarFaq y
 * sincronizarTestimonios — son utilidades genéricas sobre el mismo modelo,
 * no algo propio del constructor flexible.
 */

const { Landing, LandingTemplate, Faq, LandingBeneficio, Testimonio, Producto } = require('../models');
const LandingService = require('./landing.service');

// Igual que en el modo rígido: un intento de modificar la ESTRUCTURA se
// rechaza con 400 explícito, no se ignora en silencio. En un embudo la
// estructura es el punto — si se pudiera reordenar, dejaría de ser un
// embudo y volvería a ser un armador de páginas.
const CLAVES_ESTRUCTURALES = [
  'sections', 'sectionOrder', 'sectionType', 'layout', 'columns', 'responsive',
  'structure', 'secciones', 'bloques', 'blocks', 'template_id', 'template_version', 'schema',
];

const MAX_BENEFICIOS = 6;
const MAX_CONFIANZA = 3;
const MAX_OPINIONES = 12;

// Set cerrado: el comercio elige de esta lista, no escribe un icono libre
// (un icono arbitrario rompería el render y permitiría inyectar markup).
const ICONOS_CONFIANZA = new Set(['envio', 'pago', 'devolucion', 'garantia', 'soporte']);

const CONFIANZA_DEFAULT = [
  { icono: 'envio', texto: 'Envío a todo el país' },
  { icono: 'pago', texto: 'Pago seguro' },
  { icono: 'devolucion', texto: 'Cambios y devoluciones' },
];

class FunnelService {

  static rechazarClavesEstructurales(payload) {
    const encontradas = Object.keys(payload || {}).filter(k => CLAVES_ESTRUCTURALES.includes(k));
    if (encontradas.length) {
      throw new Error(`No se puede modificar la estructura del embudo (campos no permitidos: ${encontradas.join(', ')}).`);
    }
  }

  /**
   * Contenido propio del embudo, guardado en Landing.content (JSON). Se
   * normaliza clave por clave: lo que no está acá no se guarda, así el
   * comercio no puede meter estructura disfrazada de contenido.
   */
  static normalizarContent(content = {}, previo = {}) {
    const out = { ...previo };

    if (content.propuesta_valor !== undefined) {
      const v = String(content.propuesta_valor || '').trim();
      out.propuesta_valor = v ? v.slice(0, 300) : null;
    }
    if (content.descripcion_titulo !== undefined) {
      const v = String(content.descripcion_titulo || '').trim();
      out.descripcion_titulo = v ? v.slice(0, 120) : null;
    }
    if (content.cta_primario !== undefined) {
      const v = String(content.cta_primario || '').trim();
      out.cta_primario = v ? v.slice(0, 40) : null;
    }
    if (content.mostrar_agregar_carrito !== undefined) {
      out.mostrar_agregar_carrito = content.mostrar_agregar_carrito !== false;
    }
    if (content.mostrar_whatsapp !== undefined) {
      out.mostrar_whatsapp = content.mostrar_whatsapp !== false;
    }
    if (content.confianza !== undefined) {
      const lista = Array.isArray(content.confianza) ? content.confianza : [];
      out.confianza = lista
        .filter(c => c && ICONOS_CONFIANZA.has(c.icono) && String(c.texto || '').trim())
        .slice(0, MAX_CONFIANZA)
        .map(c => ({ icono: c.icono, texto: String(c.texto).trim().slice(0, 60) }));
    }
    return out;
  }

  /** Único whitelist de escritura del embudo — nunca Object.assign(landing, payload). */
  static camposEditables(payload) {
    const campos = {};
    // Identidad interna del embudo (no se muestra al comprador: el nombre
    // público del producto sale del Producto).
    if (payload.nombre !== undefined) {
      campos.nombre = String(payload.nombre || '').trim() || null;
    }
    // Colores — tema único de toda la página, mismas columnas que el resto.
    // El formato hex lo valida LandingService.validarPayload (ver actualizar).
    for (const campo of ['color_primario', 'color_fondo', 'color_texto']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo] || null;
    }
    return campos;
  }

  static async obtenerTemplateFunnel(template_id) {
    const template = await LandingTemplate.findOne({
      where: { id: template_id, kind: 'funnel', status: 'published' },
    });
    if (!template) throw new Error('El tipo de embudo seleccionado no existe.');
    return template;
  }

  static async listarTemplates() {
    const templates = await LandingTemplate.findAll({
      where: { kind: 'funnel', status: 'published' },
      order: [['id', 'ASC']],
    });
    return templates.map(t => t.toJSON());
  }

  /** Reemplazo total, mismo patrón que sincronizarFaq/sincronizarTestimonios. */
  static async sincronizarBeneficios(landing_id, beneficios = []) {
    await LandingBeneficio.destroy({ where: { landing_id } });
    const limpios = (beneficios || [])
      .filter(b => b && String(b.titulo || '').trim())
      .slice(0, MAX_BENEFICIOS);
    if (!limpios.length) return;
    await LandingBeneficio.bulkCreate(limpios.map((b, idx) => ({
      landing_id,
      titulo: String(b.titulo).trim(),
      texto: b.texto ? String(b.texto).trim() : null,
      icono: b.icono || null,
      orden: idx,
    })));
  }

  static async listar(tienda_id) {
    const funnels = await Landing.findAll({
      where: { tienda_id },
      include: [
        { model: LandingTemplate, as: 'template', required: true, where: { kind: 'funnel' } },
        { model: Producto, as: 'producto', required: false, attributes: ['id', 'nombre', 'slug'] },
      ],
      order: [['id', 'DESC']],
    });
    return funnels.map(f => f.toJSON());
  }

  /** El embudo de UN producto — un producto tiene a lo sumo un embudo. */
  static async obtenerPorProducto(producto_id, tienda_id) {
    const funnel = await Landing.findOne({
      where: { producto_id, tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: 'funnel' } }],
    });
    if (!funnel) return null;
    return this.obtener(funnel.id, tienda_id);
  }

  static async crear(tienda_id, inquilino_id, producto_id, template_id) {
    const template = await this.obtenerTemplateFunnel(template_id);

    const producto = await Producto.findOne({
      where: { id: producto_id, inquilino_id },
      attributes: ['id', 'nombre', 'slug'],
    });
    if (!producto) throw new Error('Producto no encontrado.');

    // Idempotencia: un producto tiene a lo sumo un embudo. Si ya existe se
    // le cambia el tipo en vez de crear un segundo (dos embudos del mismo
    // producto competirían por el mismo tráfico y confundirían las métricas).
    const existente = await Landing.findOne({
      where: { producto_id, tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: 'funnel' } }],
    });
    if (existente) {
      if (existente.template_id !== template.id) {
        await existente.update({ template_id: template.id, template_version: template.version });
      }
      return this.obtener(existente.id, tienda_id);
    }

    // Slug propio, derivado del producto — es la URL que se comparte en los
    // anuncios. es_home queda false: el embudo NO reemplaza la landing de
    // la tienda, convive con ella en su propio slug.
    const slug = await LandingService.generarSlugUnico(producto.nombre, tienda_id);

    const funnel = await Landing.create({
      inquilino_id,
      tienda_id,
      producto_id: producto.id,
      template_id: template.id,
      template_version: template.version,
      nombre: `Embudo: ${producto.nombre}`,
      // titulo queda null a propósito: en el DTO público es el nombre del
      // COMERCIO (header y copyright), no el del producto — si se copiara
      // acá el nombre del producto, el pie diría "© 2026 Tiras nasales".
      // Sin valor, cae al nombre real de la tienda.
      titulo: null,
      slug,
      tipo_pagina: 'funnel',
      es_home: false,
      activo: false, // nace en borrador
      mostrar_faq: true,
      mostrar_testimonios: true,
      content: this.normalizarContent({ confianza: CONFIANZA_DEFAULT }),
    });

    return this.obtener(funnel.id, tienda_id);
  }

  static async obtener(id, tienda_id) {
    const funnel = await Landing.findOne({
      where: { id, tienda_id },
      include: [
        { model: LandingTemplate, as: 'template', required: true, where: { kind: 'funnel' } },
        { model: Producto, as: 'producto', required: false, attributes: ['id', 'nombre', 'slug'] },
        { model: Faq, as: 'faq' },
        { model: LandingBeneficio, as: 'beneficios' },
        { model: Testimonio, as: 'testimonios' },
      ],
      order: [
        [{ model: Faq, as: 'faq' }, 'orden', 'ASC'],
        [{ model: LandingBeneficio, as: 'beneficios' }, 'orden', 'ASC'],
        [{ model: Testimonio, as: 'testimonios' }, 'orden', 'ASC'],
      ],
    });
    if (!funnel) throw new Error('Embudo no encontrado.');
    return funnel.toJSON();
  }

  static async actualizar(id, tienda_id, payload) {
    this.rechazarClavesEstructurales(payload);

    const funnel = await Landing.findOne({
      where: { id, tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: 'funnel' } }],
    });
    if (!funnel) throw new Error('Embudo no encontrado.');

    const campos = this.camposEditables(payload);
    // Mismo validador de colores/formato que usa el resto de las landings —
    // no se duplica la regla del hex acá.
    const errores = LandingService.validarPayload(campos);
    if (errores && errores.length) throw new Error(errores.join(' '));

    if (payload.content !== undefined) {
      campos.content = this.normalizarContent(payload.content, funnel.content || {});
    }

    await funnel.update(campos);

    if (payload.beneficios !== undefined) {
      await this.sincronizarBeneficios(funnel.id, payload.beneficios);
    }
    if (payload.faq !== undefined) {
      await LandingService.sincronizarFaq(funnel.id, (payload.faq || [])
        .filter(f => String(f?.pregunta || '').trim() && String(f?.respuesta || '').trim()));
    }
    if (payload.testimonios !== undefined) {
      await LandingService.sincronizarTestimonios(funnel.id, (payload.testimonios || [])
        .filter(t => String(t?.nombre || '').trim() && String(t?.comentario || '').trim())
        .slice(0, MAX_OPINIONES)
        .map(t => ({ ...t, calificacion: Math.min(5, Math.max(1, Number(t.calificacion) || 5)) })));
    }

    return this.obtener(funnel.id, tienda_id);
  }

  static async cambiarEstado(id, tienda_id, activo) {
    const funnel = await Landing.findOne({
      where: { id, tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: 'funnel' } }],
    });
    if (!funnel) throw new Error('Embudo no encontrado.');
    // Un embudo sin producto no tiene nada que vender — mismo criterio que
    // LandingService.cambiarEstado para funnels.
    if (activo && !funnel.producto_id) throw new Error('No se puede publicar un embudo sin producto.');
    await funnel.update({ activo: !!activo });
    return this.obtener(funnel.id, tienda_id);
  }

  static async eliminar(id, tienda_id) {
    const funnel = await Landing.findOne({
      where: { id, tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: 'funnel' } }],
    });
    if (!funnel) throw new Error('Embudo no encontrado.');
    await funnel.destroy();
    return { eliminado: true };
  }
}

module.exports = FunnelService;
