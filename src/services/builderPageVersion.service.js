'use strict';

/**
 * Versionado del código de una página del Page Builder.
 *
 * LA GARANTÍA CENTRAL DEL MÓDULO: guardar NUNCA toca lo que ve el
 * visitante. Guardar crea una versión nueva y mueve `draft_version_id`;
 * lo único que mueve `published_version_id` es publicar
 * (builderPublish.service.js). El comercio puede guardar diez borradores
 * encima y la página publicada sigue siendo la misma hasta que aprieta
 * Publicar.
 *
 *   Draft → Save → (versión nueva) → Preview → Publish → LIVE
 *
 * Una fila con estado='published' NUNCA se actualiza: lo único que le
 * puede pasar es pasar a 'archived' cuando se publica otra.
 *
 * SANITIZACIÓN: se delega entera en LandingCodigoService, que es el único
 * sanitizador del proyecto. Acá solo se le pasan límites más altos, porque
 * una página generada por una IA pasa los 200 KB de HTML de una landing
 * sin despeinarse. No se duplica ni se bifurca nada de esa lógica.
 */

const { Op } = require('sequelize');

const { sequelize, BuilderPageVersion } = require('../models');
const BuilderPageService = require('./builderPage.service');
const LandingCodigoService = require('./landingCodigo.service');
const BuilderNavegacionService = require('./builderNavegacion.service');
const BuilderPublicPageService = require('./builderPublicPage.service');
const { errorHttp } = require('../utils/errorHttp');

// Techos propios del Page Builder. Los de una landing (200/100/50) se
// quedan como están: acá se pasan por parámetro.
//
// EL LÍMITE QUE MANDA ES EL TOTAL: 600 KB entre los tres campos. Los
// topes por campo están más arriba a propósito y solo cortan un campo
// absurdo por sí solo (medio mega de CSS). Si sumaran exactamente 600 el
// total no podría dispararse nunca —cada campo dentro de su tope daría
// siempre un total válido— y sería una validación decorativa.
const LIMITES = {
  maxHtml: 500 * 1024,
  maxCss: 200 * 1024,
  maxJs: 60 * 1024,
  maxTotal: 600 * 1024,
};

// Retención. Cada versión pesa hasta 600 KB: sin poda, cien guardados son
// 60 MB en una sola página.
const MAX_VERSIONES = 30;

const CODIGO_VACIO = { html: '', css: '', js: '' };

class BuilderPageVersionService {

  // ─── Serialización ──────────────────────────────────────────────────

  /** Sin el código: es lo que necesita la pantalla de versiones. */
  static serializar(version, { incluirCodigo = false } = {}) {
    const base = {
      id: version.id,
      pagina_id: version.pagina_id,
      version: version.version,
      estado: version.estado,
      nota: version.nota,
      bytes: version.bytes,
      creado_por: version.creado_por,
      created_at: version.created_at,
      published_at: version.published_at,
    };
    if (!incluirCodigo) return base;
    return { ...base, codigo: { html: version.html, css: version.css, js: version.js } };
  }

  static codigoDe(version) {
    if (!version) return { ...CODIGO_VACIO };
    return { html: version.html || '', css: version.css || '', js: version.js || '' };
  }

  // ─── Lectura ────────────────────────────────────────────────────────

  /** La página + el código de su borrador. Es lo que abre el editor. */
  static async obtenerConCodigo(pagina_id, usuario_id) {
    const pagina = await BuilderPageService.buscarPropia(pagina_id, usuario_id, {
      include: [
        { association: 'funnel', attributes: ['id', 'slug', 'nombre'] },
        { association: 'paso', attributes: ['posicion', 'es_entrada'] },
        { association: 'draft' },
      ],
    });

    return {
      ...BuilderPageService.serializar(pagina),
      codigo: this.codigoDe(pagina.draft),
      version_actual: pagina.draft ? pagina.draft.version : null,
    };
  }

