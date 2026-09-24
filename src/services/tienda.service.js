'use strict';

/**
 * Servicio de Tienda — identidad pública de un usuario (subdominio,
 * opcionalmente dominio propio) y los valores por defecto (tema,
 * contacto, pixel) que heredan todas sus landings.
 */

const { Op } = require('sequelize');
const { Tienda, Usuario, ProveedorDns, Suscripcion, Plan, Landing } = require('../models');
const EncryptionService = require('../utils/EncryptionService');
const { validarFormato: validarFormatoSubdominio, disponible: subdominioDisponible } = require('../utils/validarSubdominio');
const { ESTADOS, registrosPara, apuntaANuestroServidor, sirvePorHttps } = require('../utils/dominios');
const whois = require('whois-json');
const dns = require('dns').promises;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const WHATSAPP_RE = /^\d{8,15}$/;
const META_PIXEL_RE = /^\d{15,16}$/;
const GA_ID_RE = /^G-[A-Z0-9]{4,16}$/i;
const TIKTOK_PIXEL_RE = /^[A-Z0-9]{10,25}$/i;
const PLANES_VALIDOS = new Set(['free', 'pago']);
// Formato laxo de dominio — solo descarta lo que ni siquiera parece un
// hostname. La comprobación real de que existe y apunta acá la hace
// verificarDominioPropio resolviendo su DNS.
const DOMINIO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

async function suscripcionActivaDeUsuario(usuarioId) {
  return Suscripcion.findOne({
    where: {
      usuario_id: usuarioId,
      estado: 'activa',
      [Op.or]: [
        { periodo_fin: null },
        { periodo_fin: { [Op.gt]: new Date() } },
      ],
    },
    include: [Plan],
    order: [['periodo_inicio', 'DESC'], ['created_at', 'DESC']],
  });
}

function serializarSuscripcion(suscripcion) {
  if (!suscripcion) return null;
  const data = suscripcion.toJSON ? suscripcion.toJSON() : suscripcion;
  return {
    id: data.id,
    estado: data.estado,
    periodo_inicio: data.periodo_inicio,
    periodo_fin: data.periodo_fin,
    plan: data.Plan ? {
      codigo: data.Plan.codigo,
      nombre: data.Plan.nombre,
      precio: data.Plan.precio,
      moneda: ['PYG', 'USD'].includes(data.Plan.moneda) ? data.Plan.moneda : 'PYG',
      periodicidad: data.Plan.periodicidad,
      equivale_plan: data.Plan.equivale_plan,
    } : null,
  };
}

/**
 * Los nameservers de la zona a la que pertenece el dominio. Se sube
 * etiqueta por etiqueta porque los NS viven en la raíz de la zona:
 * "gesis.cogymtraining.com" no tiene NS propios, los tiene
 * "cogymtraining.com".
 */
async function nameserversDe(dominio) {
  const labels = dominio.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    try {
      const ns = await dns.resolveNs(labels.slice(i).join('.'));
      if (ns && ns.length) return ns;
    } catch (err) {
      // Esta zona no existe (o no responde): probar con la de más arriba.
    }
  }
  return [];
}

class TiendaService {

