'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { SolicitudEliminacion, Usuario, MetaIntegration } = require('../models');

/**
 * Plazo máximo comprometido públicamente en /data-deletion y en la Política
 * de Privacidad. Coincide con el que exige GDPR art. 12.3 (un mes) y con el
 * de CCPA/CPRA (45 días), así que el más estricto de los dos es el que rige.
 */
const PLAZO_DIAS = 30;

/** Estados en los que la solicitud todavía no se resolvió. */
const ESTADOS_ABIERTOS = ['recibida', 'verificando_identidad', 'en_proceso'];

class SolicitudEliminacionService {
  /**
   * Código de confirmación público. 24 caracteres hex (96 bits de entropía):
   * suficiente para que no se pueda enumerar la tabla probando códigos, que
   * es el único control de acceso que tiene la página pública de estado.
   */
  static generarCodigo() {
    return crypto.randomBytes(12).toString('hex');
  }

  static calcularFechaLimite(desde = new Date()) {
    const limite = new Date(desde);
    limite.setDate(limite.getDate() + PLAZO_DIAS);
    return limite;
  }

  /**
   * Vista pública de una solicitud. Devuelve solo lo necesario para que el
   * titular confirme que su pedido está en curso: nunca email, nombre,
   * motivo, IP ni notas internas, porque a esta vista se llega con el código
   * solo — sin autenticación — y no hay forma de saber quién la consulta.
   */
  static serializarPublico(solicitud) {
    return {
      codigo: solicitud.codigo,
      estado: solicitud.estado,
      recibida_en: solicitud.created_at,
      fecha_limite: solicitud.fecha_limite,
      procesada_en: solicitud.procesada_en,
      plazo_dias: PLAZO_DIAS,
    };
  }

  /** Vista interna, para el listado del panel de administración. */
  static serializarAdmin(solicitud) {
    return {
      id: solicitud.id,
      codigo: solicitud.codigo,
      origen: solicitud.origen,
      estado: solicitud.estado,
      nombre: solicitud.nombre,
      email: solicitud.email,
      empresa: solicitud.empresa,
      motivo: solicitud.motivo,
      meta_user_id: solicitud.meta_user_id,
      usuario_id: solicitud.usuario_id,
      recibida_en: solicitud.created_at,
      fecha_limite: solicitud.fecha_limite,
      procesada_en: solicitud.procesada_en,
      notas_internas: solicitud.notas_internas,
    };
  }

  /**
   * Alta desde el formulario público de /data-deletion.
   *
   * 1. Valida que el correo pertenezca a una cuenta registrada en el sistema.
   * 2. Si ya hay una solicitud abierta para el mismo email devuelve esa en vez
   *    de crear otra (evita duplicar registros o reiniciar el plazo).
   */
  static async crearDesdeFormulario(datos, contexto = {}) {
    const { nombre, email, empresa, motivo } = datos;
    const emailNormalizado = String(email).trim().toLowerCase();

    // 1. Verificar existencia del usuario en la plataforma
    const usuario = await Usuario.findOne({
      where: { correo_electronico: emailNormalizado },
    });

    if (!usuario) {
      const error = new Error('No encontramos ninguna cuenta registrada con este correo electrónico.');
      error.statusCode = 404;
      throw error;
    }

    const existente = await SolicitudEliminacion.findOne({
      where: { email: emailNormalizado, estado: { [Op.in]: ESTADOS_ABIERTOS } },
      order: [['created_at', 'DESC']],
    });
    if (existente) {
      return { solicitud: this.serializarPublico(existente), duplicada: true };
    }

    const solicitud = await SolicitudEliminacion.create({
      codigo: this.generarCodigo(),
      origen: 'formulario_publico',
      estado: 'recibida',
      nombre: String(nombre).trim(),
      email: emailNormalizado,
      empresa: empresa ? String(empresa).trim() : null,
      motivo: motivo ? String(motivo).trim() : null,
      usuario_id: usuario.id,
      inquilino_id: usuario.inquilino_id || null,
      ip_solicitante: contexto.ip || null,
      user_agent: contexto.userAgent ? String(contexto.userAgent).slice(0, 500) : null,
      fecha_limite: this.calcularFechaLimite(),
    });

    return { solicitud: this.serializarPublico(solicitud), duplicada: false };
  }

