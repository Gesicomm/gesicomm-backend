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
 *     Cloudflare for SaaS (Custom Hostnames), el mismo mecanismo que ya
 *     usa Tienda.dominio_propio. Se registra, se le muestra al usuario el
 *     TXT de verificación, y recién cuando Cloudflare emite el
 *     certificado queda activo. Sin CF_ZONE_ID/CF_API_TOKEN en el
 *     entorno NO revienta: el hostname queda guardado como 'pendiente' y
 *     se avisa que falta configurar el proveedor.
 *
 * Reutiliza utils/validarSubdominio.js (reglas DNS + lista de reservados
 * + disponibilidad) y services/cloudflare.service.js. No duplica ninguna
 * de las dos cosas.
 */

const { Op } = require('sequelize');

const { BuilderDomain, BuilderPage, BuilderFunnel } = require('../models');
const CloudflareService = require('./cloudflare.service');
const { validarFormato, disponible } = require('../utils/validarSubdominio');
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
      activo: hostname.estado_verificacion === 'verificado' && hostname.estado_ssl === 'activo',
      // El TXT solo tiene sentido mientras el dominio propio no esté
      // verificado; después es ruido en la UI.
      verificacion_dns: hostname.estado_verificacion === 'verificado' ? null : {
        tipo: 'TXT',
        nombre: hostname.verificacion_txt_nombre,
        valor: hostname.verificacion_txt_valor,
      },
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
   * cargar el TXT en el DNS del dominio y esperar el certificado.
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

    // Cloudflare es opcional: sin credenciales el hostname igual se
    // guarda y la UI muestra "falta configurar el proveedor" en vez de
    // que el alta reviente entera.
    let cf = null;
    let aviso = null;
    try {
      cf = await CloudflareService.crearCustomHostname(dominio);
    } catch (err) {
      aviso = `El dominio quedó guardado, pero todavía no se registró en el proveedor de certificados: ${err.message}`;
    }

    const creado = await this.insertar({
      usuario_id,
      inquilino_id,
      ...target,
      tipo: 'dominio_propio',
      subdominio: null,
      hostname: dominio,
      cf_hostname_id: cf?.id || null,
      verificacion_txt_nombre: cf?.ownershipVerification?.name || null,
      verificacion_txt_valor: cf?.ownershipVerification?.value || null,
      estado_verificacion: 'pendiente',
      estado_ssl: cf ? 'emitiendo' : 'pendiente',
    });

    return aviso ? { ...creado, aviso } : creado;
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

  /** Consulta a Cloudflare cómo viene la verificación del dominio propio. */
  static async verificar(id, usuario_id) {
    const hostname = await this.buscarPropio(id, usuario_id);

    if (hostname.tipo === 'subdominio') {
      return this.serializar(hostname); // no hay nada que verificar
    }
    if (!hostname.cf_hostname_id) {
      throw errorHttp('Este dominio todavía no está registrado en el proveedor de certificados.', 409);
    }

    let estado;
    try {
      estado = await CloudflareService.verificarEstado(hostname.cf_hostname_id);
    } catch (err) {
      throw errorHttp(`No se pudo consultar el estado del dominio: ${err.message}`, 502);
    }

    hostname.estado_verificacion = estado.activo ? 'verificado'
      : (estado.estado === 'pending' ? 'verificando' : 'error');
    hostname.estado_ssl = estado.sslEstado === 'active' ? 'activo'
      : (estado.sslEstado ? 'emitiendo' : 'pendiente');
    // Cloudflare devuelve el TXT en cada GET: se refresca para que la UI
    // lo pueda volver a mostrar si el usuario recarga antes de que la
    // propagación DNS termine.
    if (estado.ownershipVerification) {
      hostname.verificacion_txt_nombre = estado.ownershipVerification.name;
      hostname.verificacion_txt_valor = estado.ownershipVerification.value;
    }
    hostname.ultimo_chequeo_at = new Date();
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