  static async obtenerPorUsuario(usuario_id) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) return null;
    const [usuario, suscripcion, landingInicio] = await Promise.all([
      Usuario.findByPk(usuario_id, { attributes: ['plan'] }),
      suscripcionActivaDeUsuario(usuario_id),
      Landing.findOne({
        where: { tienda_id: tienda.id, tipo_pagina: 'inicio' },
        attributes: ['color_primario', 'color_texto', 'color_fondo'],
      }),
    ]);
    const plan = suscripcion?.Plan?.equivale_plan || usuario?.plan || null;
    if (suscripcion && usuario?.plan !== plan) {
      await Usuario.update({ plan }, { where: { id: usuario_id } });
    }
    return {
      ...this.serializarConTemaLanding(tienda, landingInicio),
      plan,
      suscripcion: serializarSuscripcion(suscripcion),
    };
  }

  static validarCamposComunes(payload) {
    const errores = [];
    for (const campo of ['color_primario', 'color_secundario', 'color_fondo']) {
      const valor = payload[campo];
      if (valor !== undefined && valor !== null && valor !== '' && !HEX_COLOR_RE.test(valor)) {
        errores.push(`${campo} debe ser un color hexadecimal válido (#rrggbb).`);
      }
    }
    // Solo formato: obligatorio lo hace el onboarding, porque las tiendas que
    // ya existian no tienen documento y no se las puede bloquear al guardar.
    if (payload.documento && !/^[0-9.\-]{5,20}$/.test(String(payload.documento).trim())) {
      errores.push('documento debe ser un número de cédula válido (solo dígitos, puntos o guiones).');
    }
    if (payload.ruc && !/^[0-9.\-]{5,20}$/.test(String(payload.ruc).trim())) {
      errores.push('ruc debe ser un número válido (solo dígitos, puntos o guiones).');
    }
    if (payload.whatsapp && !WHATSAPP_RE.test(payload.whatsapp)) {
      errores.push('whatsapp debe contener solo dígitos (código de país + número), entre 8 y 15 caracteres.');
    }
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email).trim())) {
      errores.push('email no tiene un formato válido.');
    }
    if (payload.canal_contacto && !['whatsapp', 'email', 'telefono', 'instagram'].includes(payload.canal_contacto)) {
      errores.push('canal_contacto debe ser whatsapp, email, telefono o instagram.');
    }
    for (const [campo, max] of [['nombre_contacto', 100], ['direccion_publica', 255], ['ciudad_publica', 100]]) {
      if (payload[campo] && String(payload[campo]).length > max) errores.push(`${campo} no puede superar los ${max} caracteres.`);
    }
    for (const red of ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter']) {
      if (payload[red] && String(payload[red]).length > 100) errores.push(`${red} no puede superar los 100 caracteres.`);
    }
    if (payload.meta_pixel_id && !META_PIXEL_RE.test(payload.meta_pixel_id)) {
      errores.push('meta_pixel_id inválido (debe ser numérico, 15 o 16 dígitos).');
    }
    if (payload.google_analytics_id && !GA_ID_RE.test(payload.google_analytics_id)) {
      errores.push('google_analytics_id inválido (formato esperado: G-XXXXXXXXXX).');
    }
    if (payload.tiktok_pixel_id && !TIKTOK_PIXEL_RE.test(payload.tiktok_pixel_id)) {
      errores.push('tiktok_pixel_id inválido.');
    }
    return errores;
  }

  static camposEditables(payload) {
    const campos = {};
    for (const campo of [
      'nombre', 'whatsapp', 'telefono', 'mensaje_contacto', 'documento', 'ruc',
      'email', 'instagram', 'facebook', 'tiktok', 'youtube', 'twitter',
      'nombre_contacto', 'canal_contacto', 'direccion_publica', 'ciudad_publica',
      'color_primario', 'color_secundario', 'color_fondo',
      'meta_test_event_code', 'google_analytics_id', 'tiktok_pixel_id',
      'deposito_departamento', 'deposito_ciudad', 'deposito_direccion',
      'deposito_referencia', 'deposito_telefono',
      // Contacto extendido
      'nombre_contacto', 'canal_contacto', 'email_contacto',
      'instagram', 'facebook', 'twitter', 'tiktok', 'youtube',
      'direccion_publica', 'ciudad_publica',
    ]) {
      if (payload[campo] !== undefined) campos[campo] = payload[campo] || null;
    }
    if (payload.meta_capi_activo !== undefined) campos.meta_capi_activo = !!payload.meta_capi_activo;
    if (payload.meta_pixel_id !== undefined) campos.meta_pixel_id = payload.meta_pixel_id || null;
    if (payload.meta_access_token !== undefined) {
      campos.meta_access_token = payload.meta_access_token ? EncryptionService.encrypt(payload.meta_access_token) : null;
    }
    return campos;
  }


  // ─── CRUD ────────────────────────────────────────────────────────────────

  static async crear(usuario_id, inquilino_id, payload) {
    const existente = await Tienda.findOne({ where: { usuario_id } });
    if (existente) throw new Error('Ya tenés una tienda creada.');

    if (!payload.nombre?.trim()) throw new Error('El nombre de la tienda es obligatorio.');
    if (!payload.subdominio?.trim()) throw new Error('El subdominio es obligatorio.');
    // Obligatorio SOLO al crear: PagoPar exige comprador.documento para
    // cobrarle al comercio (abastecimiento, suscripciones). Las tiendas que ya
    // existian quedaron sin el dato y lo cargan desde /mi-tienda, por eso
    // actualizar() no lo exige.
    if (!payload.documento?.trim()) throw new Error('El número de cédula es obligatorio.');
    // Ídem: obligatorio solo al crear. Sin esto el admin no sabe adónde
    // devolverle la mercadería que el usuario venda.
    if (!payload.deposito_departamento?.trim()) throw new Error('El departamento de tu depósito es obligatorio.');
    if (!payload.deposito_ciudad?.trim()) throw new Error('La ciudad de tu depósito es obligatoria.');
    if (!payload.deposito_direccion?.trim()) throw new Error('La dirección de tu depósito es obligatoria.');
    if (!payload.deposito_telefono?.trim()) throw new Error('El teléfono de contacto de tu depósito es obligatorio.');

    const subdominio = payload.subdominio.trim().toLowerCase();
    const { valido, motivo } = validarFormatoSubdominio(subdominio);
    if (!valido) throw new Error(motivo);
    if (!(await subdominioDisponible(subdominio))) throw new Error('Ese subdominio ya está en uso.');

    const usuario = await Usuario.findByPk(usuario_id, { attributes: ['plan'] });
    const suscripcion = await suscripcionActivaDeUsuario(usuario_id);
    const plan = suscripcion?.Plan?.equivale_plan || usuario?.plan || 'pago';
    if (!PLANES_VALIDOS.has(plan)) throw new Error('plan debe ser "free" o "pago".');

    const errores = this.validarCamposComunes(payload);
    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    const tienda = await Tienda.create({
      usuario_id,
      inquilino_id,
      subdominio,
      ...this.camposEditables(payload),
      nombre: payload.nombre.trim(),
    });

    return {
      ...this.serializar(tienda),
      plan,
      suscripcion: serializarSuscripcion(suscripcion),
    };
  }

  static async actualizar(usuario_id, payload) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');

    const errores = this.validarCamposComunes(payload);

    let nuevoSubdominio = null;
    const usaDominioPropio = Boolean(tienda.dominio_propio);
    if (payload.subdominio !== undefined && !usaDominioPropio) {
      nuevoSubdominio = (payload.subdominio || '').trim().toLowerCase();
      if (nuevoSubdominio !== tienda.subdominio) {
        const { valido, motivo } = validarFormatoSubdominio(nuevoSubdominio);
        if (!valido) {
          errores.push(motivo);
        } else if (!(await subdominioDisponible(nuevoSubdominio, tienda.id))) {
          errores.push('Ese subdominio ya está en uso.');
        }
      }
    }

    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    Object.assign(tienda, this.camposEditables(payload));
    if (nuevoSubdominio !== null) tienda.subdominio = nuevoSubdominio;
    await tienda.save();
    await this.sincronizarTemaLandings(tienda, payload);

    const [usuario, suscripcion] = await Promise.all([
      Usuario.findByPk(usuario_id, { attributes: ['plan'] }),
      suscripcionActivaDeUsuario(usuario_id),
    ]);
    const plan = suscripcion?.Plan?.equivale_plan || usuario?.plan || null;
    if (suscripcion && usuario?.plan !== plan) {
      await Usuario.update({ plan }, { where: { id: usuario_id } });
    }

    return {
      ...this.serializar(tienda),
      plan,
      suscripcion: serializarSuscripcion(suscripcion),
    };
  }

  /**
   * Reemplaza (o quita, con imagenData = null) el logo de la tienda.
   * Devuelve `anterior` para que el controller borre ese objeto de R2 —
   * mismo contrato que LandingSimpleService._actualizarImagenCampo.
   */
  static async actualizarLogo(usuario_id, imagenData) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');

    const anterior = tienda.logo_imagen
      ? { url: tienda.logo_imagen, storage_key: tienda.logo_imagen_storage_key }
      : null;

    tienda.logo_imagen = imagenData ? imagenData.url : null;
    tienda.logo_imagen_storage_key = imagenData ? imagenData.storage_key : null;
    tienda.logo_imagen_mime_type = imagenData ? imagenData.mime_type : null;
    tienda.logo_imagen_size = imagenData ? imagenData.size : null;
    tienda.logo_imagen_width = imagenData ? imagenData.width : null;
    tienda.logo_imagen_height = imagenData ? imagenData.height : null;
    await tienda.save();

    return { tienda: await this.obtenerPorUsuario(usuario_id), anterior };
  }

  static async verificarDisponibilidadSubdominio(sub, usuario_id = null) {
    if (!sub) return { valido: false, disponible: false, motivo: 'Ingresá un subdominio.' };
    const { valido, motivo } = validarFormatoSubdominio(sub);
    if (!valido) return { valido: false, disponible: false, motivo };

    let propiaTiendaId = null;
    if (usuario_id) {
      const propia = await Tienda.findOne({ where: { usuario_id }, attributes: ['id'] });
      if (propia) propiaTiendaId = propia.id;
    }

    const libre = await subdominioDisponible(sub, propiaTiendaId);
    return { valido: true, disponible: libre, motivo: libre ? null : 'Ese subdominio ya está en uso.' };
  }

  // ─── Dominio propio ────────────────────────────────────────────────────────
  //
  // El cliente apunta un registro A a nuestra IP y listo: sin CNAME, sin TXT
  // de validación y sin intermediarios. El certificado lo emite Caddy solo.
  // Ver src/utils/dominios.js.

  static async guardarDominioPropio(usuario_id, dominio) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');

    const limpio = (dominio || '').trim().toLowerCase();
    if (!DOMINIO_RE.test(limpio)) throw new Error('Ese dominio no tiene un formato válido.');

    // Un hostname no puede resolver a dos lugares distintos. La restricción
    // también está en la base (índice único sobre dominio_propio), pero acá
    // el mensaje se puede explicar.
    const ocupado = await Tienda.findOne({
      where: { dominio_propio: limpio, id: { [Op.ne]: tienda.id } },
      attributes: ['id'],
    });
    if (ocupado) throw new Error('Ese dominio ya está conectado a otra tienda.');

    tienda.dominio_propio = limpio;
    tienda.dominio_propio_verificado = false;
    // Conectar un dominio nuevo lo deja habilitado aunque el anterior
    // estuviera apagado: es otro dominio, no el mismo.
    tienda.dominio_propio_habilitado = true;
    await tienda.save();

    return {
      dominio: limpio,
      estado: ESTADOS.PENDIENTE,
      verificado: false,
      registros: registrosPara(limpio),
    };
  }

  /**
   * Comprueba que el dominio apunte a nuestro servidor y, si ya apunta,
   * si además tiene el certificado emitido.
   *
   * Un dominio queda 'verificado' apenas el DNS resuelve a nuestra IP —
   * poder cambiar el DNS de un dominio es lo que significa ser su dueño. A
   * partir de ahí la tienda ya se sirve por ese hostname. Pasa a 'activo'
   * cuando Caddy le emitió el certificado, que ocurre en la primera visita.
   */
  static async verificarDominioPropio(usuario_id) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');
    if (!tienda.dominio_propio) throw new Error('No configuraste ningún dominio propio todavía.');

    if (!tienda.dominio_propio_habilitado) {
      // No se consulta el DNS: el dominio está apagado por decisión
      // nuestra, y lo que diga su DNS no cambia eso.
      return {
        dominio: tienda.dominio_propio,
        url: `https://${tienda.dominio_propio}`,
        estado: ESTADOS.DESHABILITADO,
        verificado: tienda.dominio_propio_verificado,
        registros: registrosPara(tienda.dominio_propio),
        detalle: 'El dominio está desactivado. Reactivalo para volver a servir la tienda por esa dirección.',
      };
    }

    // Si falta ORIGIN_IP el chequeo de DNS no se puede hacer, pero la
    // pantalla tiene que seguir siendo útil: antes la excepción se
    // propagaba, el endpoint devolvía 500 y el frontend mostraba las
    // casillas del registro vacías, sin decir por qué.
    let apunta = false;
    let detalle = null;
    try {
      ({ apunta, detalle } = await apuntaANuestroServidor(tienda.dominio_propio));
    } catch (err) {
      console.error('[dominio-propio] no se pudo verificar:', err.message);
      return {
        dominio: tienda.dominio_propio,
        url: `https://${tienda.dominio_propio}`,
        estado: ESTADOS.PENDIENTE,
        verificado: tienda.dominio_propio_verificado,
        registros: registrosPara(tienda.dominio_propio),
        detalle: `No se pudo verificar el dominio: ${err.message}`,
      };
    }

    if (apunta !== tienda.dominio_propio_verificado) {
      tienda.dominio_propio_verificado = apunta;
      await tienda.save();
    }

    let estado = ESTADOS.PENDIENTE;
    if (apunta) {
      // Solo se pregunta por el certificado si el DNS ya está: antes es
      // seguro que no existe, y la consulta tarda hasta 5 segundos.
      estado = (await sirvePorHttps(tienda.dominio_propio)) ? ESTADOS.ACTIVO : ESTADOS.VERIFICADO;
    }

    return {
      dominio: tienda.dominio_propio,
      url: `https://${tienda.dominio_propio}`,
      estado,
      verificado: tienda.dominio_propio_verificado,
      registros: registrosPara(tienda.dominio_propio),
      detalle,
    };
  }

  /**
   * ¿Le emitimos un certificado a este dominio?
   *
   * La consulta la hace Caddy contra el backend antes de pedirle el
   * certificado a Let's Encrypt, en mitad del handshake TLS. Sin este
   * filtro, cualquiera que apuntara un dominio a nuestra IP nos haría
   * emitir certificados a su nombre: no alcanza con que el DNS apunte acá,
   * el dominio tiene que estar cargado y verificado en Gesicomm.
   */
  static async dominioHabilitadoParaCertificado(dominio) {
    const limpio = (dominio || '').trim().toLowerCase();
    if (!limpio) return false;

    // El cliente carga dos registros A, la raíz y el www. Caddy pide
    // certificado para los dos (necesita uno para poder responder por HTTPS
    // el redirect de www a la raíz), pero en la base guardamos solo la raíz.
    const raiz = limpio.startsWith('www.') ? limpio.slice(4) : limpio;

    const tienda = await Tienda.findOne({
      where: {
        dominio_propio: { [Op.in]: [limpio, raiz] },
        dominio_propio_verificado: true,
        dominio_propio_habilitado: true,
        activo: true,
      },
      attributes: ['id'],
    });

    return !!tienda;
  }

  /**
   * Apaga o vuelve a prender el dominio sin perderlo. Mientras está
   * apagado no resuelve (middleware/resolverTienda.js) ni se le renueva el
   * certificado, pero el dominio sigue cargado y no hay que volver a
   * pasar por el DNS para recuperarlo.
   */
  static async cambiarHabilitacionDominioPropio(usuario_id, habilitado) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');
    if (!tienda.dominio_propio) throw new Error('No configuraste ningún dominio propio todavía.');

    tienda.dominio_propio_habilitado = !!habilitado;
    await tienda.save();

    return this.verificarDominioPropio(usuario_id);
  }

  static async eliminarDominioPropio(usuario_id) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');

    tienda.dominio_propio = null;
    tienda.dominio_propio_verificado = false;
    tienda.dominio_propio_habilitado = true;
    await tienda.save();

    return this.serializar(tienda);
  }

  /**
   * Quién administra el DNS del dominio — para poder mandar al usuario al
   * panel exacto donde tiene que crear los registros.
   *
   * Se miran PRIMERO los nameservers y recién después el registrar del
   * WHOIS. El registrar es dónde se compró el dominio; los NS son dónde
   * vive realmente el DNS, que es lo único que importa acá. Se separan
   * seguido (comprado en GoDaddy, DNS movido a Cloudflare): mirando solo
   * el WHOIS le mandábamos al usuario al panel equivocado, y los
   * registros que cargara ahí no iban a tener ningún efecto.
   *
   * Se reusa la misma columna `whois_match` de proveedores_dns para las
   * dos búsquedas: los NS de un proveedor contienen su nombre igual que
   * el registrar ("amalia.ns.cloudflare.com" contiene "cloudflare"), así
   * que no hace falta ni columna nueva ni filas nuevas.
   */
  static async obtenerInfoWhois(dominio) {
    if (!dominio) return null;

    const proveedores = await ProveedorDns.findAll();
    const buscar = (texto) => {
      const t = (texto || '').toLowerCase();
      if (!t) return null;
      return proveedores.find(p => t.includes(p.whois_match.toLowerCase())) || null;
    };

    const serializar = (p, fuente) => ({
      nombre: p.nombre,
      url_login: p.url_login ? p.url_login.replace('{dominio}', dominio) : null,
      instrucciones: p.instrucciones,
      logo_url: p.logo_url,
      // El frontend lo usa para no prometer más de lo que sabe: con 'ns'
      // el panel es seguro, con 'registrar' es una corazonada.
      fuente,
    });

    const ns = await nameserversDe(dominio);
    const porNs = buscar(ns.join(' '));
    if (porNs) return serializar(porNs, 'ns');

    try {
      const results = await whois(dominio);
      const porRegistrar = buscar(results.registrar || results.Registrar);
      if (porRegistrar) return serializar(porRegistrar, 'registrar');
    } catch (err) {
      console.error('[whois] Error:', err.message);
    }

    return null;
  }

  /** meta_access_token nunca sale del backend en texto plano ni cifrado. */
  static serializar(tienda) {
    const data = tienda.toJSON ? tienda.toJSON() : { ...tienda };
    data.meta_access_token_configurado = !!data.meta_access_token;
    delete data.meta_access_token;
    return data;
  }

  static serializarConTemaLanding(tienda, landingInicio) {
    const data = this.serializar(tienda);
    if (!landingInicio) return data;
    if (landingInicio.color_primario) data.color_primario = landingInicio.color_primario;
    if (landingInicio.color_texto) data.color_secundario = landingInicio.color_texto;
    if (landingInicio.color_fondo) data.color_fondo = landingInicio.color_fondo;
    return data;
  }

  static async sincronizarTemaLandings(tienda, payload) {
    const camposTema = {};
    if (payload.color_primario !== undefined) camposTema.color_primario = tienda.color_primario;
    if (payload.color_secundario !== undefined) camposTema.color_texto = tienda.color_secundario;
    if (payload.color_fondo !== undefined) camposTema.color_fondo = tienda.color_fondo;
    if (!Object.keys(camposTema).length) return;
    await Landing.update(camposTema, { where: { tienda_id: tienda.id } });
  }
}

module.exports = TiendaService;
