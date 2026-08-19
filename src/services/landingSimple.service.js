'use strict';

/**
 * Servicio de "Landing simple": el modo con 3 templates rígidos (Fitness/
 * Beauty/Tech) — comercio elige un template y solo edita contenido
 * (identidad básica, productos, contacto, FAQ), nunca estructura. Vive
 * aparte de LandingService (sistema flexible/constructor) a propósito:
 * mismas tablas de datos (Landing/LandingItem/Faq), pero un whitelist de
 * escritura totalmente distinto y más chico. Ver LandingSeccion, que este
 * servicio NUNCA toca.
 *
 * Reutiliza de LandingService: generación de slug, resolución/validación
 * de items de catálogo, sincronizarItems/sincronizarFaq (mismo patrón
 * destroy-all + bulkCreate) y el helper de subida de imagen por campo —
 * son utilidades genéricas sobre el mismo modelo Landing, no algo propio
 * del constructor flexible.
 */

const { Landing, LandingItem, Faq, LandingBeneficio, LandingTemplate } = require('../models');
const LandingService = require('./landing.service');

// Claves que un intento de modificar la ESTRUCTURA de la landing usaría —
// se rechazan explícitamente (400), no se ignoran en silencio. Independiente
// del whitelist de campos editables: aunque ninguna de estas llegue a
// aplicarse igual (nunca están en camposEditablesSimple), acá se corta el
// request entero para que quede claro en la respuesta que fue rechazado.
const CLAVES_ESTRUCTURALES = [
  'sections', 'sectionOrder', 'sectionType', 'layout', 'columns', 'responsive',
  'structure', 'secciones', 'bloques', 'blocks', 'template_id', 'template_version', 'schema',
];

const MAX_BENEFICIOS = 6;

// Copy inicial de "Beneficios" y "Contenido adicional" por template — se
// siembra al crear() para que la landing se vea completa desde el primer
// momento (mismo texto que antes estaba hardcodeado en cada componente de
// React). De ahí en adelante es contenido editable como cualquier otro.
const DEFAULTS_POR_TEMPLATE = {
  'fitness-suplementos': {
    contenido_titulo: 'Nutrición pensada para tu objetivo',
    contenido_texto: 'Ya sea que busques ganar masa, definir o mejorar tu rendimiento, tenemos la combinación de suplementos justa para vos.',
    beneficios: [
      { titulo: 'Calidad certificada', texto: 'Fórmulas probadas, sin rellenos.', icono: 'shield' },
      { titulo: 'Envío rápido', texto: 'Recibilo en la puerta de tu casa.', icono: 'truck' },
      { titulo: 'Resultados reales', texto: 'Pensado para quien entrena en serio.', icono: 'flame' },
    ],
  },
  'beauty-skincare': {
    contenido_titulo: 'Rituales de belleza que se disfrutan',
    contenido_texto: 'Seleccionamos cada producto pensando en rutinas simples, efectivas y que te hagan sentir bien con vos misma.',
    beneficios: [
      { titulo: 'Ingredientes naturales', texto: 'Fórmulas suaves, libres de crueldad animal.', icono: 'leaf' },
      { titulo: 'Para cada tipo de piel', texto: 'Rutinas pensadas a tu medida.', icono: 'heart' },
      { titulo: 'Envío a domicilio', texto: 'Recibí tu pedido sin salir de casa.', icono: 'truck' },
    ],
  },
  'tech-electronica': {
    contenido_titulo: 'Innovación a un clic de distancia',
    contenido_texto: 'Seleccionamos los mejores gadgets y accesorios para que siempre estés a la vanguardia.',
    beneficios: [
      { titulo: 'Garantía oficial', texto: 'Productos originales, con respaldo.', icono: 'badge' },
      { titulo: 'Envío asegurado', texto: 'Seguimiento en tiempo real de tu pedido.', icono: 'truck' },
      { titulo: 'Última generación', texto: 'Lo nuevo en tecnología, siempre.', icono: 'zap' },
    ],
  },
  'basico': {
    contenido_titulo: 'Pensado para vos',
    contenido_texto: 'Seleccionamos cuidadosamente cada producto para que encuentres justo lo que necesitás, sin vueltas.',
    beneficios: [
      { titulo: 'Compra segura', texto: 'Pagos y datos siempre protegidos.', icono: 'shield' },
      { titulo: 'Envío a domicilio', texto: 'Recibilo donde estés.', icono: 'truck' },
      { titulo: 'Atención personalizada', texto: 'Te ayudamos en cada paso.', icono: 'headphones' },
    ],
  },
};

class LandingSimpleService {

