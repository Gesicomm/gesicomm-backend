'use strict';

/**
 * Servicio de Tienda — identidad pública de un usuario (subdominio,
 * opcionalmente dominio propio) y los valores por defecto (tema,
 * contacto, pixel) que heredan todas sus landings.
 */

const { Tienda, Usuario } = require('../models');
const EncryptionService = require('../utils/EncryptionService');
const { validarFormato: validarFormatoSubdominio, disponible: subdominioDisponible } = require('../utils/validarSubdominio');
const CloudflareService = require('./cloudflare.service');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const WHATSAPP_RE = /^\d{8,15}$/;
const META_PIXEL_RE = /^\d{15,16}$/;
const GA_ID_RE = /^G-[A-Z0-9]{4,16}$/i;
const TIKTOK_PIXEL_RE = /^[A-Z0-9]{10,25}$/i;
const PLANES_VALIDOS = new Set(['free', 'pago']);
// Formato laxo de dominio — la verificación real de que existe y resuelve
// bien la hace Cloudflare al crear el Custom Hostname.
const DOMINIO_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

class TiendaService {

  static async obtenerPorUsuario(usuario_id) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) return null;
    const usuario = await Usuario.findByPk(usuario_id, { attributes: ['plan'] });
    return { ...this.serializar(tienda), plan: usuario?.plan ?? null };
  }

  static validarCamposComunes(payload) {
    const errores = [];
    for (const campo of ['color_primario', 'color_secundario', 'color_fondo']) {
      const valor = payload[campo];
      if (valor !== undefined && valor !== null && valor !== '' && !HEX_COLOR_RE.test(valor)) {
        errores.push(`${campo} debe ser un color hexadecimal válido (#rrggbb).`);
      }
    }
    if (payload.whatsapp && !WHATSAPP_RE.test(payload.whatsapp)) {
      errores.push('whatsapp debe contener solo dígitos (código de país + número), entre 8 y 15 caracteres.');
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
      'nombre', 'whatsapp', 'telefono', 'mensaje_contacto', 'color_primario', 'color_secundario', 'color_fondo',
      'meta_test_event_code', 'google_analytics_id', 'tiktok_pixel_id',
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

    const subdominio = payload.subdominio.trim().toLowerCase();
    const { valido, motivo } = validarFormatoSubdominio(subdominio);
    if (!valido) throw new Error(motivo);
    if (!(await subdominioDisponible(subdominio))) throw new Error('Ese subdominio ya está en uso.');

    const plan = payload.plan || 'free';
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

    // El plan es de la cuenta (Usuario), no de la tienda — ver comentario
    // en Usuario.js. Se completa acá porque hoy el onboarding elige el
    // plan en el mismo paso que crea la tienda.
    await Usuario.update({ plan }, { where: { id: usuario_id } });

    return { ...this.serializar(tienda), plan };
  }

  static async actualizar(usuario_id, payload) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');

    const errores = this.validarCamposComunes(payload);

    let nuevoSubdominio = null;
    if (payload.subdominio !== undefined) {
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

    if (payload.plan !== undefined && !PLANES_VALIDOS.has(payload.plan)) {
      errores.push('plan debe ser "free" o "pago".');
    }

    if (errores.length) {
      const err = new Error('Validación fallida.');
      err.errores = errores;
      throw err;
    }

    Object.assign(tienda, this.camposEditables(payload));
    if (nuevoSubdominio !== null) tienda.subdominio = nuevoSubdominio;
    await tienda.save();

    // El plan vive en Usuario, no en Tienda — ver comentario en Usuario.js.
    if (payload.plan !== undefined) {
      await Usuario.update({ plan: payload.plan }, { where: { id: usuario_id } });
    }
    const usuario = await Usuario.findByPk(usuario_id, { attributes: ['plan'] });

    return { ...this.serializar(tienda), plan: usuario?.plan ?? null };
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

  // ─── Dominio propio (Cloudflare for SaaS) ──────────────────────────────────

  static async guardarDominioPropio(usuario_id, dominio) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');

    const limpio = (dominio || '').trim().toLowerCase();
    if (!DOMINIO_RE.test(limpio)) throw new Error('Ese dominio no tiene un formato válido.');

    // Si ya había un dominio propio (con o sin verificar), liberar el hostname viejo en Cloudflare.
    if (tienda.dominio_propio_cf_hostname_id) {
      try {
        await CloudflareService.eliminarCustomHostname(tienda.dominio_propio_cf_hostname_id);
      } catch (err) {
        console.warn('[tienda] no se pudo liberar el custom hostname anterior:', err.message);
      }
    }

    const resultado = await CloudflareService.crearCustomHostname(limpio);

    tienda.dominio_propio = limpio;
    tienda.dominio_propio_verificado = false;
    tienda.dominio_propio_cf_hostname_id = resultado.id;
    await tienda.save();

    return {
      dominio: limpio,
      verificado: false,
      registro_txt: resultado.ownershipVerification,
    };
  }

  static async verificarDominioPropio(usuario_id) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');
    if (!tienda.dominio_propio_cf_hostname_id) throw new Error('No configuraste ningún dominio propio todavía.');

    const estado = await CloudflareService.verificarEstado(tienda.dominio_propio_cf_hostname_id);

    if (estado.activo && !tienda.dominio_propio_verificado) {
      tienda.dominio_propio_verificado = true;
      await tienda.save();
    }

    return {
      dominio: tienda.dominio_propio,
      verificado: tienda.dominio_propio_verificado,
      estado_cloudflare: estado.estado,
      // Se reenvía en cada consulta, no solo al crear, para que la UI
      // pueda re-mostrar el TXT si el usuario recarga antes de verificar.
      registro_txt: estado.ownershipVerification,
    };
  }

  static async eliminarDominioPropio(usuario_id) {
    const tienda = await Tienda.findOne({ where: { usuario_id } });
    if (!tienda) throw new Error('Todavía no tenés una tienda creada.');

    if (tienda.dominio_propio_cf_hostname_id) {
      await CloudflareService.eliminarCustomHostname(tienda.dominio_propio_cf_hostname_id);
    }

    tienda.dominio_propio = null;
    tienda.dominio_propio_verificado = false;
    tienda.dominio_propio_cf_hostname_id = null;
    await tienda.save();

    return this.serializar(tienda);
  }

  /** meta_access_token nunca sale del backend en texto plano ni cifrado. */
  static serializar(tienda) {
    const data = tienda.toJSON ? tienda.toJSON() : { ...tienda };
    data.meta_access_token_configurado = !!data.meta_access_token;
    delete data.meta_access_token;
    return data;
  }
}

module.exports = TiendaService;
