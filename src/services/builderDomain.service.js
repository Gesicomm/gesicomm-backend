'use strict';

/**
 * Hostnames del Page Builder: dónde se publica cada página o funnel.
 *
 *   calcula.gesicomm.com   → una página suelta
 *   t2e.gesicomm.com       → otra
 *   t2e.com.py             → la misma, con el dominio propio del usuario
 *
 * Los dos tipos conviven en builder_domains porque para el resolvedor
 * público son lo mismo: un host que apunta a un target. La diferencia es
 * solo cómo se consigue el certificado.
 *
 *   SUBDOMINIO DE LA PLATAFORMA
 *     No necesita nada: *.gesicomm.com ya tiene DNS wildcard y
 *     certificado wildcard en el origen (deploy/nginx/tiendas.gesicomm.com).
 *     Nace verificado y activo — se publica en el momento.
 *
 *   DOMINIO PROPIO
 *     Un registro A a la IP del VPS, el mismo mecanismo que usa
 *     Tienda.dominio_propio (utils/dominios.js). Queda verificado cuando
 *     su DNS resuelve a nuestra IP, y activo cuando Caddy le emitió el
 *     certificado — que pasa solo, en la primera visita.
 *
 * Reutiliza utils/validarSubdominio.js (reglas DNS + lista de reservados
 * + disponibilidad) y utils/dominios.js. No duplica ninguna de las dos.
 */

const { Op } = require('sequelize');

const { BuilderDomain, BuilderPage, BuilderFunnel } = require('../models');
const { validarFormato, disponible } = require('../utils/validarSubdominio');
const { registrosPara, apuntaANuestroServidor, sirvePorHttps } = require('../utils/dominios');
const { errorHttp } = require('../utils/errorHttp');

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'gesicomm.com';

// Un dominio propio: al menos dos etiquetas, sin protocolo, sin puerto,
// sin path. Acepta varios niveles (t2e.com.py, www.t2e.com.py).
const DOMINIO_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

class BuilderDomainService {

  // ─── Serialización ──────────────────────────────────────────────────

  static serializar(hostname) {
    return {
      id: hostname.id,
      tipo: hostname.tipo,
      hostname: hostname.hostname,
      subdominio: hostname.subdominio,
      url: `https://${hostname.hostname}`,
      es_principal: hostname.es_principal,
      pagina_id: hostname.pagina_id,
      funnel_id: hostname.funnel_id,
      estado_verificacion: hostname.estado_verificacion,
      estado_ssl: hostname.estado_ssl,
      habilitado: hostname.habilitado,
      activo: hostname.habilitado !== false
        && hostname.estado_verificacion === 'verificado'
        && hostname.estado_ssl === 'activo',
      // Los registros a cargar solo tienen sentido mientras el dominio
      // propio no esté verificado; después son ruido en la UI. Un
      // subdominio de la plataforma no lleva ninguno.
      registros: (hostname.tipo === 'subdominio' || hostname.estado_verificacion === 'verificado')
        ? null
        : registrosPara(hostname.hostname),
      ultimo_chequeo_at: hostname.ultimo_chequeo_at,
      created_at: hostname.created_at,
    };
  }

  // ─── Target ─────────────────────────────────────────────────────────

  /**
   * Valida que el target exista, sea del usuario, y que sea publicable:
   * una página SUELTA o un funnel. Una página que está dentro de un
   * funnel no puede tener hostname propio — se sirve como un paso del
   * hostname de su funnel.
   *
   * @returns {Promise<{pagina_id: number|null, funnel_id: number|null}>}
   */
  static async resolverTarget({ pagina_id, funnel_id }, usuario_id) {
    const tienePagina = pagina_id !== undefined && pagina_id !== null;
    const tieneFunnel = funnel_id !== undefined && funnel_id !== null;

    if (tienePagina === tieneFunnel) {
      throw errorHttp('Indicá exactamente uno: pagina_id o funnel_id.', 422);
    }

    if (tienePagina) {
      const pagina = await BuilderPage.findOne({ where: { id: pagina_id, usuario_id } });
      if (!pagina) throw errorHttp('Página no encontrada.', 404);
      if (pagina.funnel_id) {
        throw errorHttp('Esa página es un paso de un funnel: el hostname va en el funnel, no en la página.', 409);
      }
      return { pagina_id: pagina.id, funnel_id: null };
    }

    const funnel = await BuilderFunnel.findOne({ where: { id: funnel_id, usuario_id } });
    if (!funnel) throw errorHttp('Funnel no encontrado.', 404);
    return { pagina_id: null, funnel_id: funnel.id };
  }

