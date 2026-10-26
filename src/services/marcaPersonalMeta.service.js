'use strict';
// Instagram y Facebook de Marca Personal con la app de Gesicom.
//
// Un solo inicio de sesión de Facebook ("Instagram API with Facebook Login"):
// el usuario elige la Página de su marca y Gesicom usa también la cuenta
// profesional de Instagram vinculada a esa Página. Todo va contra
// graph.facebook.com con el token de la Página; no hay app de Instagram aparte.
//
// Cada marca (account_id de T2E) tiene a lo sumo una Página y su Instagram.
// La marca nunca llega desde el navegador: se resuelve con el vínculo SSO del
// usuario. Los tokens se guardan cifrados y son de esa sola Página, así que
// Meta rechaza cualquier ID (publicación, comentario, conversación) que no le
// pertenezca: el aislamiento entre marcas no depende solo de nuestros controles.
const crypto = require('crypto');
const { MarcaPersonalError } = require('./marcaPersonal.client');
const EncryptionService = require('../utils/EncryptionService');
const { logger } = require('../utils/logger');

// Solo los permisos de Página que la app tiene pedidos en Meta. Los de Instagram de la app son
// instagram_business_*, que el inicio de sesión de Facebook rechaza: Instagram no se vincula por acá.
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'];
// WhatsApp se conecta con su propio inicio de sesión: solo pide lo de WhatsApp.
// business_management (pedido en la app) deja encontrar las cuentas de WhatsApp de los
// portafolios cuando Meta no detalla en el token qué cuentas se eligieron.
const SCOPES_WHATSAPP = ['whatsapp_business_management', 'whatsapp_business_messaging', 'business_management'];
const IDIOMAS_PLANTILLA = ['es', 'es_AR', 'es_MX', 'es_ES', 'en_US', 'pt_BR'];

const MEDIOS = {
  imagen: { tipos: ['image/jpeg'], max: 8 * 1024 * 1024, ext: 'jpg' },
  video: { tipos: ['video/mp4', 'video/quicktime'], max: 90 * 1024 * 1024, ext: 'mp4' },
};
const VENTANA_MENSAJES_MS = 24 * 3600 * 1000;

const error = (mensaje, status = 400) => new MarcaPersonalError(mensaje, status);
const idMeta = (v, nombre = 'Identificador') => {
  const s = String(v ?? '');
  if (!/^[0-9_]{1,64}$/.test(s)) throw error(`${nombre} inválido.`);
  return s;
};
const texto = (v, max, nombre) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) throw error(`${nombre} admite hasta ${max} caracteres.`);
  return v.trim();
};
const cursor = (v) => (v === undefined || v === null || v === '' ? undefined
  : (typeof v === 'string' && /^[A-Za-z0-9_\-=]{1,1000}$/.test(v) ? v : (() => { throw error('Página inválida.'); })()));

function config() {
  return {
    facebookAppId: process.env.FACEBOOK_APP_ID,
    facebookSecret: process.env.FACEBOOK_APP_SECRET,
    base: (process.env.MARCA_PERSONAL_META_REDIRECT_BASE || 'https://automation.gesicomm.com/gesicom-auth/marca-personal/meta').replace(/\/$/, ''),
  };
}