  /**
   * Verifica y decodifica el `signed_request` que Meta manda al Data Deletion
   * Callback.
   *
   * Formato: "<firma>.<payload>", ambos en base64url. La firma es el
   * HMAC-SHA256 del payload con el App Secret. Sin esta verificación
   * cualquiera podría postear al callback y disparar borrados de datos
   * ajenos, así que un fallo acá tiene que abortar, nunca degradar.
   */
  static parsearSignedRequest(signedRequest, appSecret) {
    if (!appSecret) {
      throw new Error('FACEBOOK_APP_SECRET no configurado en el servidor.');
    }
    if (typeof signedRequest !== 'string' || !signedRequest.includes('.')) {
      throw new Error('signed_request inválido.');
    }

    const [firmaB64, payloadB64] = signedRequest.split('.', 2);
    if (!firmaB64 || !payloadB64) {
      throw new Error('signed_request inválido.');
    }

    const firmaRecibida = Buffer.from(firmaB64, 'base64url');
    const firmaEsperada = crypto
      .createHmac('sha256', appSecret)
      .update(payloadB64)
      .digest();

    // timingSafeEqual exige longitudes iguales; si difieren la firma ya es
    // inválida y comparar directo evitaría la excepción de la función.
    if (
      firmaRecibida.length !== firmaEsperada.length ||
      !crypto.timingSafeEqual(firmaRecibida, firmaEsperada)
    ) {
      throw new Error('Firma del signed_request inválida.');
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch (err) {
      throw new Error('Payload del signed_request ilegible.');
    }

    if (payload.algorithm && String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') {
      throw new Error(`Algoritmo no soportado: ${payload.algorithm}`);
    }
    if (!payload.user_id) {
      throw new Error('El signed_request no contiene user_id.');
    }

    return payload;
  }

  /**
   * Alta desde el Data Deletion Callback de Meta: el usuario desvinculó la
   * app desde su configuración de Facebook/Instagram y Meta nos avisa.
   *
   * Lo único obtenido de Meta que se guarda son las filas de
   * meta_integrations (token cifrado, ID y nombre del BM): se borran en el
   * acto y la solicitud nace completada. Las métricas de campañas nunca se
   * persisten. Si no aparece ninguna conexión con ese meta_user_id (por
   * ejemplo, una conectada antes de que existiera la columna), la solicitud
   * queda 'recibida' para que la resuelva el equipo a mano.
   *
   * Reutiliza la solicitud abierta del mismo meta_user_id si existe, para que
   * desvincular y volver a vincular varias veces no genere duplicados.
   */
  static async crearDesdeMetaCallback(signedRequest, appSecret, contexto = {}) {
    const payload = this.parsearSignedRequest(signedRequest, appSecret);
    const metaUserId = String(payload.user_id);

    const conexiones = await MetaIntegration.findAll({ where: { meta_user_id: metaUserId } });
    if (conexiones.length > 0) {
      await MetaIntegration.destroy({ where: { meta_user_id: metaUserId } });
    }

    const existente = await SolicitudEliminacion.findOne({
      where: { meta_user_id: metaUserId, estado: { [Op.in]: ESTADOS_ABIERTOS } },
      order: [['created_at', 'DESC']],
    });
    if (existente) {
      return { codigo: existente.codigo, meta_user_id: metaUserId, duplicada: true, conexiones_borradas: conexiones.length };
    }

    const borradas = conexiones.length > 0;
    const solicitud = await SolicitudEliminacion.create({
      codigo: this.generarCodigo(),
      origen: 'meta_callback',
      estado: borradas ? 'completada' : 'recibida',
      meta_user_id: metaUserId,
      usuario_id: borradas ? conexiones[0].usuario_id : null,
      inquilino_id: borradas ? conexiones[0].inquilino_id : null,
      motivo: 'Desvinculación de la aplicación desde la configuración de Meta.',
      notas_internas: borradas
        ? `Borrado automático de ${conexiones.length} conexión(es) de Meta (ids ${conexiones.map((c) => c.id).join(', ')}).`
        : 'Sin conexiones con este meta_user_id: revisar a mano.',
      // Resuelta en el acto: IP y user agent eran evidencia de la solicitud y
      // no se conservan, igual que en actualizarEstado().
      ip_solicitante: borradas ? null : contexto.ip || null,
      user_agent: borradas || !contexto.userAgent ? null : String(contexto.userAgent).slice(0, 500),
      procesada_en: borradas ? new Date() : null,
      fecha_limite: this.calcularFechaLimite(),
    });

    return { codigo: solicitud.codigo, meta_user_id: metaUserId, duplicada: false };
  }

  /**
   * Alta desde el panel, con la sesión iniciada (Configuración → Privacidad
   * y datos).
   *
   * A diferencia del formulario público, acá la identidad ya está probada
   * dos veces —el token de sesión y la contraseña que se reconfirma en el
   * controller—, así que la solicitud entra directamente en 'en_proceso' y
   * se saltea el paso de verificación por correo.
   *
   * `alcance` distingue las dos opciones que ofrece la pantalla:
   *  - 'datos'  borra el contenido de la cuenta y la deja activa.
   *  - 'cuenta' borra la cuenta entera con todos sus usuarios.
   */
  static async crearDesdePanel({ usuario, alcance, motivo }, contexto = {}) {
    const existente = await SolicitudEliminacion.findOne({
      where: { usuario_id: usuario.id, estado: { [Op.in]: ESTADOS_ABIERTOS } },
      order: [['created_at', 'DESC']],
    });
    if (existente) {
      return { solicitud: this.serializarPublico(existente), duplicada: true };
    }

    const descripcionAlcance =
      alcance === 'cuenta'
        ? 'Eliminación de la cuenta completa y de todos sus usuarios.'
        : 'Eliminación de todo el contenido de la cuenta, conservando el acceso.';

    const solicitud = await SolicitudEliminacion.create({
      codigo: this.generarCodigo(),
      origen: 'panel_usuario',
      estado: 'en_proceso',
      nombre: usuario.nombre || null,
      email: usuario.email ? String(usuario.email).toLowerCase() : null,
      usuario_id: usuario.id,
      inquilino_id: usuario.tenantId || null,
      motivo: motivo ? String(motivo).trim() : null,
      notas_internas: `Alcance: ${alcance}. ${descripcionAlcance} Identidad verificada por sesión y contraseña.`,
      ip_solicitante: contexto.ip || null,
      user_agent: contexto.userAgent ? String(contexto.userAgent).slice(0, 500) : null,
      fecha_limite: this.calcularFechaLimite(),
    });

    return { solicitud: this.serializarPublico(solicitud), duplicada: false };
  }

  /** Consulta pública por código, para /data-deletion/estado/<codigo>. */
  static async consultarEstado(codigo) {
    const solicitud = await SolicitudEliminacion.findOne({ where: { codigo } });
    if (!solicitud) throw new Error('Solicitud no encontrada.');
    return this.serializarPublico(solicitud);
  }

  /** Listado interno paginado, para el panel de administración. */
  static async listar(filtros = {}) {
    const { estado, origen, email, page = 1, limit = 20 } = filtros;
    const where = {};
    if (estado) where.estado = estado;
    if (origen) where.origen = origen;
    if (email) where.email = { [Op.iLike]: `%${email}%` };

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows, count } = await SolicitudEliminacion.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    return {
      total: count,
      pagina: parseInt(page),
      total_paginas: Math.ceil(count / parseInt(limit)),
      solicitudes: rows.map((s) => this.serializarAdmin(s)),
    };
  }

  /**
   * Avance manual del estado por parte del equipo de privacidad.
   * Al pasar a 'completada' o 'rechazada' se sella `procesada_en` y se
   * descartan IP y user agent: eran evidencia de la solicitud, no datos que
   * tenga sentido conservar una vez resuelta.
   */
  static async actualizarEstado(id, datos) {
    const solicitud = await SolicitudEliminacion.findByPk(id);
    if (!solicitud) throw new Error('Solicitud no encontrada.');

    const { estado, notas_internas, usuario_id } = datos;
    if (estado) solicitud.estado = estado;
    if (notas_internas !== undefined) solicitud.notas_internas = notas_internas;
    if (usuario_id !== undefined) solicitud.usuario_id = usuario_id;

    if (estado === 'completada' || estado === 'rechazada') {
      solicitud.procesada_en = new Date();
      solicitud.ip_solicitante = null;
      solicitud.user_agent = null;
    }

    await solicitud.save();
    return this.serializarAdmin(solicitud);
  }
}

module.exports = SolicitudEliminacionService;
module.exports.PLAZO_DIAS = PLAZO_DIAS;