  // ─── Lectura ────────────────────────────────────────────────────────

  static async listar(usuario_id, filtros = {}) {
    const where = { usuario_id };
    if (filtros.pagina_id) where.pagina_id = Number(filtros.pagina_id);
    if (filtros.funnel_id) where.funnel_id = Number(filtros.funnel_id);

    const filas = await BuilderDomain.findAll({
      where,
      order: [['es_principal', 'DESC'], ['created_at', 'ASC']],
    });
    return filas.map(f => this.serializar(f));
  }

  static async buscarPropio(id, usuario_id) {
    const hostname = await BuilderDomain.findOne({ where: { id, usuario_id } });
    if (!hostname) throw errorHttp('Hostname no encontrado.', 404);
    return hostname;
  }

  /** La URL canónica de un target, o null si todavía no tiene hostname. */
  static async urlPrincipal({ pagina_id = null, funnel_id = null }) {
    const where = { es_principal: true };
    if (pagina_id) where.pagina_id = pagina_id;
    else if (funnel_id) where.funnel_id = funnel_id;
    else return null;

    const hostname = await BuilderDomain.findOne({ where });
    return hostname ? `https://${hostname.hostname}` : null;
  }

  // ─── Alta ───────────────────────────────────────────────────────────

  /**
   * Subdominio de la plataforma. Queda publicable en el momento: no hay
   * DNS que esperar ni certificado que emitir.
   */
  static async crearSubdominio(contexto, datos) {
    const { usuario_id, inquilino_id } = contexto;
    const target = await this.resolverTarget(datos, usuario_id);

    const sub = String(datos.subdominio || '').toLowerCase().trim();

    const formato = validarFormato(sub);
    if (!formato.valido) throw errorHttp(formato.motivo, 422);

    // Mira tiendas Y builder_domains: comparten el namespace.
    if (!await disponible(sub)) {
      throw errorHttp(`El subdominio "${sub}" ya está en uso.`, 409);
    }

    return this.insertar({
      usuario_id,
      inquilino_id,
      ...target,
      tipo: 'subdominio',
      subdominio: sub,
      hostname: `${sub}.${BASE_DOMAIN}`,
      estado_verificacion: 'verificado',
      estado_ssl: 'activo',
    });
  }

  /**
   * Dominio propio del usuario (t2e.com.py). Arranca pendiente: hay que
   * apuntar el registro A a nuestra IP y verificarlo.
   */
  static async crearDominioPropio(contexto, datos) {
    const { usuario_id, inquilino_id } = contexto;
    const target = await this.resolverTarget(datos, usuario_id);

    const dominio = String(datos.dominio || '').toLowerCase().trim().replace(/\.$/, '');

    if (!DOMINIO_RE.test(dominio)) {
      throw errorHttp('Escribí el dominio solo, sin https:// ni barras. Ejemplo: t2e.com.py', 422);
    }
    if (dominio === BASE_DOMAIN || dominio.endsWith(`.${BASE_DOMAIN}`)) {
      throw errorHttp(`Para un subdominio de ${BASE_DOMAIN} usá la opción de subdominio, no la de dominio propio.`, 422);
    }
    if (await BuilderDomain.count({ where: { hostname: dominio } })) {
      throw errorHttp('Ese dominio ya está cargado.', 409);
    }

    // No hay nada que registrar en ningún proveedor: el alta es solo la
    // fila. Lo único que falta es que el usuario apunte el DNS.
    return this.insertar({
      usuario_id,
      inquilino_id,
      ...target,
      tipo: 'dominio_propio',
      subdominio: null,
      hostname: dominio,
      estado_verificacion: 'pendiente',
      estado_ssl: 'pendiente',
    });
  }