function databaseStore() {
  const db = require('../config/database');
  const q = async (sql, replacements = {}) => (await db.query(sql, { replacements }))[0];
  const COLS = 'id, account_id, usuario_id, plataforma, external_id, cuenta_id, meta_user_id, nombre, username, access_token, token_expira, permisos, created_at, updated_at';
  return {
    conexiones: (account) => q(`SELECT ${COLS} FROM marca_personal_meta_conexiones WHERE account_id=:account ORDER BY plataforma`, { account }),
    async conexion(account, plataforma) {
      return (await q(`SELECT ${COLS} FROM marca_personal_meta_conexiones WHERE account_id=:account AND plataforma=:plataforma`, { account, plataforma }))[0] || null;
    },
    async guardarConexion(c) {
      try {
        return (await q(`INSERT INTO marca_personal_meta_conexiones
          (account_id, usuario_id, plataforma, external_id, cuenta_id, meta_user_id, nombre, username, access_token, token_expira, permisos)
          VALUES (:account, :usuario, :plataforma, :external, :cuenta, :metaUser, :nombre, :username, :token, :expira, CAST(:permisos AS JSONB))
          ON CONFLICT (account_id, plataforma) DO UPDATE SET usuario_id=EXCLUDED.usuario_id, external_id=EXCLUDED.external_id, cuenta_id=EXCLUDED.cuenta_id,
            meta_user_id=EXCLUDED.meta_user_id, nombre=EXCLUDED.nombre, username=EXCLUDED.username, access_token=EXCLUDED.access_token,
            token_expira=EXCLUDED.token_expira, permisos=EXCLUDED.permisos, updated_at=NOW()
          RETURNING id`, { cuenta: null, ...c, permisos: JSON.stringify(c.permisos || []) }))[0];
      } catch (e) {
        if (e?.original?.code === '23505' || e?.parent?.code === '23505') {
          throw error('Esta cuenta ya está conectada en otra marca de Gesicom. Desconectala allí primero.', 409);
        }
        throw e;
      }
    },
    borrarConexion: async (account, id) => (await q('DELETE FROM marca_personal_meta_conexiones WHERE account_id=:account AND id=:id RETURNING id, plataforma', { account, id }))[0] || null,
    borrarPlataforma: (account, plataforma) => q('DELETE FROM marca_personal_meta_conexiones WHERE account_id=:account AND plataforma=:plataforma', { account, plataforma }),
    borrarPorMetaUser: (metaUser) => q('DELETE FROM marca_personal_meta_conexiones WHERE meta_user_id=:metaUser RETURNING id, usuario_id', { metaUser }),
    async crearPublicacion(p) {
      return (await q(`INSERT INTO marca_personal_meta_publicaciones (account_id, conexion_id, usuario_id, plataforma, formato, texto, medios)
        VALUES (:account, :conexion, :usuario, :plataforma, :formato, :texto, CAST(:medios AS JSONB)) RETURNING *`, { ...p, medios: JSON.stringify(p.medios) }))[0];
    },
    async actualizarPublicacion(id, cambios) {
      const permitidos = ['estado', 'contenedor_id', 'external_id', 'permalink', 'error'];
      const sets = permitidos.filter((k) => k in cambios).map((k) => `${k}=:${k}`);
      return (await q(`UPDATE marca_personal_meta_publicaciones SET ${sets.join(', ')}, updated_at=NOW() WHERE id=:id RETURNING *`, { id, ...cambios }))[0];
    },
    async publicacion(account, id) {
      return (await q('SELECT * FROM marca_personal_meta_publicaciones WHERE account_id=:account AND id=:id', { account, id }))[0] || null;
    },
    historial: (account, limite, desde) => q(`SELECT id, plataforma, formato, texto, estado, external_id, permalink, error, created_at
      FROM marca_personal_meta_publicaciones WHERE account_id=:account ORDER BY created_at DESC, id DESC LIMIT :limite OFFSET :desde`, { account, limite, desde }),
  };
}

