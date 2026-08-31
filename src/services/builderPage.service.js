'use strict';

/**
 * Páginas del Page Builder: identidad, slug, SEO y destino del CTA.
 *
 * Lo que NO está acá: el código HTML/CSS/JS y su versionado. Eso vive en
 * builderPageVersion.service.js (FASE 3). Esta capa maneja la fila de
 * builder_pages, no su contenido.
 *
 * ⚠️ UNA PÁGINA DEL BUILDER NO PERTENECE A NINGUNA TIENDA. Es una página
 * suelta, sin dependencias, de un usuario. Existe aunque su dueño no
 * tenga tienda (el caso de todos los administradores). El dueño es
 * `usuario_id` y ese es el filtro de TODA consulta — un id de otro
 * usuario devuelve 404 y no 403: un 403 confirmaría que ese id existe.
 *
 * `inquilino_id` se guarda por convención del proyecto y para reportes,
 * pero NO es el control de acceso de este módulo.
 *
 * ÁMBITO DEL SLUG — la parte con truco:
 *
 *   funnel_id NULL  →  /p/<slug>              slug único GLOBAL
 *   funnel_id = X   →  /f/<funnel>/<slug>     slug único por FUNNEL
 *
 * Son dos índices parciales distintos en la base (ver las migraciones).
 * Global y no por usuario porque sin tienda no hay hostname que separe un
 * espacio de nombres de otro: todas las páginas sueltas comparten el
 * mismo host del builder. Por eso los slugs autogenerados llevan sufijo
 * aleatorio — en la práctica nunca chocan.
 *
 * Y por eso mover una página adentro o afuera de un funnel le cambia el
 * ámbito de unicidad al slug y hay que revalidarlo: lo hace
 * builderFunnel.service.js antes de mover nada.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const slugify = require('slugify');

const { BuilderPage } = require('../models');
const { esSlugReservado } = require('../utils/slugsReservados');
const { errorHttp } = require('../utils/errorHttp');

const FORMATO_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_SLUG = 120;

// Campos de texto que el PUT puede tocar. og_imagen y favicon_url quedan
// AFUERA a propósito: esos solo los escribe el endpoint de subida, igual
// que Landing.banner_imagen — si no, se podría apuntar el Open Graph a
// cualquier archivo del servidor escribiendo la ruta a mano.
const CAMPOS_EDITABLES = [
  'nombre', 'seo_titulo', 'seo_descripcion', 'og_titulo', 'og_descripcion',
];

// NavigationTarget — ver §5.2 del plan. Los tipos están todos declarados
// desde el día 1, pero 'checkout' y 'upsell' todavía no los resuelve nadie
// (builderNavegacion.service.js los devuelve como '#' con advertencia).
// Declararlos igual es el punto: el día que exista el checkout se toca un
// solo `case`, no el modelo ni el editor.
const TIPOS_DESTINO = {
  external_url: ['url'],
  builder_page: ['pagina_slug'],
  funnel_step: ['paso'],
  gesicomm_product: ['producto_slug'],
  checkout: ['producto_slug', 'oferta_id'],
  upsell: ['oferta_id'],
};

const PASOS_FUNNEL = ['next', 'prev', 'entry'];

class BuilderPageService {

  // ─── Serialización ──────────────────────────────────────────────────

  /**
   * @param {object} pagina fila de BuilderPage
   * @param {{funnelSlug?: string|null, paso?: object|null}} [opciones]
   */
  static serializar(pagina, opciones = {}) {
    const funnelSlug = opciones.funnelSlug ?? pagina.funnel?.slug ?? null;
    const paso = opciones.paso ?? pagina.paso ?? null;

    return {
      id: pagina.id,
      proyecto_id: pagina.proyecto_id,
      funnel_id: pagina.funnel_id,
      nombre: pagina.nombre,
      slug: pagina.slug,
      estado: pagina.estado,
      seo_titulo: pagina.seo_titulo,
      seo_descripcion: pagina.seo_descripcion,
      og_titulo: pagina.og_titulo,
      og_descripcion: pagina.og_descripcion,
      og_imagen: pagina.og_imagen,
      favicon_url: pagina.favicon_url,
      destino_cta: pagina.destino_cta,
      draft_version_id: pagina.draft_version_id,
      published_version_id: pagina.published_version_id,
      published_at: pagina.published_at,
      // Lo que la UI pinta en naranja: hay borrador guardado que todavía
      // no se publicó. Es la pregunta que más se hace el comercio.
      tiene_cambios_sin_publicar:
        pagina.draft_version_id != null
        && pagina.draft_version_id !== pagina.published_version_id,
      posicion: paso?.posicion ?? null,
      es_entrada: paso?.es_entrada ?? false,
      path_publico: this.pathPublico(pagina, funnelSlug),
      created_at: pagina.created_at,
      updated_at: pagina.updated_at,
    };
  }

  /**
   * Path relativo dentro del host público del builder. La URL absoluta la
   * arma el frontend (lib/urlPublicaBuilder.js), que es el que sabe si
   * está corriendo en local o contra el host real.
   */
  static pathPublico(pagina, funnelSlug) {
    if (!pagina.funnel_id) return `/p/${pagina.slug}`;
    return funnelSlug ? `/f/${funnelSlug}/${pagina.slug}` : null;
  }

  // ─── Slugs ──────────────────────────────────────────────────────────

  /**
   * Sufijo aleatorio y siempre, no secuencial: mismo criterio que
   * LandingService.generarSlugUnico. Un "-2", "-3" en una URL pública
   * delata cuántas páginas parecidas hay y las vuelve enumerables. Acá
   * además cumple una segunda función: como el slug de una página suelta
   * es único GLOBAL, sin el sufijo dos usuarios que llamen "Landing" a su
   * página chocarían siempre.
   *
   * @param {string} nombre
   * @param {{funnel_id?: number|null}} ambito
   */
  static async generarSlugUnico(nombre, ambito = {}) {
    const base = slugify(String(nombre || ''), { lower: true, strict: true }) || 'pagina';
    
    if (!esSlugReservado(base) && !(await this.slugOcupado(base, ambito))) {
      return base;
    }

    let slug;
    do {
      slug = `${base}-${crypto.randomBytes(3).toString('hex')}`.slice(0, MAX_SLUG);
    } while (esSlugReservado(slug) || await this.slugOcupado(slug, ambito));
    return slug;
  }

  /**
   * @param {string} slug
   * @param {{funnel_id?: number|null, excluirId?: number|null}} ambito
   */
  static async slugOcupado(slug, ambito = {}) {
    const { funnel_id = null, excluirId = null } = ambito;
    // El where cambia según el ámbito, igual que los dos índices parciales
    // de la base: global si la página es suelta, por funnel si no.
    const where = funnel_id ? { funnel_id, slug } : { slug, funnel_id: null };
    if (excluirId) where.id = { [Op.ne]: excluirId };
    return !!(await BuilderPage.findOne({ where }));
  }

  /**
   * Normaliza y valida un slug propuesto por el usuario. Lanza si no sirve.
   * @param {{funnel_id?: number|null, excluirId?: number|null}} ambito
   */
  static async asegurarSlugDisponible(slugPropuesto, ambito = {}) {
    const limpio = slugify(String(slugPropuesto || ''), { lower: true, strict: true });

    if (!limpio || !FORMATO_SLUG.test(limpio)) {
      throw errorHttp('El slug solo puede tener minúsculas, números y guiones, y no puede empezar ni terminar con guión.', 422);
    }
    if (limpio.length > MAX_SLUG) {
      throw errorHttp(`El slug no puede superar los ${MAX_SLUG} caracteres.`, 422);
    }
    if (esSlugReservado(limpio)) {
      throw errorHttp(`"${limpio}" es una dirección reservada del sistema. Elegí otra.`, 422);
    }
    if (await this.slugOcupado(limpio, ambito)) {
      throw errorHttp(
        ambito.funnel_id
          ? 'Ya hay otra página con ese slug en este funnel.'
          : 'Ese slug ya está en uso. Probá con otro.',
        409,
      );
    }
    return limpio;
  }

  // ─── NavigationTarget ───────────────────────────────────────────────

  /**
   * Valida la forma de un destino_cta. NO lo resuelve a una URL: eso es
   * builderNavegacion.service.js (FASE 8). Acá solo se impide que quede
   * JSON arbitrario guardado en la columna.
   */
  static validarDestinoCta(destino) {
    if (destino === null || destino === undefined) return null;

    if (typeof destino !== 'object' || Array.isArray(destino)) {
      throw errorHttp('El destino del CTA debe ser un objeto { tipo, ... }.', 422);
    }

    const permitidas = TIPOS_DESTINO[destino.tipo];
    if (!permitidas) {
      throw errorHttp(
        `Tipo de destino desconocido: "${destino.tipo}". Válidos: ${Object.keys(TIPOS_DESTINO).join(', ')}.`,
        422,
      );
    }

    const sobrantes = Object.keys(destino).filter(k => k !== 'tipo' && !permitidas.includes(k));
    if (sobrantes.length) {
      throw errorHttp(`El destino "${destino.tipo}" no acepta: ${sobrantes.join(', ')}.`, 422);
    }

    // Este href se termina renderizando en una página pública. Un
    // "javascript:" acá sería XSS con solo compartir el link — mismo
    // criterio que LandingService.linkBannerEsSeguro.
    if (destino.tipo === 'external_url') {
      const url = String(destino.url || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        throw errorHttp('La URL externa tiene que empezar con http:// o https://.', 422);
      }
      return { tipo: 'external_url', url };
    }

    if (destino.tipo === 'funnel_step' && !PASOS_FUNNEL.includes(destino.paso)) {
      throw errorHttp(`El paso tiene que ser uno de: ${PASOS_FUNNEL.join(', ')}.`, 422);
    }

    const limpio = { tipo: destino.tipo };
    for (const clave of permitidas) {
      if (destino[clave] !== undefined) limpio[clave] = destino[clave];
    }
    return limpio;
  }

  // ─── CRUD ───────────────────────────────────────────────────────────

  /** Busca una página de ESTE usuario. Lanza 404 si no es suya o no existe. */
  static async buscarPropia(id, usuario_id, opciones = {}) {
    const pagina = await BuilderPage.findOne({ where: { id, usuario_id }, ...opciones });
    if (!pagina) throw errorHttp('Página no encontrada.', 404);
    return pagina;
  }

  /**
   * @param {{proyecto_id: number, usuario_id: number, inquilino_id: number, funnel_id?: number|null}} contexto
   * @param {{nombre?: string, slug?: string}} datos
   * @param {import('sequelize').Transaction} [transaction]
   */
  static async crear(contexto, datos, transaction = null) {
    const { proyecto_id, usuario_id, inquilino_id, funnel_id = null } = contexto;

    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw errorHttp('El nombre de la página es requerido.', 422);
    if (nombre.length > 150) throw errorHttp('El nombre no puede superar los 150 caracteres.', 422);

    const ambito = { funnel_id };
    const slug = datos.slug
      ? await this.asegurarSlugDisponible(datos.slug, ambito)
      : await this.generarSlugUnico(nombre, ambito);

    return BuilderPage.create({
      proyecto_id,
      funnel_id,
      usuario_id,
      inquilino_id,
      nombre,
      slug,
      estado: 'draft',
    }, { transaction });
  }

  static async obtener(id, usuario_id) {
    const pagina = await this.buscarPropia(id, usuario_id, {
      include: [
        { association: 'funnel', attributes: ['id', 'slug', 'nombre'] },
        { association: 'paso', attributes: ['posicion', 'es_entrada'] },
      ],
    });
    return this.serializar(pagina);
  }

  static async actualizar(id, usuario_id, datos) {
    const pagina = await this.buscarPropia(id, usuario_id, {
      include: [{ association: 'funnel', attributes: ['id', 'slug'] }],
    });

    if (datos.slug !== undefined) {
      // El ámbito sale de la propia página, no de lo que pida el cliente.
      pagina.slug = await this.asegurarSlugDisponible(datos.slug, {
        funnel_id: pagina.funnel_id,
        excluirId: pagina.id,
      });
    }

    if (datos.destino_cta !== undefined) {
      pagina.destino_cta = this.validarDestinoCta(datos.destino_cta);
    }

    for (const campo of CAMPOS_EDITABLES) {
      if (datos[campo] === undefined) continue;
      if (campo === 'nombre') {
        const nombre = String(datos.nombre || '').trim();
        if (!nombre) throw errorHttp('El nombre de la página es requerido.', 422);
        pagina.nombre = nombre;
        continue;
      }
      const valor = datos[campo] === null ? null : String(datos[campo]).trim();
      pagina[campo] = valor || null;
    }

    await pagina.save();
    return this.serializar(pagina);
  }

  static async eliminar(id, usuario_id) {
    const pagina = await this.buscarPropia(id, usuario_id);

    // Evitamos violar chk_builder_domains_target (igual que al borrar funnel).
    const { BuilderDomain } = require('../models');
    await BuilderDomain.destroy({ where: { pagina_id: pagina.id } });

    // Las versiones se van por ON DELETE CASCADE, y el paso del funnel
    // también (ver la migración). No hace falta borrarlos a mano.
    await pagina.destroy();
    return true;
  }
}

module.exports = BuilderPageService;
module.exports.TIPOS_DESTINO = TIPOS_DESTINO;
module.exports.FORMATO_SLUG = FORMATO_SLUG;
