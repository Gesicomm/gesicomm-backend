'use strict';

/**
 * Renderer público del Page Builder: lo que ve un visitante.
 *
 * REGLA ABSOLUTA: acá se carga EXCLUSIVAMENTE `published_version_id`.
 * Nunca el borrador. Ni por un parámetro, ni por un flag, ni "solo para
 * probar". Si la página no tiene versión publicada, no existe para el
 * visitante. La única excepción es el preview autenticado, que exige la
 * cookie de sesión del dueño y vive en obtenerPreview().
 *
 * DOS FORMAS DE LLEGAR A UNA PÁGINA:
 *
 *  1. Por HOSTNAME — la forma canónica.
 *       calcula.gesicomm.com/          → la página suelta de ese hostname
 *       creatina.gesicomm.com/         → la página de entrada del funnel
 *       creatina.gesicomm.com/oferta   → ese paso del funnel
 *       t2e.com.py/                    → ídem, con dominio propio
 *
 *  2. Por PATH, en el host de la app — el fallback.
 *       /p/<slug>                      → página suelta
 *       /f/<funnel-slug>/<pagina-slug> → paso de un funnel
 *     Existe para que una página tenga URL antes de que le asignen
 *     hostname, y para poder probarla en desarrollo (en localhost no hay
 *     subdominios que resuelvan).
 *
 * Este service NO arma el documento HTML final: devuelve el código y los
 * metadatos. El documento lo arma el frontend con
 * construirDocumentoCodigo.js + CodigoPreview, que es EL MISMO componente
 * que usa el editor para el preview. Dos renderers para la misma vista
 * divergen siempre.
 */

const { BuilderDomain, BuilderPage, BuilderPageVersion, BuilderFunnel, BuilderFunnelPage } = require('../models');
const BuilderNavegacionService = require('./builderNavegacion.service');
const { errorHttp } = require('../utils/errorHttp');

class BuilderPublicPageService {

  // ─── Resolución ─────────────────────────────────────────────────────

  /**
   * ¿Este hostname es del Page Builder? Devuelve el registro o null.
   * Solo resuelve hostnames listos para servir: un dominio propio a
   * medio verificar no puede secuestrar tráfico.
   */
  static async resolverHostname(host) {
    const limpio = String(host || '').toLowerCase().split(':')[0].trim();
    if (!limpio) return null;

    return BuilderDomain.findOne({
      where: {
        hostname: limpio,
        estado_verificacion: 'verificado',
        estado_ssl: 'activo',
      },
    });
  }

  /**
   * Página a servir para un hostname + path.
   *
   * @param {object} registro fila de BuilderDomain ya resuelta
   * @param {string|null} pageSlug null = la raíz del hostname
   */
  static async porHostname(registro, pageSlug = null) {
    if (registro.pagina_id) {
      // Hostname de una página suelta: se sirve en la raíz. Cualquier
      // sub-path es un 404, no un alias de la misma página.
      if (pageSlug) throw errorHttp('Página no encontrada.', 404);
      const pagina = await BuilderPage.findByPk(registro.pagina_id);
      return this.armar(pagina, null, { porHostname: true });
    }

    const funnel = await BuilderFunnel.findByPk(registro.funnel_id);
    if (!funnel) throw errorHttp('Página no encontrada.', 404);

    const pagina = pageSlug
      ? await BuilderPage.findOne({ where: { funnel_id: funnel.id, slug: pageSlug } })
      : await this.paginaDeEntrada(funnel.id);

    return this.armar(pagina, funnel, { porHostname: true });
  }

  /** Fallback: /p/<slug> en el host de la app. */
  static async porSlugSuelto(slug) {
    const pagina = await BuilderPage.findOne({
      where: { slug: String(slug || ''), funnel_id: null },
    });
    return this.armar(pagina, null);
  }

  /** Fallback: /f/<funnel>/<pagina> en el host de la app. */
  static async porSlugDeFunnel(funnelSlug, pageSlug = null) {
    const funnel = await BuilderFunnel.findOne({ where: { slug: String(funnelSlug || '') } });
    if (!funnel) throw errorHttp('Página no encontrada.', 404);

    const pagina = pageSlug
      ? await BuilderPage.findOne({ where: { funnel_id: funnel.id, slug: pageSlug } })
      : await this.paginaDeEntrada(funnel.id);

    return this.armar(pagina, funnel);
  }

  /** La entrada del funnel; si nadie la marcó, la de posición más baja. */
  static async paginaDeEntrada(funnel_id) {
    const paso = await BuilderFunnelPage.findOne({
      where: { funnel_id, es_entrada: true },
    }) || await BuilderFunnelPage.findOne({
      where: { funnel_id },
      order: [['posicion', 'ASC']],
    });

    return paso ? BuilderPage.findByPk(paso.pagina_id) : null;
  }

  // ─── Armado de la respuesta ─────────────────────────────────────────