  /**
   * El preview EN VIVO del editor: resuelve los tokens de navegación
   * ({{siguiente}}, {{anterior}}, {{inicio}}, {{pagina:x}}, {{cta}})
   * contra código que TODAVÍA NO SE GUARDÓ. No persiste nada.
   *
   * Es la razón por la que "usar las etiquetas" no puede romper nada: si
   * esto no existiera, el iframe del editor mostraría el token crudo como
   * href ("{{siguiente}}" literal) y un clic ahí navegaría el navegador a
   * esa URL tal cual — que es exactamente lo que reventaba en Postgres al
   * llegar como :id a una ruta que espera un entero.
   *
   * Usa la MISMA resolución que la página pública
   * (BuilderNavegacionService + BuilderPublicPageService.navegacionDe),
   * para que lo que se ve acá sea lo que se va a publicar — nunca un
   * segundo comportamiento por separado.
   *
   * @param {{html?: string, css?: string, js?: string}} datos código sin guardar
   */
  static async previsualizar(pagina_id, usuario_id, datos) {
    const pagina = await BuilderPageService.buscarPropia(pagina_id, usuario_id, {
      include: [{ association: 'funnel', attributes: ['id', 'slug', 'nombre'] }],
    });

    const navegacion = pagina.funnel
      ? await BuilderPublicPageService.navegacionDe(pagina.funnel, pagina)
      : null;

    const { html, advertencias } = BuilderNavegacionService.resolverTokens(datos?.html, {
      funnel: pagina.funnel,
      pagina,
      paginas: navegacion ? navegacion.paginas : [],
      porHostname: false,
      destino_cta: pagina.destino_cta,
    });

    return {
      codigo: { html, css: datos?.css || '', js: datos?.js || '' },
      advertencias_navegacion: advertencias,
    };
  }

  static async listar(pagina_id, usuario_id) {
    await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    const versiones = await BuilderPageVersion.findAll({
      where: { pagina_id },
      // Sin el código: un listado de 30 versiones traería hasta 18 MB.
      attributes: { exclude: ['html', 'css', 'js'] },
      order: [['version', 'DESC']],
    });

    return versiones.map(v => this.serializar(v));
  }

  static async buscarVersion(pagina_id, versionId, usuario_id) {
    await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    const version = await BuilderPageVersion.findOne({
      where: { id: versionId, pagina_id },
    });
    if (!version) throw errorHttp('Versión no encontrada.', 404);
    return version;
  }

  static async obtenerVersion(pagina_id, versionId, usuario_id) {
    const version = await this.buscarVersion(pagina_id, versionId, usuario_id);
    return this.serializar(version, { incluirCodigo: true });
  }

  // ─── Importar ───────────────────────────────────────────────────────

  /**
   * Reparte un documento HTML completo (el que pega el comercio, salido
   * de ChatGPT o de donde sea) en los tres campos del editor.
   *
   * NO guarda nada: devuelve el resultado para que el editor lo muestre
   * en las pestañas y el usuario decida. Guardar es un paso aparte.
   *
   * Toda la lógica es de LandingCodigoService.separarDocumentoCompleto(),
   * que ya existe y ya está testeada. Acá solo se la expone por HTTP.
   */
  static async importar(pagina_id, usuario_id, documento) {
    await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    if (typeof documento !== 'string' || !documento.trim()) {
      throw errorHttp('Pegá el HTML que querés importar.', 422);
    }

    // Pasa por sanitizar() y no solo por separarDocumentoCompleto(): así
    // lo que se muestra en las pestañas es exactamente lo que se va a
    // poder guardar, sin sorpresas al apretar Guardar.
    const resultado = LandingCodigoService.sanitizar({ html: documento }, LIMITES);

    return {
      codigo: { html: resultado.html, css: resultado.css, js: resultado.js },
      advertencias: resultado.advertencias,
    };
  }

  // ─── Guardar ────────────────────────────────────────────────────────

