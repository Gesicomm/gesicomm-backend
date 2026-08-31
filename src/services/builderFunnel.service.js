'use strict';

/**
 * Funnels del Page Builder: una secuencia ordenada de páginas de código.
 *
 * ⚠️ NO es el "embudo" de funnel.service.js. Ese es una landing de un solo
 * producto sobre la tabla `landings`, con estructura rígida en React. Este
 * es un flujo de páginas HTML/CSS/JS arbitrarias:
 *
 *   ① Landing → ② Oferta → ③ Checkout → ④ Gracias
 *
 * ⚠️ Tampoco pertenece a ninguna tienda: el dueño es `usuario_id` y ese es
 * el filtro de toda consulta. Ver la cabecera de builderPage.service.js.
 *
 * EL ORDEN VIVE SOLO EN builder_funnel_pages. builder_pages no tiene
 * `posicion` ni `es_entrada` — si estuviera en los dos lados, tarde o
 * temprano quedan distintos.
 *
 * DOS SECUENCIAS QUE NO SE PUEDEN INVERTIR (las impone la FK compuesta
 * (pagina_id, funnel_id) → builder_pages(id, funnel_id) de la migración):
 *
 *   meter una página en un funnel  →  1) page.funnel_id = X
 *                                     2) INSERT del paso
 *   sacarla del funnel             →  1) DELETE del paso
 *                                     2) page.funnel_id = NULL
 *
 * Al revés, Postgres rechaza la operación. Eso es deliberado: es la red
 * que impide que el funnel de la página y el del paso diverjan.
 *
 * Y ojo con el slug al mover una página: adentro de un funnel es único por
 * funnel, afuera es único global. Cambiar de ámbito obliga a revalidarlo,
 * y por eso agregar/quitar puede fallar con 409 aunque nadie haya tocado
 * el nombre.
 */

const crypto = require('crypto');
const slugify = require('slugify');

const { sequelize, BuilderFunnel, BuilderFunnelPage } = require('../models');
const BuilderPageService = require('./builderPage.service');
const { esSlugReservado } = require('../utils/slugsReservados');
const { errorHttp } = require('../utils/errorHttp');

const FORMATO_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_SLUG = 120;

class BuilderFunnelService {

  // ─── Serialización ──────────────────────────────────────────────────

  static serializar(funnel, { paginas = null } = {}) {
    return {
      id: funnel.id,
      proyecto_id: funnel.proyecto_id,
      nombre: funnel.nombre,
      slug: funnel.slug,
      descripcion: funnel.descripcion,
      estado: funnel.estado,
      path_publico: `/f/${funnel.slug}`,
      paginas: paginas || undefined,
      created_at: funnel.created_at,
      updated_at: funnel.updated_at,
    };
  }

  // ─── Slugs ──────────────────────────────────────────────────────────

  /** Único GLOBAL: /f/<slug> es un path del host público del builder. */
  static async generarSlugUnico(nombre) {
    const base = slugify(String(nombre || ''), { lower: true, strict: true }) || 'funnel';
    let slug;
    do {
      slug = `${base}-${crypto.randomBytes(3).toString('hex')}`.slice(0, MAX_SLUG);
    } while (esSlugReservado(slug) || await BuilderFunnel.findOne({ where: { slug } }));
    return slug;
  }

  static async asegurarSlugDisponible(slugPropuesto, excluirId = null) {
    const limpio = slugify(String(slugPropuesto || ''), { lower: true, strict: true });

    if (!limpio || !FORMATO_SLUG.test(limpio)) {
      throw errorHttp('El slug solo puede tener minúsculas, números y guiones, y no puede empezar ni terminar con guión.', 422);
    }
    if (esSlugReservado(limpio)) {
      throw errorHttp(`"${limpio}" es una dirección reservada del sistema. Elegí otra.`, 422);
    }

    const existente = await BuilderFunnel.findOne({ where: { slug: limpio } });
    if (existente && existente.id !== excluirId) {
      throw errorHttp('Ese slug ya está en uso. Probá con otro.', 409);
    }
    return limpio;
  }

