'use strict';

/**
 * Publicación del Page Builder — el único lugar del sistema que mueve
 * `published_version_id`.
 *
 * INVARIANTE QUE HAY QUE PODER DEMOSTRAR: entre archivar la versión que
 * estaba publicada y apuntar la nueva no hay ningún instante observable.
 * Las dos cosas van en la MISMA transacción, así que un GET público
 * siempre devuelve una versión coherente — nunca un borrador, nunca una
 * página a medio publicar.
 *
 *   Guardar   → versión nueva, published_version_id INTACTO
 *   Publicar  → published_version_id = esa versión, la anterior a archived
 *   Despublicar → published_version_id = null, published_at se CONSERVA
 *
 * published_at se conserva al despublicar a propósito: es lo que
 * distingue "se publicó y se bajó" (unpublished) de "nunca se publicó"
 * (draft). Sin eso los dos estados serían indistinguibles.
 */

const { sequelize, BuilderPage, BuilderPageVersion, BuilderFunnel, BuilderFunnelPage } = require('../models');
const BuilderPageService = require('./builderPage.service');
const BuilderPageVersionService = require('./builderPageVersion.service');
const BuilderProjectService = require('./builderProject.service');
const BuilderDomainService = require('./builderDomain.service');
const { errorHttp } = require('../utils/errorHttp');

class BuilderPublishService {

  // ─── Publicar una página ────────────────────────────────────────────

  /**
   * @param {number} pagina_id
   * @param {number} usuario_id
   * @param {number|null} versionId  null = el borrador actual
   */
  static async publicar(pagina_id, usuario_id, versionId = null) {
    const pagina = await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    const objetivoId = versionId || pagina.draft_version_id;
    if (!objetivoId) {
      throw errorHttp('Esta página todavía no tiene nada guardado para publicar.', 409);
    }

    const version = await BuilderPageVersion.findOne({
      where: { id: objetivoId, pagina_id: pagina.id },
    });
    if (!version) throw errorHttp('Versión no encontrada.', 404);

    // Publicar una página en blanco deja al visitante mirando una pantalla
    // vacía sin ninguna pista de por qué.
    const vacia = !`${version.html}${version.css}${version.js}`.trim();
    if (vacia) {
      throw errorHttp('No se puede publicar una página vacía: escribí o pegá algo primero.', 422);
    }

    await sequelize.transaction(async (transaction) => {
      // La que estaba publicada pasa a archivada. Es lo ÚNICO que se le
      // puede hacer a una fila publicada.
      if (pagina.published_version_id && pagina.published_version_id !== version.id) {
        await BuilderPageVersion.update(
          { estado: 'archived' },
          { where: { id: pagina.published_version_id }, transaction },
        );
      }

      await BuilderPageVersion.update(
        { estado: 'published', published_at: new Date() },
        { where: { id: version.id }, transaction },
      );

      pagina.published_version_id = version.id;
      pagina.published_at = new Date();
      pagina.estado = 'published';
      await pagina.save({ transaction });

      await this.recalcularEstadoFunnel(pagina.funnel_id, transaction);
      await BuilderProjectService.recalcularEstado(pagina.proyecto_id, transaction);
    });

    return this.resultado(pagina, version);
  }

  static async despublicar(pagina_id, usuario_id) {
    const pagina = await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    if (!pagina.published_version_id) {
      throw errorHttp('Esta página no está publicada.', 409);
    }

    await sequelize.transaction(async (transaction) => {
      await BuilderPageVersion.update(
        { estado: 'archived' },
        { where: { id: pagina.published_version_id }, transaction },
      );

      pagina.published_version_id = null;
      // published_at NO se limpia: distingue "se bajó" de "nunca se publicó".
      pagina.estado = 'unpublished';
      await pagina.save({ transaction });

      await this.recalcularEstadoFunnel(pagina.funnel_id, transaction);
      await BuilderProjectService.recalcularEstado(pagina.proyecto_id, transaction);
    });

    return this.resultado(pagina, null);
  }