  /**
   * Crea una versión nueva en estado draft. NO publica: la versión
   * publicada sigue intacta.
   *
   * Devuelve el código YA SANITIZADO, que puede venir recortado respecto
   * de lo que mandó el cliente. El editor tiene que reemplazar su
   * borrador con esto y mostrar las advertencias — si no, sigue mostrando
   * un `<script>` en el HTML que el servidor ya sacó.
   */
  static async guardar(pagina_id, usuario_id, datos) {
    const pagina = await BuilderPageService.buscarPropia(pagina_id, usuario_id);

    const limpio = LandingCodigoService.sanitizar({
      html: datos.html,
      css: datos.css,
      js: datos.js,
    }, LIMITES);

    const nota = datos.nota ? String(datos.nota).trim().slice(0, 200) : null;

    const version = await sequelize.transaction(async (transaction) => {
      const ultima = await BuilderPageVersion.max('version', {
        where: { pagina_id: pagina.id },
        transaction,
      });

      const nueva = await BuilderPageVersion.create({
        pagina_id: pagina.id,
        version: (ultima || 0) + 1,
        html: limpio.html,
        css: limpio.css,
        js: limpio.js,
        estado: 'draft',
        nota,
        creado_por: usuario_id,
        bytes: limpio.bytes,
      }, { transaction });

      // El borrador anterior pasa a archivado. Si el anterior era además
      // la versión publicada NO se toca: publicada manda, y su fila es
      // inmutable hasta que se publique otra.
      if (pagina.draft_version_id && pagina.draft_version_id !== pagina.published_version_id) {
        await BuilderPageVersion.update(
          { estado: 'archived' },
          { where: { id: pagina.draft_version_id, estado: 'draft' }, transaction },
        );
      }

      pagina.draft_version_id = nueva.id;
      await pagina.save({ transaction });

      await this.podar(pagina, transaction);

      return nueva;
    });

    return {
      pagina: BuilderPageService.serializar(pagina),
      version: this.serializar(version),
      codigo: { html: limpio.html, css: limpio.css, js: limpio.js },
      advertencias: limpio.advertencias,
    };
  }

  /**
   * Copia una versión vieja como borrador nuevo. No revive la vieja: el
   * historial no se reescribe, se le agrega una versión más arriba.
   */
  static async restaurar(pagina_id, versionId, usuario_id) {
    const version = await this.buscarVersion(pagina_id, versionId, usuario_id);

    return this.guardar(pagina_id, usuario_id, {
      html: version.html,
      css: version.css,
      js: version.js,
      nota: `Restaurada desde la v${version.version}`,
    });
  }

  // ─── Retención ──────────────────────────────────────────────────────

  /**
   * Borra las versiones archivadas más viejas cuando pasan de
   * MAX_VERSIONES. Nunca toca la publicada ni el borrador actual, aunque
   * sean las más viejas de todas: son las dos que alguien está usando.
   *
   * @returns {Promise<number>} cuántas se borraron
   */
  static async podar(pagina, transaction) {
    const versiones = await BuilderPageVersion.findAll({
      where: { pagina_id: pagina.id },
      attributes: ['id', 'version'],
      order: [['version', 'DESC']],
      transaction,
    });

    if (versiones.length <= MAX_VERSIONES) return 0;

    const intocables = new Set(
      [pagina.draft_version_id, pagina.published_version_id].filter(Boolean),
    );

    const sobrantes = versiones
      .slice(MAX_VERSIONES)
      .filter(v => !intocables.has(v.id))
      .map(v => v.id);

    if (!sobrantes.length) return 0;

    await BuilderPageVersion.destroy({
      where: { id: { [Op.in]: sobrantes } },
      transaction,
    });
    return sobrantes.length;
  }
}

module.exports = BuilderPageVersionService;
module.exports.LIMITES = LIMITES;
module.exports.MAX_VERSIONES = MAX_VERSIONES;