  // ─── Lectura ────────────────────────────────────────────────────────

  /** Filtra por usuario_id: el dueño es el único que ve sus funnels. */
  static async buscarPropio(id, usuario_id) {
    const funnel = await BuilderFunnel.findOne({ where: { id, usuario_id } });
    if (!funnel) throw errorHttp('Funnel no encontrado.', 404);
    return funnel;
  }

  /** Los pasos del funnel en orden, con su página. */
  static async listarPasos(funnel_id, transaction = null) {
    return BuilderFunnelPage.findAll({
      where: { funnel_id },
      include: [{ association: 'pagina' }],
      order: [['posicion', 'ASC']],
      transaction,
    });
  }

  static async obtener(id, usuario_id) {
    const funnel = await this.buscarPropio(id, usuario_id);
    const pasos = await this.listarPasos(funnel.id);

    const paginas = pasos.map(paso => BuilderPageService.serializar(paso.pagina, {
      funnelSlug: funnel.slug,
      paso: { posicion: paso.posicion, es_entrada: paso.es_entrada },
    }));

    return this.serializar(funnel, { paginas });
  }

  // ─── CRUD ───────────────────────────────────────────────────────────

  /**
   * @param {{proyecto_id: number, usuario_id: number, inquilino_id: number}} contexto
   * @param {{nombre?: string, slug?: string, descripcion?: string}} datos
   */
  static async crear(contexto, datos) {
    const { proyecto_id, usuario_id, inquilino_id } = contexto;

    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw errorHttp('El nombre del funnel es requerido.', 422);
    if (nombre.length > 150) throw errorHttp('El nombre no puede superar los 150 caracteres.', 422);

    const slug = datos.slug
      ? await this.asegurarSlugDisponible(datos.slug)
      : await this.generarSlugUnico(nombre);

    const funnel = await BuilderFunnel.create({
      proyecto_id,
      usuario_id,
      inquilino_id,
      nombre,
      slug,
      descripcion: datos.descripcion ? String(datos.descripcion).trim() : null,
      estado: 'draft',
    });

    return this.serializar(funnel, { paginas: [] });
  }

  static async actualizar(id, usuario_id, datos) {
    const funnel = await this.buscarPropio(id, usuario_id);

    if (datos.slug !== undefined) {
      funnel.slug = await this.asegurarSlugDisponible(datos.slug, funnel.id);
    }
    if (datos.nombre !== undefined) {
      const nombre = String(datos.nombre || '').trim();
      if (!nombre) throw errorHttp('El nombre del funnel es requerido.', 422);
      funnel.nombre = nombre;
    }
    if (datos.descripcion !== undefined) {
      funnel.descripcion = datos.descripcion ? String(datos.descripcion).trim() : null;
    }

    await funnel.save();
    return this.obtener(funnel.id, usuario_id);
  }

  /** Borra el funnel Y sus páginas (ON DELETE CASCADE). La UI confirma antes. */
  static async eliminar(id, usuario_id) {
    const funnel = await this.buscarPropio(id, usuario_id);
    await funnel.destroy();
    return true;
  }

  // ─── Páginas del funnel ─────────────────────────────────────────────

  /** Posición siguiente libre. 1 si el funnel está vacío. */
  static async siguientePosicion(funnel_id, transaction) {
    const max = await BuilderFunnelPage.max('posicion', { where: { funnel_id }, transaction });
    return (max || 0) + 1;
  }

  /**
   * Crea una página nueva directamente dentro del funnel, al final.
   * La primera que entra queda como página de entrada.
   */
  static async agregarPagina(funnel_id, usuario_id, datos) {
    const funnel = await this.buscarPropio(funnel_id, usuario_id);

    await sequelize.transaction(async (transaction) => {
      const pagina = await BuilderPageService.crear({
        proyecto_id: funnel.proyecto_id,
        usuario_id: funnel.usuario_id,
        inquilino_id: funnel.inquilino_id,
        funnel_id: funnel.id,
      }, datos, transaction);

      const posicion = await this.siguientePosicion(funnel.id, transaction);

      await BuilderFunnelPage.create({
        funnel_id: funnel.id,
        pagina_id: pagina.id,
        posicion,
        es_entrada: posicion === 1,
      }, { transaction });
    });

    return this.obtener(funnel.id, usuario_id);
  }