  static rechazarClavesEstructurales(payload) {
    const encontradas = Object.keys(payload || {}).filter(k => CLAVES_ESTRUCTURALES.includes(k));
    if (encontradas.length) {
      throw new Error(`No se puede modificar la estructura de la landing (campos no permitidos: ${encontradas.join(', ')}).`);
    }
  }

  /** Único whitelist de escritura del modo rígido — nunca Object.assign(landing, payload). */
  static camposEditables(payload) {
    const campos = {};
    // Identidad — "titulo" es el nombre público del comercio, reutilizado
    // tal cual como en el sistema flexible.
    for (const campo of ['titulo', 'descripcion']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Hero — reutiliza las columnas banner_* ya existentes en Landing.
    for (const campo of ['banner_titulo', 'banner_subtitulo', 'banner_boton_texto', 'banner_boton_link', 'banner_opacidad']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Contacto — propio de cada landing rígida, no compartido con Tienda.
    for (const campo of [
      // Datos de contacto reales (página de Contacto)
      'contacto_whatsapp', 'contacto_telefono', 'contacto_email',
      'contacto_direccion', 'contacto_ciudad', 'contacto_pais', 'contacto_horarios',
      // Redes sociales (pie de la landing)
      'contacto_instagram', 'contacto_facebook', 'contacto_tiktok', 'contacto_youtube', 'contacto_twitter',
    ]) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Contenido adicional (título + párrafo, sección fija antes de Contacto),
    // productos (título de "Productos destacados") y catálogo (subtítulo de
    // la página /catalogo completa).
    for (const campo of ['contenido_titulo', 'contenido_texto', 'productos_titulo', 'catalogo_titulo', 'catalogo_descripcion']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo]?.trim ? (payload[campo].trim() || null) : (payload[campo] || null);
    }
    // Colores — tema único para toda la landing (no por sección), reutiliza
    // las columnas color_primario/fondo/texto ya existentes en Landing.
    // La validación de formato hexadecimal ya la hace
    // LandingService.validarPayload (ver actualizar() acá abajo).
    for (const campo of ['color_primario', 'color_fondo', 'color_texto']) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo] || null;
    }
    return campos;
  }

  /** Mismo patrón que sincronizarItems/sincronizarFaq: reemplazo total. */
  static async sincronizarBeneficios(landing_id, beneficios = []) {
    await LandingBeneficio.destroy({ where: { landing_id } });
    if (!beneficios.length) return;
    await LandingBeneficio.bulkCreate(beneficios.map((b, idx) => ({
      landing_id,
      titulo: b.titulo.trim(),
      texto: b.texto.trim(),
      icono: b.icono || null,
      orden: b.orden !== undefined ? Number(b.orden) : idx,
    })));
  }

  static validarBeneficios(beneficios) {
    const errores = [];
    if (!Array.isArray(beneficios)) return errores;
    if (beneficios.length > MAX_BENEFICIOS) {
      errores.push(`No se pueden agregar más de ${MAX_BENEFICIOS} beneficios.`);
    }
    beneficios.forEach((b, idx) => {
      if (!b?.titulo?.trim()) errores.push(`Beneficio #${idx + 1}: el título es obligatorio.`);
      if (!b?.texto?.trim()) errores.push(`Beneficio #${idx + 1}: el texto es obligatorio.`);
    });
    return errores;
  }

  static async obtenerTemplateRigido(template_id) {
    const template = await LandingTemplate.findOne({ where: { id: template_id, kind: 'rigido', status: 'published' } });
    if (!template) throw new Error('Template no encontrado.');
    return template;
  }

  /**
   * Todas las lecturas/escrituras de acá exigen kind='rigido' en el join
   * con el template — defensa en profundidad: aunque la tabla "landings"
   * sea compartida con el sistema flexible, esta clase nunca puede tocar
   * una fila que no haya nacido de uno de los 3 templates rígidos.
   */
  static async buscarPropia(id, tienda_id) {
    const landing = await Landing.findOne({
      where: { id, tienda_id },
      include: [{ model: LandingTemplate, as: 'template', required: true, where: { kind: 'rigido' } }],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    return landing;
  }

  static async listar(tienda_id) {
    const landings = await Landing.findAll({
      where: { tienda_id },
      include: [
        { model: LandingTemplate, as: 'template', required: true, where: { kind: 'rigido' } },
        { model: LandingItem, as: 'items', attributes: ['id'] },
      ],
      order: [['created_at', 'DESC']],
    });
    return landings.map(l => l.toJSON());
  }

  static async crear(tienda_id, inquilino_id, template_id) {
    const template = await this.obtenerTemplateRigido(template_id);
    const defaults = DEFAULTS_POR_TEMPLATE[template.slug];

    const slug = await LandingService.generarSlugUnico(template.name, tienda_id);
    // La landing rígida ES la landing principal de la tienda — se sirve en
    // la raíz del subdominio (https://sub.gesicomm.com/), no en /l/:slug
    // (ver resolverTienda.js / LandingService.obtenerPublica: es_home=true
    // es lo que resuelve GET /api/l/ sin slug). es_home es única por
    // tienda a nivel aplicación (sin constraint de DB) — se desactiva
    // cualquier otra landing que la tuviera antes de crear esta.
    await Landing.update({ es_home: false }, { where: { tienda_id, es_home: true } });
    const landing = await Landing.create({
      inquilino_id,
      tienda_id,
      template_id: template.id,
      nombre: template.name,
      titulo: template.name,
      slug,
      tipo_pagina: 'funnel',
      es_home: true,
      activo: false,
      // FAQ y Hero(banner) son secciones fijas en los 3 templates rígidos
      // (no un toggle opcional como en el sistema flexible) — se activan
      // siempre al crear, así obtenerPublica() nunca las omite.
      mostrar_faq: true,
      mostrar_banner: true,
      contenido_titulo: defaults?.contenido_titulo || null,
      contenido_texto: defaults?.contenido_texto || null,
    });

    if (defaults?.beneficios?.length) {
      await this.sincronizarBeneficios(landing.id, defaults.beneficios);
    }

    return this.obtener(landing.id, tienda_id);
  }

  static async obtener(id, tienda_id) {
    const landing = await Landing.findOne({
      where: { id, tienda_id },
      include: [
        { model: LandingTemplate, as: 'template', required: true, where: { kind: 'rigido' } },
        { model: LandingItem, as: 'items' },
        { model: Faq, as: 'faq' },
        { model: LandingBeneficio, as: 'beneficios' },
      ],
      order: [
        [{ model: LandingItem, as: 'items' }, 'orden', 'ASC'],
        [{ model: Faq, as: 'faq' }, 'orden', 'ASC'],
        [{ model: LandingBeneficio, as: 'beneficios' }, 'orden', 'ASC'],
      ],
    });
    if (!landing) throw new Error('Landing no encontrada.');
    return landing.toJSON();
  }

  static async actualizar(id, tienda_id, inquilino_id, payload) {
    this.rechazarClavesEstructurales(payload);

    const landing = await this.buscarPropia(id, tienda_id);

    const errores = [
      ...LandingService.validarPayload(payload),
      ...this.validarBeneficios(payload.beneficios),
    ];
    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    if (payload.items !== undefined) {
      await LandingService.resolverItemsCatalogo(payload.items, inquilino_id);
    }

    Object.assign(landing, this.camposEditables(payload));
    await landing.save();

    if (payload.items !== undefined) {
      await LandingService.sincronizarItems(landing.id, payload.items);
    }
    if (payload.faq !== undefined) {
      await LandingService.sincronizarFaq(landing.id, payload.faq);
    }
    if (payload.beneficios !== undefined) {
      await this.sincronizarBeneficios(landing.id, payload.beneficios);
    }

    return this.obtener(landing.id, tienda_id);
  }

  static async cambiarEstado(id, tienda_id, activo) {
    const landing = await this.buscarPropia(id, tienda_id);
    landing.activo = !!activo;
    await landing.save();
    return landing.toJSON();
  }

  static async eliminar(id, tienda_id) {
    const landing = await this.buscarPropia(id, tienda_id);
    await landing.destroy();
    return true;
  }

  /**
   * @returns {{landing: object, anterior: string|null}} anterior = URL vieja,
   * para que el controller borre ese archivo del disco (mismo contrato que
   * LandingService._actualizarImagenCampo, sin reusarlo directamente: acá
   * el DTO de retorno debe ser el de landingSimple, con template incluido
   * y sin secciones/testimonios del sistema flexible).
   */
  static async _actualizarImagenCampo(id, tienda_id, campo, url) {
    const landing = await this.buscarPropia(id, tienda_id);
    const anterior = landing[campo];
    landing[campo] = url;
    await landing.save();
    return { landing: await this.obtener(id, tienda_id), anterior };
  }

  static actualizarImagenLogo(id, tienda_id, url) {
    return this._actualizarImagenCampo(id, tienda_id, 'logo_imagen', url);
  }

  static quitarImagenLogo(id, tienda_id) {
    return this._actualizarImagenCampo(id, tienda_id, 'logo_imagen', null);
  }

  static actualizarImagenHero(id, tienda_id, url) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', url);
  }

  static quitarImagenHero(id, tienda_id) {
    return this._actualizarImagenCampo(id, tienda_id, 'banner_imagen', null);
  }
}

module.exports = LandingSimpleService;