  /**
   * @param {object|null} pagina
   * @param {object|null} funnel
   */
  static async armar(pagina, funnel, opciones = {}) {
    if (!pagina) throw errorHttp('Página no encontrada.', 404);

    // ⚠️ Acá está la regla entera del módulo: se lee published_version_id
    // y NADA MÁS. Si es null, para el visitante esta página no existe.
    if (!pagina.published_version_id) {
      const err = errorHttp('Esta página todavía no está publicada.', 404);
      err.enConstruccion = true;
      throw err;
    }

    const version = await BuilderPageVersion.findByPk(pagina.published_version_id);
    if (!version) throw errorHttp('Página no encontrada.', 404);

    const navegacion = funnel ? await this.navegacionDe(funnel, pagina) : null;

    // Los tokens ({{siguiente}}, {{cta}}...) se resuelven ACÁ, al
    // renderizar, y no al guardar: así renombrar un slug o reordenar el
    // funnel no obliga a reescribir las páginas que lo enlazan.
    const { html, advertencias } = BuilderNavegacionService.resolverTokens(version.html, {
      funnel,
      pagina,
      paginas: navegacion ? navegacion.paginas : [],
      porHostname: !!opciones.porHostname,
      destino_cta: pagina.destino_cta,
    });

    return {
      pagina: {
        id: pagina.id,
        nombre: pagina.nombre,
        slug: pagina.slug,
      },
      funnel: funnel ? { id: funnel.id, nombre: funnel.nombre, slug: funnel.slug } : null,
      codigo: { html, css: version.css, js: version.js },
      version: version.version,
      // Solo se devuelven al preview del editor; en la página pública no
      // le sirven a nadie, pero tampoco filtran nada privado.
      advertencias_navegacion: advertencias,
      seo: {
        titulo: pagina.seo_titulo || pagina.nombre,
        descripcion: pagina.seo_descripcion || '',
        og_titulo: pagina.og_titulo || pagina.seo_titulo || pagina.nombre,
        og_descripcion: pagina.og_descripcion || pagina.seo_descripcion || '',
        og_imagen: pagina.og_imagen || null,
        favicon: pagina.favicon_url || null,
      },
      navegacion,
    };
  }

  /** Los pasos PUBLICADOS del funnel, en orden, y dónde está este. */
  static async navegacionDe(funnel, paginaActual) {
    const pasos = await BuilderFunnelPage.findAll({
      where: { funnel_id: funnel.id },
      order: [['posicion', 'ASC']],
    });

    const paginas = [];
    for (const paso of pasos) {
      const p = await BuilderPage.findByPk(paso.pagina_id);
      // Un paso sin publicar no existe para el visitante: si apareciera
      // acá, {{siguiente}} lo llevaría a un 404.
      if (p && p.published_version_id) {
        paginas.push({ slug: p.slug, nombre: p.nombre, posicion: paso.posicion });
      }
    }

    const indice = paginas.findIndex(p => p.slug === paginaActual.slug);
    return {
      funnel_slug: funnel.slug,
      paginas,
      actual: indice,
      siguiente: indice >= 0 && indice < paginas.length - 1 ? paginas[indice + 1].slug : null,
      anterior: indice > 0 ? paginas[indice - 1].slug : null,
    };
  }

  // ─── Preview autenticado ────────────────────────────────────────────

  /**
   * El BORRADOR, solo para el dueño. No es "mostrarle el draft al
   * visitante": exige que la cookie de sesión corresponda al dueño de la
   * página. Mismo criterio que el preview de landings
   * (landingPublica.controller.js).
   */
  static async obtenerPreview(pagina_id, usuario_id) {
    const pagina = await BuilderPage.findOne({ where: { id: pagina_id, usuario_id } });
    if (!pagina) throw errorHttp('Página no encontrada.', 404);
    if (!pagina.draft_version_id) throw errorHttp('Esta página no tiene nada guardado.', 404);

    const version = await BuilderPageVersion.findByPk(pagina.draft_version_id);
    const funnel = pagina.funnel_id ? await BuilderFunnel.findByPk(pagina.funnel_id) : null;
    const navegacion = funnel ? await this.navegacionDe(funnel, pagina) : null;

    // Los tokens se resuelven igual que en la página pública: si el
    // preview no los resolviera, el editor mostraría "{{siguiente}}" en
    // pantalla y el comercio no podría probar la navegación.
    const { html, advertencias } = BuilderNavegacionService.resolverTokens(version.html, {
      funnel,
      pagina,
      paginas: navegacion ? navegacion.paginas : [],
      porHostname: false,
      destino_cta: pagina.destino_cta,
    });

    return {
      pagina: { id: pagina.id, nombre: pagina.nombre, slug: pagina.slug },
      funnel: funnel ? { id: funnel.id, nombre: funnel.nombre, slug: funnel.slug } : null,
      codigo: { html, css: version.css, js: version.js },
      version: version.version,
      advertencias_navegacion: advertencias,
      es_borrador: true,
      seo: {
        titulo: pagina.seo_titulo || pagina.nombre,
        descripcion: pagina.seo_descripcion || '',
      },
      navegacion,
    };
  }
}

module.exports = BuilderPublicPageService;