  /**
   * Mete en el funnel una página suelta que ya existe.
   *
   * El slug le cambia de ámbito (de único-global a único-por-funnel), así
   * que se revalida antes de mover nada: si ya hay una página con ese slug
   * en el funnel, esto falla con 409 y no se toca la base.
   */
  static async adjuntarPagina(funnel_id, usuario_id, pagina_id) {
    const funnel = await this.buscarPropio(funnel_id, usuario_id);
    const pagina = await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    if (pagina.funnel_id === funnel.id) {
      throw errorHttp('Esa página ya está en este funnel.', 409);
    }
    if (pagina.funnel_id) {
      throw errorHttp('Esa página ya pertenece a otro funnel. Sacala de ahí primero.', 409);
    }
    if (pagina.proyecto_id !== funnel.proyecto_id) {
      throw errorHttp('La página y el funnel tienen que ser del mismo proyecto.', 409);
    }
    if (await BuilderPageService.slugOcupado(pagina.slug, { funnel_id: funnel.id })) {
      throw errorHttp(`Ya hay una página con el slug "${pagina.slug}" en este funnel. Cambiale el slug a una de las dos antes de moverla.`, 409);
    }

    await sequelize.transaction(async (transaction) => {
      // 1) primero la página entra al funnel...
      pagina.funnel_id = funnel.id;
      await pagina.save({ transaction });

      // 2) ...y recién ahí se puede crear el paso (FK compuesta).
      const posicion = await this.siguientePosicion(funnel.id, transaction);
      await BuilderFunnelPage.create({
        funnel_id: funnel.id,
        pagina_id: pagina.id,
        posicion,
        es_entrada: posicion === 1,
      }, { transaction });
    });

    return this.obtener(funnel.id, usuario_id);
  }

  /**
   * Saca la página del funnel. NO la borra: vuelve a ser una página
   * suelta (/p/<slug>). Su slug vuelve al ámbito global, así que también
   * se revalida antes.
   *
   * Si era la página de entrada, la entrada pasa a la que quede primera.
   */
  static async quitarPagina(funnel_id, usuario_id, pagina_id) {
    const funnel = await this.buscarPropio(funnel_id, usuario_id);
    const pagina = await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    if (pagina.funnel_id !== funnel.id) {
      throw errorHttp('Esa página no pertenece a este funnel.', 404);
    }
    if (await BuilderPageService.slugOcupado(pagina.slug, { funnel_id: null })) {
      throw errorHttp(`Ya hay una página suelta con el slug "${pagina.slug}". Cambiale el slug antes de sacarla del funnel.`, 409);
    }

    await sequelize.transaction(async (transaction) => {
      // 1) primero se borra el paso...
      await BuilderFunnelPage.destroy({
        where: { funnel_id: funnel.id, pagina_id: pagina.id },
        transaction,
      });

      // 2) ...y recién ahí la página puede quedar sin funnel (FK compuesta).
      pagina.funnel_id = null;
      await pagina.save({ transaction });

      await this.reindexar(funnel.id, transaction);
      await this.asegurarEntrada(funnel.id, transaction);
    });

    return this.obtener(funnel.id, usuario_id);
  }