  // ─── Publicar un funnel entero ──────────────────────────────────────

  /**
   * Publica de una todas las páginas del funnel que tengan borrador sin
   * publicar. Las que ya están al día se saltean — no se les crea una
   * versión publicada nueva por las dudas.
   *
   * No es transaccional a nivel funnel a propósito: cada página se
   * publica en su propia transacción, así una que falla (por ejemplo, una
   * página vacía) no impide que las demás se publiquen. Se devuelve el
   * detalle de qué pasó con cada una.
   */
  static async publicarFunnel(funnel_id, usuario_id) {
    const funnel = await BuilderFunnel.findOne({ where: { id: funnel_id, usuario_id } });
    if (!funnel) throw errorHttp('Funnel no encontrado.', 404);

    const pasos = await BuilderFunnelPage.findAll({
      where: { funnel_id: funnel.id },
      order: [['posicion', 'ASC']],
    });
    if (!pasos.length) {
      throw errorHttp('Este funnel todavía no tiene páginas.', 409);
    }

    const publicadas = [];
    const salteadas = [];
    const fallidas = [];

    for (const paso of pasos) {
      const pagina = await BuilderPage.findByPk(paso.pagina_id);
      if (!pagina) continue;

      if (!pagina.draft_version_id) {
        salteadas.push({ pagina_id: pagina.id, motivo: 'No tiene nada guardado.' });
        continue;
      }
      if (pagina.draft_version_id === pagina.published_version_id) {
        salteadas.push({ pagina_id: pagina.id, motivo: 'Ya está publicada y sin cambios.' });
        continue;
      }

      try {
        await this.publicar(pagina.id, usuario_id);
        publicadas.push(pagina.id);
      } catch (err) {
        fallidas.push({ pagina_id: pagina.id, motivo: err.message });
      }
    }

    return { funnel_id: funnel.id, publicadas, salteadas, fallidas };
  }

  static async despublicarFunnel(funnel_id, usuario_id) {
    const funnel = await BuilderFunnel.findOne({ where: { id: funnel_id, usuario_id } });
    if (!funnel) throw errorHttp('Funnel no encontrado.', 404);

    const paginas = await BuilderPage.findAll({
      where: { funnel_id: funnel.id },
    });

    const despublicadas = [];
    for (const pagina of paginas) {
      if (!pagina.published_version_id) continue;
      await this.despublicar(pagina.id, usuario_id);
      despublicadas.push(pagina.id);
    }

    return { funnel_id: funnel.id, despublicadas };
  }

  // ─── Internos ───────────────────────────────────────────────────────

  /**
   * Un funnel está publicado si al menos una de sus páginas lo está.
   * Mismo criterio que el proyecto (ver BuilderProjectService).
   */
  static async recalcularEstadoFunnel(funnel_id, transaction = null) {
    if (!funnel_id) return null;

    const funnel = await BuilderFunnel.findByPk(funnel_id, { transaction });
    if (!funnel) return null;

    const paginas = await BuilderPage.findAll({
      where: { funnel_id },
      attributes: ['published_version_id', 'published_at'],
      transaction,
    });

    let estado = 'draft';
    if (paginas.some(p => p.published_version_id)) estado = 'published';
    else if (paginas.some(p => p.published_at)) estado = 'unpublished';

    if (funnel.estado !== estado) {
      funnel.estado = estado;
      await funnel.save({ transaction });
    }
    return estado;
  }

  /** La respuesta que necesita la UI: estado nuevo + a dónde mirar. */
  static async resultado(pagina, version) {
    const url = await BuilderDomainService.urlPrincipal({
      pagina_id: pagina.funnel_id ? null : pagina.id,
      funnel_id: pagina.funnel_id,
    });

    return {
      pagina: BuilderPageService.serializar(pagina),
      version: version ? BuilderPageVersionService.serializar(version) : null,
      // null = la página todavía no tiene hostname asignado. La UI
      // ofrece elegir uno; mientras tanto queda el path de fallback.
      url_publica: url,
    };
  }
}

module.exports = BuilderPublishService;