  /**
   * El primer hostname de un target queda como principal. Los siguientes
   * no: cambiar la URL canónica es una decisión explícita
   * (definirPrincipal), no un efecto de agregar un dominio.
   */
  static async insertar(datos) {
    const where = datos.pagina_id
      ? { pagina_id: datos.pagina_id }
      : { funnel_id: datos.funnel_id };
    const yaTiene = await BuilderDomain.count({ where });

    const fila = await BuilderDomain.create({ ...datos, es_principal: yaTiene === 0 });
    return this.serializar(fila);
  }

  // ─── Mantenimiento ──────────────────────────────────────────────────

  /**
   * Comprueba contra el DNS si el dominio propio ya apunta a nuestro
   * servidor, y si además ya tiene certificado.
   */
  static async verificar(id, usuario_id) {
    const hostname = await this.buscarPropio(id, usuario_id);

    if (hostname.tipo === 'subdominio') {
      return this.serializar(hostname); // no hay nada que verificar
    }

    const { apunta } = await apuntaANuestroServidor(hostname.hostname);

    hostname.estado_verificacion = apunta ? 'verificado' : 'pendiente';
    // El certificado lo emite Caddy en la primera visita, así que un
    // dominio recién verificado todavía no lo tiene: eso es 'emitiendo',
    // no un error.
    if (apunta) {
      hostname.estado_ssl = (await sirvePorHttps(hostname.hostname)) ? 'activo' : 'emitiendo';
    } else {
      hostname.estado_ssl = 'pendiente';
    }
    hostname.ultimo_chequeo_at = new Date();
    await hostname.save();

    return this.serializar(hostname);
  }

  /**
   * ¿Le emitimos certificado a este hostname? Lo consulta Caddy (ver
   * src/routes/interno.js). Solo dominios propios ya verificados: los
   * subdominios de la plataforma los cubre el wildcard del origen y nunca
   * llegan a pedir uno.
   */
  static async hostnameHabilitadoParaCertificado(hostname) {
    const limpio = String(hostname || '').toLowerCase().trim();
    if (!limpio) return false;

    const encontrado = await BuilderDomain.count({
      where: {
        hostname: limpio,
        tipo: 'dominio_propio',
        estado_verificacion: 'verificado',
        habilitado: true,
      },
    });

    return encontrado > 0;
  }

  /**
   * Apaga o vuelve a prender un hostname sin borrarlo. Mientras está
   * apagado no resuelve (builderPublicPage.service.js) ni se le emite
   * certificado.
   */
  static async cambiarHabilitacion(id, usuario_id, habilitado) {
    const hostname = await this.buscarPropio(id, usuario_id);
    hostname.habilitado = !!habilitado;
    await hostname.save();
    return this.serializar(hostname);
  }

  /** Cambia cuál es la URL canónica del target. */
  static async definirPrincipal(id, usuario_id) {
    const hostname = await this.buscarPropio(id, usuario_id);

    const where = hostname.pagina_id
      ? { pagina_id: hostname.pagina_id }
      : { funnel_id: hostname.funnel_id };

    // Apagar antes de prender: los índices parciales de es_principal no
    // son deferrables, igual que la página de entrada de un funnel.
    await BuilderDomain.update({ es_principal: false }, {
      where: { ...where, es_principal: true, id: { [Op.ne]: hostname.id } },
    });
    hostname.es_principal = true;
    await hostname.save();

    return this.serializar(hostname);
  }

  static async eliminar(id, usuario_id) {
    const hostname = await this.buscarPropio(id, usuario_id);

    // Si se borra la canónica, la más vieja que quede toma su lugar: un
    // target sin hostname principal no tendría og:url.
    const eraPrincipal = hostname.es_principal;
    const where = hostname.pagina_id
      ? { pagina_id: hostname.pagina_id }
      : { funnel_id: hostname.funnel_id };

    await hostname.destroy();

    if (eraPrincipal) {
      const siguiente = await BuilderDomain.findOne({ where, order: [['created_at', 'ASC']] });
      if (siguiente) {
        siguiente.es_principal = true;
        await siguiente.save();
      }
    }
    return true;
  }
}

module.exports = BuilderDomainService;
module.exports.BASE_DOMAIN = BASE_DOMAIN;
module.exports.DOMINIO_RE = DOMINIO_RE;