  /**
   * Reordena el funnel. Recibe el ARRAY COMPLETO de ids de página, no
   * deltas: es idempotente y no se rompe si dos pestañas reordenan a la
   * vez — la última que llega deja el funnel exactamente como se ve en su
   * pantalla, en vez de aplicar un movimiento sobre un orden que cambió.
   *
   * Reindexa 1..N sin huecos. Se apoya en que la UNIQUE (funnel_id,
   * posicion) es DEFERRABLE INITIALLY DEFERRED: dentro de la transacción
   * las posiciones pueden chocar de forma transitoria y recién se validan
   * al hacer commit. Sin eso habría que pasar por posiciones negativas.
   */
  static async reordenar(funnel_id, usuario_id, orden) {
    const funnel = await this.buscarPropio(funnel_id, usuario_id);

    if (!Array.isArray(orden)) {
      throw errorHttp('El orden tiene que ser un array de ids de página.', 422);
    }

    const pasos = await this.listarPasos(funnel.id);
    const idsActuales = pasos.map(p => p.pagina_id);
    const idsPedidos = orden.map(Number);

    if (new Set(idsPedidos).size !== idsPedidos.length) {
      throw errorHttp('El orden tiene ids repetidos.', 422);
    }
    // Comparación de conjuntos, no de arrays: mandar el orden completo es
    // lo que hace que la operación sea idempotente. Si falta o sobra una
    // página, el cliente está trabajando sobre un funnel desactualizado.
    const mismos = idsPedidos.length === idsActuales.length
      && idsPedidos.every(id => idsActuales.includes(id));
    if (!mismos) {
      throw errorHttp('El orden tiene que incluir exactamente las páginas que hoy tiene el funnel. Recargá y probá de nuevo.', 409);
    }

    await sequelize.transaction(async (transaction) => {
      for (let i = 0; i < idsPedidos.length; i++) {
        await BuilderFunnelPage.update(
          { posicion: i + 1 },
          { where: { funnel_id: funnel.id, pagina_id: idsPedidos[i] }, transaction },
        );
      }
    });

    return this.obtener(funnel.id, usuario_id);
  }

  /**
   * Define cuál es la página de entrada (a dónde lleva /f/<slug> pelado).
   *
   * Primero se apagan todas y después se prende la elegida: el índice
   * parcial UNIQUE (funnel_id) WHERE es_entrada NO es deferrable —un
   * índice no puede serlo—, así que en ningún momento puede haber dos.
   */
  static async definirEntrada(funnel_id, usuario_id, pagina_id) {
    const funnel = await this.buscarPropio(funnel_id, usuario_id);

    const paso = await BuilderFunnelPage.findOne({
      where: { funnel_id: funnel.id, pagina_id },
    });
    if (!paso) throw errorHttp('Esa página no pertenece a este funnel.', 404);

    await sequelize.transaction(async (transaction) => {
      await BuilderFunnelPage.update(
        { es_entrada: false },
        { where: { funnel_id: funnel.id, es_entrada: true }, transaction },
      );
      await BuilderFunnelPage.update(
        { es_entrada: true },
        { where: { id: paso.id }, transaction },
      );
    });

    return this.obtener(funnel.id, usuario_id);
  }

  // ─── Internos ───────────────────────────────────────────────────────

  /** Deja las posiciones en 1..N sin huecos, respetando el orden actual. */
  static async reindexar(funnel_id, transaction) {
    const pasos = await BuilderFunnelPage.findAll({
      where: { funnel_id },
      order: [['posicion', 'ASC']],
      transaction,
    });

    for (let i = 0; i < pasos.length; i++) {
      if (pasos[i].posicion === i + 1) continue;
      await BuilderFunnelPage.update(
        { posicion: i + 1 },
        { where: { id: pasos[i].id }, transaction },
      );
    }
  }

  /**
   * Si el funnel quedó sin página de entrada (se sacó justo esa), la
   * primera pasa a serlo. Un funnel con páginas y sin entrada haría que
   * /f/<slug> no resuelva a ningún lado.
   */
  static async asegurarEntrada(funnel_id, transaction) {
    const hayEntrada = await BuilderFunnelPage.findOne({
      where: { funnel_id, es_entrada: true },
      transaction,
    });
    if (hayEntrada) return;

    const primero = await BuilderFunnelPage.findOne({
      where: { funnel_id },
      order: [['posicion', 'ASC']],
      transaction,
    });
    if (!primero) return; // funnel vacío, no hay nada que marcar

    await BuilderFunnelPage.update(
      { es_entrada: true },
      { where: { id: primero.id }, transaction },
    );
  }
}

module.exports = BuilderFunnelService;