function createService({ store, graph, cuentaDe, r2, ahora = () => Date.now() } = {}) {
  const db = () => store || (store = databaseStore());
  const g = () => graph || (graph = require('./marcaPersonalMeta.graph'));
  const almacenamiento = () => r2 || (r2 = require('./r2/r2.service').R2Service);

  // La marca sale del vínculo SSO: el navegador no puede elegir otra.
  async function marca(usuario) {
    if (cuentaDe) return cuentaDe(usuario);
    const mp = require('./marcaPersonal.service');
    const perfil = await mp.identity(usuario);
    if (!perfil?.enabled) throw error('Tu acceso de Gesicom no está activo.', 403);
    const link = await mp.remote().getLink(usuario);
    if (!link?.account_id) throw error('Abrí Marca Personal una vez para crear tu marca antes de conectar redes.', 409);
    return link.account_id;
  }

  // Instagram usa el mismo token de la Página a la que está vinculado. Los
  // tokens de Página obtenidos con un token de usuario de larga duración no vencen.
  async function conexionLista(account, plataforma) {
    const c = await db().conexion(account, plataforma);
    if (!c) {
      throw error(plataforma === 'instagram'
        ? 'Tu Página de Facebook no tiene una cuenta profesional de Instagram vinculada. Vinculala en Meta y volvé a conectar.'
        : plataforma === 'whatsapp' ? 'Conectá tu número de WhatsApp Business primero.' : 'Conectá tu Página de Facebook primero.', 409);
    }
    // WhatsApp usa el token de usuario de larga duración (60 días).
    if (c.token_expira && new Date(c.token_expira).getTime() <= ahora()) {
      throw error('El acceso venció. Volvé a conectar desde «Conexiones».', 409);
    }
    return { ...c, token: EncryptionService.decrypt(c.access_token) };
  }

  const publica = (c) => ({
    id: c.id, plataforma: c.plataforma, external_id: c.external_id, cuenta_id: c.cuenta_id || null, nombre: c.nombre, username: c.username,
    permisos: c.permisos || [], conectada_en: c.updated_at, vence: c.token_expira || null,
  });

  async function estado(usuario) {
    const account = await marca(usuario);
    const cfg = config();
    return { conexiones: (await db().conexiones(account)).map(publica), disponible: Boolean(cfg.facebookAppId && cfg.facebookSecret) };
  }

  // Facebook (Página e Instagram) y WhatsApp usan el mismo retorno; cambian los permisos.
  function urlAutorizacion(state, tipo = 'facebook') {
    const cfg = config();
    if (!cfg.facebookAppId || !cfg.facebookSecret) throw error('La conexión con Facebook todavía no está configurada en Gesicom.', 503);
    const u = new URL(`https://www.facebook.com/${process.env.FACEBOOK_API_VERSION || 'v23.0'}/dialog/oauth`);
    const scopes = tipo === 'whatsapp' ? SCOPES_WHATSAPP : SCOPES;
    u.search = new URLSearchParams({ client_id: cfg.facebookAppId, redirect_uri: `${cfg.base}/facebook/callback`, response_type: 'code', scope: scopes.join(','), state }).toString();
    return u.href;
  }

  async function tokenDeUsuario(code) {
    const cfg = config();
    const corto = await g().facebook('oauth/access_token', { params: { client_id: cfg.facebookAppId, client_secret: cfg.facebookSecret, redirect_uri: `${cfg.base}/facebook/callback`, code } });
    const largo = await g().facebook('oauth/access_token', { params: { grant_type: 'fb_exchange_token', client_id: cfg.facebookAppId, client_secret: cfg.facebookSecret, fb_exchange_token: corto.access_token } });
    const yo = await g().facebook('me', { token: largo.access_token, params: { fields: 'id' } });
    return { token: largo.access_token, metaUser: String(yo.id), expira: largo.expires_in ? ahora() + Number(largo.expires_in) * 1000 : ahora() + 60 * 86400000 };
  }

  // Devuelve las Páginas que administra quien autorizó. Con una sola se
  // conecta directo; con varias, el usuario elige (ver confirmarPagina).
  async function completarFacebook(usuario, code) {
    await marca(usuario);
    const { token, metaUser } = await tokenDeUsuario(code);
    const pendiente = { token, metaUser };
    const paginas = await paginasDe(pendiente);
    if (paginas.length === 0) throw error('Tu usuario de Facebook no administra ninguna Página, o no la seleccionaste al autorizar.', 409);
    if (paginas.length === 1) return confirmarPagina(usuario, pendiente, paginas[0].id);
    return { pendiente };
  }

  async function paginasDe(pendiente) {
    const r = await g().facebook('me/accounts', { token: pendiente.token, params: { fields: 'id,name,tasks', limit: 100 } });
    return (r.data || []).map((p) => ({
      id: String(p.id), nombre: p.name, puede_publicar: (p.tasks || []).includes('CREATE_CONTENT'),
      instagram: p.instagram_business_account?.username || null,
    }));
  }

  async function confirmarPagina(usuario, pendiente, pageId) {
    const account = await marca(usuario);
    const id = idMeta(pageId, 'Página');
    // El token de Página sale de nuevo de Meta: el navegador nunca lo envía.
    // El nodo de la Página no tiene el campo tasks y Meta rechaza todo el pedido: se pide solo lo necesario.
    const pagina = await g().facebook(id, { token: pendiente.token, params: { fields: 'id,name,access_token' } });
    if (String(pagina.id) !== id || !pagina.access_token) throw error('Tu usuario no puede administrar esa Página.', 403);
    const permisos = ((await g().facebook('me/permissions', { token: pendiente.token })).data || [])
      .filter((p) => p.status === 'granted').map((p) => p.permission);
    const comun = { account, usuario, metaUser: pendiente.metaUser, token: EncryptionService.encrypt(pagina.access_token), expira: null, permisos };
    await db().guardarConexion({ ...comun, plataforma: 'facebook', external: id, nombre: pagina.name, username: null });
    const ig = pagina.instagram_business_account;
    if (ig?.id) {
      await db().guardarConexion({ ...comun, plataforma: 'instagram', external: idMeta(ig.id, 'Cuenta de Instagram'), nombre: ig.name || ig.username, username: ig.username });
    } else {
      // Cambió a una Página sin Instagram: no queda vinculada la cuenta anterior.
      await db().borrarPlataforma(account, 'instagram');
    }
    return { conectada: pagina.name, instagram: ig?.username || null, permisos_faltantes: SCOPES.filter((s) => !permisos.includes(s)) };
  }

  // Instagram depende de la Página: desconectar la Página quita los dos.
  async function desconectar(usuario, conexionId) {
    const account = await marca(usuario);
    const borrada = await db().borrarConexion(account, Number(conexionId));
    if (!borrada) throw error('Conexión no encontrada.', 404);
    if (borrada.plataforma === 'facebook') await db().borrarPlataforma(account, 'instagram');
    return { desconectada: borrada.plataforma };
  }

  // --- WhatsApp (Cloud API) ---------------------------------------------------
  // Las cuentas de WhatsApp Business autorizadas salen de los permisos
  // granulares del token (debug_token), sin pedir business_management.
  async function completarWhatsapp(usuario, code) {
    await marca(usuario);
    const pendiente = await tokenDeUsuario(code);
    const numeros = await numerosWhatsapp(pendiente);
    if (numeros.length === 0) throw error('No autorizaste ninguna cuenta de WhatsApp Business con números, o la cuenta todavía no tiene un número.', 409);
    if (numeros.length === 1) return confirmarWhatsapp(usuario, pendiente, numeros[0].id);
    return { pendiente };
  }

  async function numerosWhatsapp(pendiente) {
    const cfg = config();
    const debug = await g().facebook('debug_token', { token: `${cfg.facebookAppId}|${cfg.facebookSecret}`, params: { input_token: pendiente.token } });
    const cuentas = [...new Set((debug.data?.granular_scopes || [])
      .filter((s) => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging')
      .flatMap((s) => s.target_ids || []).map(String))];
    const fallos = [];
    let portafolios = 0;
    if (cuentas.length === 0) {
      const bms = await g().facebook('me/businesses', { token: pendiente.token, params: { fields: 'id', limit: 50 } }).catch((e) => { fallos.push(e.message); return { data: [] }; });
      portafolios = (bms.data || []).length;
      for (const bm of bms.data || []) {
        for (const borde of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
          const r = await g().facebook(`${idMeta(bm.id, 'Portafolio')}/${borde}`, { token: pendiente.token, params: { fields: 'id', limit: 50 } }).catch((e) => { fallos.push(e.message); return { data: [] }; });
          for (const w of r.data || []) if (!cuentas.includes(String(w.id))) cuentas.push(String(w.id));
        }
      }
    }
    if (cuentas.length === 0) {
      // Sin ids ni tokens: qué permisos concedió Meta y por qué no apareció ninguna cuenta.
      logger.error({ mensaje: 'Marca Personal WhatsApp sin cuentas', permisos: (debug.data?.granular_scopes || []).map((s) => `${s.scope}:${(s.target_ids || []).length}`), portafolios, fallos });
    }
    const numeros = [];
    for (const waba of cuentas) {
      const [cuenta, tel] = await Promise.all([
        g().facebook(idMeta(waba, 'Cuenta de WhatsApp'), { token: pendiente.token, params: { fields: 'id,name' } }).catch(() => ({ id: waba, name: null })),
        g().facebook(`${waba}/phone_numbers`, { token: pendiente.token, params: { fields: 'id,display_phone_number,verified_name,quality_rating', limit: 50 } }).catch((e) => { logger.error({ mensaje: 'Marca Personal WhatsApp números', waba, error: e.message }); return { data: [] }; }),
      ]);
      for (const n of tel.data || []) {
        numeros.push({ id: String(n.id), cuenta_id: waba, cuenta: cuenta.name || waba, numero: n.display_phone_number, nombre: n.verified_name || null, calidad: n.quality_rating || null });
      }
    }
    return numeros;
  }

  async function confirmarWhatsapp(usuario, pendiente, phoneId) {
    const account = await marca(usuario);
    const id = idMeta(phoneId, 'Número');
    // Solo se acepta un número de las cuentas que el usuario autorizó en Meta.
    const numero = (await numerosWhatsapp(pendiente)).find((n) => n.id === id);
    if (!numero) throw error('Ese número no pertenece a las cuentas de WhatsApp Business que autorizaste.', 403);
    const permisos = ((await g().facebook('me/permissions', { token: pendiente.token })).data || [])
      .filter((p) => p.status === 'granted').map((p) => p.permission);
    await db().guardarConexion({
      account, usuario, plataforma: 'whatsapp', external: id, cuenta: numero.cuenta_id, metaUser: pendiente.metaUser,
      nombre: numero.nombre || numero.cuenta, username: numero.numero,
      token: EncryptionService.encrypt(pendiente.token), expira: new Date(pendiente.expira || ahora() + 60 * 86400000), permisos,
    });
    return { conectado: numero.numero, nombre: numero.nombre, permisos_faltantes: SCOPES_WHATSAPP.filter((s) => s.startsWith('whatsapp_') && !permisos.includes(s)) };
  }

  const telefono = (v) => {
    const s = String(v ?? '').replace(/[\s()+.-]/g, '');
    if (!/^\d{8,15}$/.test(s)) throw error('Escribí el número con código de país, solo dígitos (por ejemplo 595981123456).');
    return s;
  };

  // Fuera de las 24 h posteriores al último mensaje de la persona, WhatsApp
  // solo acepta plantillas aprobadas; Meta lo informa con el código 131047.
  async function enviarWhatsapp(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'whatsapp');
    const para = telefono(body?.para);
    let mensaje;
    if (body?.tipo === 'plantilla') {
      const nombre = String(body?.plantilla || '');
      if (!/^[a-z0-9_]{1,512}$/.test(nombre)) throw error('Elegí una plantilla.');
      const idioma = String(body?.idioma || '');
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)) throw error('Idioma de plantilla inválido.');
      mensaje = { type: 'template', template: { name: nombre, language: { code: idioma } } };
    } else {
      const contenido = texto(body?.texto, 4096, 'El mensaje');
      if (!contenido) throw error('Escribí el mensaje.');
      mensaje = { type: 'text', text: { body: contenido } };
    }
    try {
      const r = await g().facebook(`${c.external_id}/messages`, { method: 'POST', token: c.token, json: { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, ...mensaje } });
      const id = r.messages?.[0]?.id;
      if (!id) throw error('WhatsApp no confirmó el envío. Revisá el chat antes de repetir.', 503);
      return { id, para: r.contacts?.[0]?.wa_id || para, estado: r.messages?.[0]?.message_status || 'accepted' };
    } catch (e) {
      if (e.metaCode === 131047) throw error('Pasaron más de 24 horas desde el último mensaje de esa persona: WhatsApp solo permite enviarle una plantilla aprobada.', 409);
      if (e.metaCode === 131030) throw error('Con el número de prueba de Meta solo podés escribir a destinatarios agregados en WhatsApp → Configuración de la API.', 409);
      throw e;
    }
  }

  async function plantillasWhatsapp(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'whatsapp');
    if (!c.cuenta_id) throw error('Volvé a conectar WhatsApp para administrar plantillas.', 409);
    const r = await g().facebook(`${idMeta(c.cuenta_id, 'Cuenta de WhatsApp')}/message_templates`, { token: c.token, params: { fields: 'id,name,status,category,language,components,rejected_reason', limit: 25, after: cursor(body?.after) } });
    return {
      items: (r.data || []).map((p) => ({
        id: p.id, nombre: p.name, estado: p.status, categoria: p.category, idioma: p.language, motivo_rechazo: p.rejected_reason && p.rejected_reason !== 'NONE' ? p.rejected_reason : null,
        cuerpo: (p.components || []).find((x) => x.type === 'BODY')?.text || '',
      })),
      ...paging(r),
    };
  }

  // Plantillas de texto sin variables: es lo que el formulario permite crear.
  async function crearPlantilla(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'whatsapp');
    if (!c.cuenta_id) throw error('Volvé a conectar WhatsApp para administrar plantillas.', 409);
    const nombre = String(body?.nombre || '').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(nombre)) throw error('El nombre va en minúsculas, números y guiones bajos (por ejemplo confirmacion_turno).');
    if (!['UTILITY', 'MARKETING'].includes(body?.categoria)) throw error('Elegí la categoría.');
    if (!IDIOMAS_PLANTILLA.includes(body?.idioma)) throw error('Elegí el idioma.');
    const cuerpo = texto(body?.cuerpo, 1024, 'El texto');
    if (!cuerpo) throw error('Escribí el texto de la plantilla.');
    if (/\{\{/.test(cuerpo)) throw error('Esta versión crea plantillas sin variables: quitá los {{ }}.');
    const pie = texto(body?.pie, 60, 'El pie');
    const componentes = [{ type: 'BODY', text: cuerpo }, ...(pie ? [{ type: 'FOOTER', text: pie }] : [])];
    let r;
    try {
      r = await g().facebook(`${idMeta(c.cuenta_id, 'Cuenta de WhatsApp')}/message_templates`, { method: 'POST', token: c.token, json: { name: nombre, language: body.idioma, category: body.categoria, components: componentes } });
    } catch (e) {
      // El código 100 también cubre errores de campos: sólo traducir esta
      // denegación concreta de la cuenta, sin esconder otros errores de Meta.
      if (e.metaCode === 100 && /(?:does not have permission|no tiene permiso|not allowed).*(?:template|plantilla)/i.test(e.message)) {
        throw error('Meta no permite crear ni actualizar plantillas en esta cuenta de WhatsApp Business. Revisá el acceso y las restricciones de la cuenta en WhatsApp Manager. Este rechazo corresponde a las plantillas, no al inicio de sesión en Gesicom.', 403);
      }
      throw e;
    }
    return { id: String(r.id), estado: r.status || 'PENDING', categoria: r.category || body.categoria };
  }

  // Meta descarga los archivos desde una URL pública: se suben a R2 bajo un
  // prefijo de la marca y solo se aceptan para publicar URLs de ese prefijo.
  const prefijo = (account) => `marca-personal/meta/${account}/`;
  async function subirMedio(usuario, archivo) {
    const account = await marca(usuario);
    if (!archivo?.buffer) throw error('Elegí un archivo.');
    const tipo = Object.entries(MEDIOS).find(([, m]) => m.tipos.includes(archivo.mimetype));
    if (!tipo) throw error('Usá imágenes JPG o videos MP4/MOV.');
    const [clase, regla] = tipo;
    if (archivo.size > regla.max) throw error(clase === 'imagen' ? 'La imagen supera 8 MB.' : 'El video supera 90 MB.');
    const b = archivo.buffer;
    const valido = clase === 'imagen' ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff : b.slice(4, 8).toString('latin1') === 'ftyp';
    if (!valido) throw error('El contenido del archivo no coincide con su tipo.');
    const key = `${prefijo(account)}${new Date(ahora()).toISOString().slice(0, 7)}/${crypto.randomBytes(12).toString('hex')}.${clase === 'imagen' ? 'jpg' : regla.ext}`;
    const r = await almacenamiento().uploadObject({ key, body: b, contentType: archivo.mimetype, cacheControl: 'public, max-age=31536000, immutable', contentLength: archivo.size });
    return { url: r.url, tipo: clase };
  }

  function mediosDeMarca(account, medios) {
    const base = almacenamiento().publicUrl(prefijo(account));
    if (!Array.isArray(medios)) throw error('Agregá los archivos de la publicación.');
    return medios.map((m) => {
      const resto = typeof m?.url === 'string' && m.url.startsWith(base) ? m.url.slice(base.length) : '';
      const esperado = m?.tipo === 'imagen' ? /^\d{4}-\d{2}\/[0-9a-f]{24}\.jpg$/ : /^\d{4}-\d{2}\/[0-9a-f]{24}\.mp4$/;
      if (!['imagen', 'video'].includes(m?.tipo) || !esperado.test(resto)) {
        throw error('Subí los archivos desde esta pantalla antes de publicar.');
      }
      return { url: m.url, tipo: m.tipo };
    });
  }

  async function publicarInstagram(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'instagram');
    const formato = body?.formato;
    const caption = texto(body?.texto, 2200, 'El texto');
    const medios = mediosDeMarca(account, body?.medios);
    if (formato === 'imagen' && !(medios.length === 1 && medios[0].tipo === 'imagen')) throw error('Una publicación de imagen lleva 1 JPG.');
    else if (formato === 'carrusel' && !(medios.length >= 2 && medios.length <= 10 && medios.every((m) => m.tipo === 'imagen'))) throw error('Un carrusel lleva de 2 a 10 imágenes JPG.');
    else if (formato === 'reel' && !(medios.length === 1 && medios[0].tipo === 'video')) throw error('Un reel lleva 1 video MP4 o MOV.');
    else if (!['imagen', 'carrusel', 'reel'].includes(formato)) throw error('Formato inválido.');

    const pub = await db().crearPublicacion({ account, conexion: c.id, usuario, plataforma: 'instagram', formato, texto: caption, medios });
    try {
      const ig = c.external_id;
      let params;
      if (formato === 'carrusel') {
        const hijos = [];
        for (const m of medios) hijos.push((await g().facebook(`${ig}/media`, { method: 'POST', token: c.token, params: { image_url: m.url, is_carousel_item: true } })).id);
        params = { media_type: 'CAROUSEL', children: hijos.join(','), caption };
      } else if (formato === 'reel') {
        params = { media_type: 'REELS', video_url: medios[0].url, caption, share_to_feed: true };
      } else {
        params = { image_url: medios[0].url, caption };
      }
      const contenedor = await g().facebook(`${ig}/media`, { method: 'POST', token: c.token, params });
      await db().actualizarPublicacion(pub.id, { contenedor_id: String(contenedor.id) });
      return avanzar(usuario, pub.id);
    } catch (e) {
      await db().actualizarPublicacion(pub.id, { estado: 'error', error: e.message });
      throw e;
    }
  }

  // Instagram procesa el archivo en segundo plano. El navegador consulta este
  // estado cada pocos segundos; cuando el contenedor está listo, se publica.
  async function avanzar(usuario, publicacionId) {
    const account = await marca(usuario);
    const pub = await db().publicacion(account, Number(publicacionId));
    if (!pub) throw error('Publicación no encontrada.', 404);
    if (pub.estado !== 'procesando' || pub.plataforma !== 'instagram' || !pub.contenedor_id) return vistaPublicacion(pub);
    const c = await conexionLista(account, 'instagram');
    const st = await g().facebook(pub.contenedor_id, { token: c.token, params: { fields: 'status_code,status' } });
    if (['ERROR', 'EXPIRED'].includes(st.status_code)) {
      return vistaPublicacion(await db().actualizarPublicacion(pub.id, { estado: 'error', error: 'Instagram no pudo procesar el archivo. Revisá formato, tamaño y duración.' }));
    }
    if (st.status_code === 'PUBLISHED') {
      return vistaPublicacion(await db().actualizarPublicacion(pub.id, { estado: 'publicada', error: 'Instagram ya la publicó; revisá el enlace en tu perfil.' }));
    }
    if (st.status_code !== 'FINISHED') return vistaPublicacion(pub);
    let publicado;
    try {
      publicado = await g().facebook(`${c.external_id}/media_publish`, { method: 'POST', token: c.token, params: { creation_id: pub.contenedor_id } });
    } catch (e) {
      // Si la respuesta se perdió, la próxima consulta ve PUBLISHED y no se reenvía.
      if (e.status === 503) return vistaPublicacion(pub);
      return vistaPublicacion(await db().actualizarPublicacion(pub.id, { estado: 'error', error: e.message }));
    }
    let permalink = null;
    try { permalink = (await g().facebook(String(publicado.id), { token: c.token, params: { fields: 'permalink' } })).permalink || null; } catch { /* opcional */ }
    return vistaPublicacion(await db().actualizarPublicacion(pub.id, { estado: 'publicada', external_id: String(publicado.id), permalink, error: null }));
  }

  const vistaPublicacion = (p) => ({ id: p.id, plataforma: p.plataforma, formato: p.formato, estado: p.estado, external_id: p.external_id, permalink: p.permalink, error: p.error, created_at: p.created_at });

  async function publicarFacebook(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'facebook');
    const mensaje = texto(body?.texto, 5000, 'El texto');
    const medios = body?.medios?.length ? mediosDeMarca(account, body.medios) : [];
    let enlace;
    if (body?.enlace) {
      try { enlace = new URL(body.enlace); } catch { throw error('El enlace no es una URL válida.'); }
      if (enlace.protocol !== 'https:' || enlace.username || enlace.password) throw error('Usá un enlace https:// sin credenciales.');
    }
    if (medios.length > 1 || medios.some((m) => m.tipo !== 'imagen')) throw error('En Facebook podés publicar texto, un enlace o una imagen JPG.');
    if (!mensaje && !medios.length) throw error('Escribí el texto de la publicación.');
    const formato = medios.length ? 'imagen' : 'texto';
    const pub = await db().crearPublicacion({ account, conexion: c.id, usuario, plataforma: 'facebook', formato, texto: mensaje, medios });
    try {
      const r = medios.length
        ? await g().facebook(`${c.external_id}/photos`, { method: 'POST', token: c.token, params: { url: medios[0].url, message: mensaje || undefined, published: true } })
        : await g().facebook(`${c.external_id}/feed`, { method: 'POST', token: c.token, params: { message: mensaje, link: enlace?.href } });
      const externo = String(r.post_id || r.id);
      let permalink = null;
      try { permalink = (await g().facebook(externo, { token: c.token, params: { fields: 'permalink_url' } })).permalink_url || null; } catch { /* opcional */ }
      return vistaPublicacion(await db().actualizarPublicacion(pub.id, { estado: 'publicada', external_id: externo, permalink, error: null }));
    } catch (e) {
      await db().actualizarPublicacion(pub.id, { estado: 'error', error: e.status === 503 ? 'Sin confirmación de Meta: revisá tu Página antes de repetir.' : e.message });
      throw e;
    }
  }

  async function historial(usuario, body) {
    const account = await marca(usuario);
    const pagina = Math.max(0, Math.min(1000, Number(body?.pagina) || 0));
    const filas = await db().historial(account, 21, pagina * 20);
    return { items: filas.slice(0, 20).map(vistaPublicacion), hay_mas: filas.length > 20, pagina };
  }

  const paging = (r) => ({ siguiente: r.paging?.next ? r.paging?.cursors?.after || null : null });

  async function publicaciones(usuario, body) {
    const account = await marca(usuario);
    const plataforma = body?.plataforma === 'facebook' ? 'facebook' : 'instagram';
    const c = await conexionLista(account, plataforma);
    if (plataforma === 'instagram') {
      const r = await g().facebook(`${c.external_id}/media`, { token: c.token, params: { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count', limit: 12, after: cursor(body?.after) } });
      return { items: r.data || [], ...paging(r) };
    }
    const r = await g().facebook(`${c.external_id}/published_posts`, { token: c.token, params: { fields: 'id,message,created_time,permalink_url,full_picture,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)', limit: 12, after: cursor(body?.after) } });
    return {
      items: (r.data || []).map((p) => ({
        id: p.id, message: p.message || '', created_time: p.created_time, permalink: p.permalink_url, imagen: p.full_picture || null,
        reacciones: p.reactions?.summary?.total_count ?? null, comentarios: p.comments?.summary?.total_count ?? null, compartidos: p.shares?.count ?? 0,
      })),
      ...paging(r),
    };
  }

  async function comentarios(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'instagram');
    const r = await g().facebook(`${idMeta(body?.media_id, 'Publicación')}/comments`, { token: c.token, params: { fields: 'id,text,username,timestamp,hidden,like_count,replies{id,text,username,timestamp}', limit: 25, after: cursor(body?.after) } });
    return { items: r.data || [], ...paging(r) };
  }

  async function responderComentario(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'instagram');
    const mensaje = texto(body?.texto, 2200, 'La respuesta');
    if (!mensaje) throw error('Escribí la respuesta.');
    const r = await g().facebook(`${idMeta(body?.comment_id, 'Comentario')}/replies`, { method: 'POST', token: c.token, params: { message: mensaje } });
    return { id: String(r.id) };
  }

  async function ocultarComentario(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'instagram');
    await g().facebook(idMeta(body?.comment_id, 'Comentario'), { method: 'POST', token: c.token, params: { hide: body?.ocultar !== false } });
    return { oculto: body?.ocultar !== false };
  }

  // Los mensajes de Instagram se leen y envían por la Página vinculada
  // (/{page-id}/conversations y /{page-id}/messages), con su token.
  async function bandeja(account) {
    const c = await conexionLista(account, 'instagram');
    const pagina = await conexionLista(account, 'facebook');
    return { ...c, pagina: pagina.external_id };
  }

  async function conversaciones(usuario, body) {
    const account = await marca(usuario);
    const c = await bandeja(account);
    const r = await g().facebook(`${c.pagina}/conversations`, { token: c.token, params: { platform: 'instagram', fields: 'id,updated_time,participants', limit: 20, after: cursor(body?.after) } });
    return {
      items: (r.data || []).map((conv) => ({
        id: conv.id, updated_time: conv.updated_time,
        contacto: (conv.participants?.data || []).find((p) => p.username !== c.username && String(p.id) !== c.external_id) || null,
      })),
      ...paging(r),
    };
  }

  async function leerConversacion(c, conversacionId) {
    const id = String(conversacionId ?? '');
    if (!/^[A-Za-z0-9_\-=]{1,200}$/.test(id)) throw error('Conversación inválida.');
    const r = await g().facebook(id, { token: c.token, params: { fields: 'participants,messages.limit(30){id,message,from,to,created_time}' } });
    const contacto = (r.participants?.data || []).find((p) => p.username !== c.username && String(p.id) !== c.external_id) || null;
    const mensajes = (r.messages?.data || []).map((m) => ({
      id: m.id, texto: m.message || '', created_time: m.created_time,
      propio: m.from?.username === c.username || String(m.from?.id) === c.external_id,
    })).reverse();
    const ultimoEntrante = [...mensajes].reverse().find((m) => !m.propio);
    const abierta = Boolean(ultimoEntrante && ahora() - new Date(ultimoEntrante.created_time).getTime() < VENTANA_MENSAJES_MS);
    return { contacto, mensajes, ventana_abierta: abierta };
  }

  async function mensajes(usuario, body) {
    const account = await marca(usuario);
    const c = await bandeja(account);
    return leerConversacion(c, body?.conversacion_id);
  }

  // Instagram solo permite responder dentro de las 24 h posteriores al último
  // mensaje de la persona. Se comprueba con los mensajes reales, no con el navegador.
  async function enviarMensaje(usuario, body) {
    const account = await marca(usuario);
    const c = await bandeja(account);
    const contenido = texto(body?.texto, 1000, 'El mensaje');
    if (!contenido) throw error('Escribí el mensaje.');
    const conv = await leerConversacion(c, body?.conversacion_id);
    if (!conv.contacto?.id) throw error('No se encontró a la persona de esta conversación.', 404);
    if (!conv.ventana_abierta) throw error('Pasaron más de 24 horas desde el último mensaje de esta persona. Instagram no permite responder desde aplicaciones fuera de ese plazo.', 409);
    const r = await g().facebook(`${c.pagina}/messages`, { method: 'POST', token: c.token, json: { recipient: { id: String(conv.contacto.id) }, message: { text: contenido } } });
    if (!r.message_id) throw error('Instagram no confirmó el envío. Revisá la conversación antes de repetir.', 503);
    return { id: r.message_id };
  }

  const METRICAS_CUENTA = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'follows_and_unfollows'];
  async function metricas(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'instagram');
    const valida = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
    if (!valida(body?.desde) || !valida(body?.hasta) || body.desde > body.hasta) throw error('Elegí un período válido.');
    const since = Date.parse(body.desde + 'T00:00:00Z') / 1000, until = Date.parse(body.hasta + 'T23:59:59Z') / 1000;
    if (until - since > 30 * 86400) throw error('Instagram entrega métricas de hasta 30 días por consulta.');
    const valores = {}, errores = {};
    // Cada métrica se pide aparte: una no disponible queda en null, nunca en cero.
    await Promise.all(METRICAS_CUENTA.map(async (m) => {
      try {
        const r = await g().facebook(`${c.external_id}/insights`, { token: c.token, params: { metric: m, period: 'day', metric_type: 'total_value', since, until } });
        const v = r.data?.[0]?.total_value?.value;
        valores[m] = typeof v === 'number' ? v : null;
      } catch (e) { valores[m] = null; errores[m] = e.message; }
    }));
    const perfil = await g().facebook(c.external_id, { token: c.token, params: { fields: 'username,followers_count,follows_count,media_count' } });
    return { perfil, metricas: valores, errores, desde: body.desde, hasta: body.hasta };
  }

  async function metricasPublicacion(usuario, body) {
    const account = await marca(usuario);
    const c = await conexionLista(account, 'instagram');
    const media = idMeta(body?.media_id, 'Publicación');
    const valores = {};
    await Promise.all(['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions'].map(async (m) => {
      try {
        const r = await g().facebook(`${media}/insights`, { token: c.token, params: { metric: m } });
        const v = r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value;
        valores[m] = typeof v === 'number' ? v : null;
      } catch { valores[m] = null; }
    }));
    return { media_id: media, metricas: valores };
  }

  // Data Deletion de Meta: borra en el acto las conexiones de quien quitó la app.
  async function borrarPorMetaUser(metaUserId) {
    try {
      return await db().borrarPorMetaUser(String(metaUserId));
    } catch (e) {
      // Antes de la migración la tabla no existe: no hay nada de Marca Personal que borrar.
      if (e?.original?.code === '42P01' || e?.parent?.code === '42P01') return [];
      throw e;
    }
  }

  return {
    async contextoWhatsapp(usuario){const account=await marca(usuario);return {...await conexionLista(account,'whatsapp'),account};},
    estado, urlAutorizacion, completarFacebook, paginasDe, confirmarPagina, desconectar,
    completarWhatsapp, numerosWhatsapp, confirmarWhatsapp, enviarWhatsapp, plantillasWhatsapp, crearPlantilla,
    subirMedio, publicarInstagram, avanzar, publicarFacebook, historial, publicaciones,
    comentarios, responderComentario, ocultarComentario, conversaciones, mensajes, enviarMensaje,
    metricas, metricasPublicacion, borrarPorMetaUser,
  };
}

module.exports = { createService, SCOPES, SCOPES_WHATSAPP, ...createService() };
