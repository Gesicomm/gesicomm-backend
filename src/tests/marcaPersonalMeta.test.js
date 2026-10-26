process.env.FACEBOOK_APP_ID = 'fb-app';
process.env.FACEBOOK_APP_SECRET = 'fb-secreto';

const { createService } = require('../services/marcaPersonalMeta.service');
const EncryptionService = require('../utils/EncryptionService');

/**
 * Instagram y Facebook de Marca Personal, con un solo login de Facebook: el
 * Instagram es el vinculado a la Página. Unitario: base, R2 y Graph API
 * simulados en memoria; no toca la base real ni Meta.
 */
const BASE = 'https://cdn.test/';
const AHORA = Date.parse('2026-10-25T12:00:00Z');

function memoria() {
  const filas = [], pubs = [];
  let seq = 1;
  return {
    filas, pubs,
    conexiones: async (account) => filas.filter((c) => c.account_id === account),
    conexion: async (account, plataforma) => filas.find((c) => c.account_id === account && c.plataforma === plataforma) || null,
    async guardarConexion(c) {
      const otra = filas.find((x) => x.plataforma === c.plataforma && x.external_id === c.external && x.account_id !== c.account);
      if (otra) throw Object.assign(new Error('dup'), { status: 409 });
      const i = filas.findIndex((x) => x.account_id === c.account && x.plataforma === c.plataforma);
      const fila = { id: i >= 0 ? filas[i].id : seq++, account_id: c.account, usuario_id: c.usuario, plataforma: c.plataforma, external_id: c.external, cuenta_id: c.cuenta ?? null,
        meta_user_id: c.metaUser, nombre: c.nombre, username: c.username, access_token: c.token, token_expira: c.expira, permisos: c.permisos, updated_at: new Date(AHORA) };
      if (i >= 0) filas[i] = fila; else filas.push(fila);
      return { id: fila.id };
    },
    borrarConexion: async (account, id) => { const i = filas.findIndex((c) => c.account_id === account && c.id === id); return i < 0 ? null : filas.splice(i, 1)[0]; },
    borrarPlataforma: async (account, plataforma) => { for (let i = filas.length - 1; i >= 0; i--) if (filas[i].account_id === account && filas[i].plataforma === plataforma) filas.splice(i, 1); },
    borrarPorMetaUser: async (m) => filas.filter((c) => c.meta_user_id === m),
    async crearPublicacion(p) { const f = { id: seq++, account_id: p.account, plataforma: p.plataforma, formato: p.formato, estado: 'procesando', medios: p.medios }; pubs.push(f); return f; },
    async actualizarPublicacion(id, cambios) { const f = pubs.find((x) => x.id === id); Object.assign(f, cambios); return f; },
    publicacion: async (account, id) => pubs.find((x) => x.account_id === account && x.id === id) || null,
    historial: async (account) => pubs.filter((x) => x.account_id === account),
  };
}

function grafo(respuestas) {
  const llamadas = [];
  const responder = (plataforma) => async (ruta, op = {}) => {
    llamadas.push({ plataforma, ruta, ...op });
    const r = respuestas(plataforma, ruta, op);
    if (r instanceof Error) throw r;
    return r;
  };
  return { llamadas, instagram: responder('instagram'), facebook: responder('facebook'), llamar: responder('url') };
}

const r2 = { publicUrl: (k) => BASE + k, uploadObject: jest.fn(async ({ key }) => ({ url: BASE + key })) };
const medio = (account, tipo = 'imagen') => ({ tipo, url: `${BASE}marca-personal/meta/${account}/2026-10/${'a'.repeat(24)}.${tipo === 'imagen' ? 'jpg' : 'mp4'}` });

// Página 300 con su Instagram 1789; los dos usan el token de la Página.
function conInstagram(store, account = 'marca-1') {
  const token = EncryptionService.encrypt('tok-pagina');
  store.filas.push({ id: 49, account_id: account, plataforma: 'facebook', external_id: '300', nombre: 'Mi Marca', access_token: token, updated_at: new Date(AHORA) });
  store.filas.push({ id: 50, account_id: account, plataforma: 'instagram', external_id: '1789', username: 'mimarca', access_token: token, updated_at: new Date(AHORA) });
}

describe('Marca Personal · Instagram y Facebook', () => {
  test('la marca sale del vínculo del usuario, nunca del navegador', async () => {
    const store = memoria(); conInstagram(store, 'marca-otra');
    const svc = createService({ store, graph: grafo(() => ({})), r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    await expect(svc.publicarInstagram(7, { formato: 'imagen', medios: [medio('marca-otra')], account_id: 'marca-otra' }))
      .rejects.toThrow('no tiene una cuenta profesional de Instagram vinculada');
  });

  test('un solo login de Facebook conecta la Página y su Instagram, con el token de Página cifrado', async () => {
    const store = memoria();
    const g = grafo((p, ruta) => {
      if (ruta === 'oauth/access_token') return { access_token: 'usuario' };
      if (ruta === 'me') return { id: '900' };
      if (ruta === 'me/accounts') return { data: [{ id: '300', name: 'Mi Marca', tasks: ['CREATE_CONTENT'], instagram_business_account: { id: '1789', username: 'mimarca' } }] };
      if (ruta === '300') return { id: '300', name: 'Mi Marca', access_token: 'token-pagina', instagram_business_account: { id: '1789', username: 'mimarca' } };
      if (ruta === 'me/permissions') return { data: ['pages_show_list', 'instagram_basic'].map((permission) => ({ permission, status: 'granted' })) };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    const r = await svc.completarFacebook(7, 'code');
    expect(r).toMatchObject({ conectada: 'Mi Marca', instagram: 'mimarca' });
    expect(r.permisos_faltantes).toEqual(['pages_read_engagement', 'pages_manage_posts']);
    expect(store.filas.map((c) => [c.plataforma, c.external_id, c.meta_user_id])).toEqual([['facebook', '300', '900'], ['instagram', '1789', '900']]);
    for (const c of store.filas) {
      expect(c.access_token).not.toContain('token-pagina');
      expect(EncryptionService.decrypt(c.access_token)).toBe('token-pagina');
    }
    expect(g.llamadas.every((l) => l.plataforma === 'facebook')).toBe(true);
    // La eliminación de datos borra Página e Instagram del mismo usuario de Meta.
    expect(await svc.borrarPorMetaUser('900')).toHaveLength(2);
  });

  test('desconectar la Página quita también su Instagram', async () => {
    const store = memoria(); conInstagram(store);
    const svc = createService({ store, graph: grafo(() => ({})), r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    await svc.desconectar(7, 49);
    expect(store.filas).toHaveLength(0);
  });

  test('Facebook con varias Páginas espera la elección y guarda el token de Página que da Meta', async () => {
    const store = memoria();
    const g = grafo((p, ruta) => {
      if (ruta === 'oauth/access_token') return { access_token: 'usuario' };
      if (ruta === 'me') return { id: '900' };
      if (ruta === 'me/accounts') return { data: [{ id: '1', name: 'A', tasks: ['CREATE_CONTENT'] }, { id: '2', name: 'B', tasks: [] }] };
      if (ruta === '2') return { id: '2', name: 'B', access_token: 'token-pagina' };
      if (ruta === 'me/permissions') return { data: [{ permission: 'pages_manage_posts', status: 'granted' }, { permission: 'x', status: 'declined' }] };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    const r = await svc.completarFacebook(7, 'code');
    expect(r.pendiente).toEqual({ token: 'usuario', metaUser: '900' });
    expect(store.filas).toHaveLength(0);
    const conf = await svc.confirmarPagina(7, r.pendiente, '2');
    expect(conf.instagram).toBeNull();
    expect(store.filas).toHaveLength(1);
    expect(store.filas[0]).toMatchObject({ external_id: '2', meta_user_id: '900', permisos: ['pages_manage_posts'] });
    expect(EncryptionService.decrypt(store.filas[0].access_token)).toBe('token-pagina');
  });

  test('publica una imagen: contenedor, publicación y enlace', async () => {
    const store = memoria(); conInstagram(store);
    const g = grafo((p, ruta) => {
      if (ruta === '1789/media') return { id: 'cont-1' };
      if (ruta === 'cont-1') return { status_code: 'FINISHED' };
      if (ruta === '1789/media_publish') return { id: '777' };
      if (ruta === '777') return { permalink: 'https://instagram.com/p/x' };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    const r = await svc.publicarInstagram(7, { formato: 'imagen', texto: 'Hola', medios: [medio('marca-1')] });
    expect(r).toMatchObject({ estado: 'publicada', external_id: '777', permalink: 'https://instagram.com/p/x' });
    expect(g.llamadas.find((l) => l.ruta === '1789/media').token).toBe('tok-pagina');
  });

  test('un reel queda procesando hasta que Instagram termina, y no se publica dos veces', async () => {
    const store = memoria(); conInstagram(store);
    let estado = 'IN_PROGRESS';
    const g = grafo((p, ruta) => {
      if (ruta === '1789/media') return { id: 'cont-2' };
      if (ruta === 'cont-2') return { status_code: estado };
      if (ruta === '1789/media_publish') return { id: '888' };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    const r = await svc.publicarInstagram(7, { formato: 'reel', medios: [medio('marca-1', 'video')] });
    expect(r.estado).toBe('procesando');
    estado = 'FINISHED';
    expect((await svc.avanzar(7, r.id)).estado).toBe('publicada');
    expect((await svc.avanzar(7, r.id)).estado).toBe('publicada');
    expect(g.llamadas.filter((l) => l.ruta === '1789/media_publish')).toHaveLength(1);
  });

  test('rechaza archivos que no son de la marca o con rutas manipuladas', async () => {
    const store = memoria(); conInstagram(store);
    const svc = createService({ store, graph: grafo(() => ({})), r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    for (const url of [`${BASE}marca-personal/meta/marca-2/2026-10/${'a'.repeat(24)}.jpg`, `${BASE}marca-personal/meta/marca-1/../marca-2/x.jpg`, 'https://otro.test/x.jpg']) {
      await expect(svc.publicarInstagram(7, { formato: 'imagen', medios: [{ tipo: 'imagen', url }] })).rejects.toThrow('Subí los archivos desde esta pantalla');
    }
    expect(store.pubs).toHaveLength(0);
  });

  test('sube solo JPG o MP4 reales al prefijo de la marca', async () => {
    const svc = createService({ store: memoria(), graph: grafo(() => ({})), r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const r = await svc.subirMedio(7, { buffer: jpg, mimetype: 'image/jpeg', size: jpg.length });
    expect(r.url).toMatch(/^https:\/\/cdn\.test\/marca-personal\/meta\/marca-1\/2026-10\/[0-9a-f]{24}\.jpg$/);
    await expect(svc.subirMedio(7, { buffer: Buffer.from('<svg>'), mimetype: 'image/jpeg', size: 5 })).rejects.toThrow('no coincide');
    await expect(svc.subirMedio(7, { buffer: jpg, mimetype: 'image/png', size: 6 })).rejects.toThrow('JPG');
  });

  test('mensajes: responde dentro de 24 h y bloquea fuera de plazo', async () => {
    const store = memoria(); conInstagram(store);
    let ultimo = new Date(AHORA - 3600000).toISOString();
    const g = grafo((p, ruta, op) => {
      if (ruta === 'conv1') return { participants: { data: [{ username: 'mimarca', id: '1789' }, { username: 'cliente', id: '4321' }] },
        messages: { data: [{ id: 'm2', message: 'Precio?', from: { username: 'cliente', id: '4321' }, created_time: ultimo }] } };
      if (ruta === '300/messages') return { recipient_id: '4321', message_id: 'mid.1' };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    expect(await svc.enviarMensaje(7, { conversacion_id: 'conv1', texto: 'Hola!' })).toEqual({ id: 'mid.1' });
    expect(g.llamadas.find((l) => l.ruta === '300/messages').json).toEqual({ recipient: { id: '4321' }, message: { text: 'Hola!' } });
    ultimo = new Date(AHORA - 25 * 3600000).toISOString();
    await expect(svc.enviarMensaje(7, { conversacion_id: 'conv1', texto: 'Hola' })).rejects.toThrow('24 horas');
  });

  test('una métrica no disponible queda en null, nunca en cero', async () => {
    const store = memoria(); conInstagram(store);
    const g = grafo((p, ruta, op) => {
      if (ruta === '1789/insights') return op.params.metric === 'views' ? new Error('no soportada') : { data: [{ total_value: { value: 10 } }] };
      if (ruta === '1789') return { username: 'mimarca', followers_count: 3 };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    const r = await svc.metricas(7, { desde: '2026-10-01', hasta: '2026-10-20' });
    expect(r.metricas.reach).toBe(10);
    expect(r.metricas.views).toBeNull();
    await expect(svc.metricas(7, { desde: '2026-08-01', hasta: '2026-10-20' })).rejects.toThrow('30 días');
  });

  describe('WhatsApp', () => {
    // Dos cuentas autorizadas (permisos granulares), una con dos números.
    const respuestasWa = (extra = () => undefined) => (p, ruta, op) => {
      const e = extra(ruta, op);
      if (e !== undefined) return e;
      if (ruta === 'oauth/access_token') return { access_token: 'usuario-wa', expires_in: 5184000 };
      if (ruta === 'me') return { id: '900' };
      if (ruta === 'debug_token') return { data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['111', '222'] }, { scope: 'whatsapp_business_messaging', target_ids: ['111'] }] } };
      if (ruta === '111') return { id: '111', name: 'Mi Marca WA' };
      if (ruta === '222') return { id: '222', name: 'Otra cuenta' };
      if (ruta === '111/phone_numbers') return { data: [{ id: '5001', display_phone_number: '+595 981 000001', verified_name: 'Mi Marca' }] };
      if (ruta === '222/phone_numbers') return { data: [{ id: '5002', display_phone_number: '+1 555 000 0002', verified_name: 'Test Number' }] };
      if (ruta === 'me/permissions') return { data: ['whatsapp_business_management', 'whatsapp_business_messaging'].map((permission) => ({ permission, status: 'granted' })) };
      return {};
    };
    const conWhatsapp = (store) => store.filas.push({ id: 70, account_id: 'marca-1', plataforma: 'whatsapp', external_id: '5001', cuenta_id: '111',
      username: '+595 981 000001', access_token: EncryptionService.encrypt('tok-wa'), token_expira: new Date(AHORA + 30 * 86400000), updated_at: new Date(AHORA) });

    test('con varios números espera la elección y solo acepta números autorizados', async () => {
      const store = memoria();
      const g = grafo(respuestasWa());
      const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
      const r = await svc.completarWhatsapp(7, 'code');
      expect(r.pendiente).toMatchObject({ token: 'usuario-wa', metaUser: '900' });
      expect((await svc.numerosWhatsapp(r.pendiente)).map((n) => n.id)).toEqual(['5001', '5002']);
      await expect(svc.confirmarWhatsapp(7, r.pendiente, '9999')).rejects.toThrow('no pertenece');
      const ok = await svc.confirmarWhatsapp(7, r.pendiente, '5001');
      expect(ok).toMatchObject({ conectado: '+595 981 000001', permisos_faltantes: [] });
      expect(store.filas[0]).toMatchObject({ plataforma: 'whatsapp', external_id: '5001', cuenta_id: '111', meta_user_id: '900' });
      expect(EncryptionService.decrypt(store.filas[0].access_token)).toBe('usuario-wa');
      // El token de la app para debug_token nunca sale del servidor ni se guarda.
      expect(g.llamadas.find((l) => l.ruta === 'debug_token').token).toBe('fb-app|fb-secreto');
    });

    test('sin cuentas detalladas en el token, las busca en los portafolios', async () => {
      const store = memoria();
      const g = grafo(respuestasWa((ruta) => ({
        debug_token: { data: { granular_scopes: [{ scope: 'whatsapp_business_management' }] } },
        'me/businesses': { data: [{ id: '77' }] },
        '77/owned_whatsapp_business_accounts': { data: [{ id: '111' }] },
        '77/client_whatsapp_business_accounts': { data: [] },
      })[ruta]));
      const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
      const r = await svc.completarWhatsapp(7, 'code');
      expect(r).toMatchObject({ conectado: '+595 981 000001' });
      expect(store.filas[0]).toMatchObject({ external_id: '5001', cuenta_id: '111' });
    });

    test('envía la plantilla hello_world y texto con el número conectado', async () => {
      const store = memoria(); conWhatsapp(store);
      const g = grafo(respuestasWa((ruta) => (ruta === '5001/messages' ? { contacts: [{ wa_id: '595981123456' }], messages: [{ id: 'wamid.1' }] } : undefined)));
      const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
      expect(await svc.enviarWhatsapp(7, { para: '+595 981 123-456', tipo: 'plantilla', plantilla: 'hello_world', idioma: 'en_US' }))
        .toMatchObject({ id: 'wamid.1', para: '595981123456' });
      expect(g.llamadas.find((l) => l.ruta === '5001/messages').json).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '595981123456', type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });
      await svc.enviarWhatsapp(7, { para: '595981123456', texto: 'Hola desde Gesicom' });
      expect(g.llamadas.filter((l) => l.ruta === '5001/messages')[1].json).toMatchObject({ type: 'text', text: { body: 'Hola desde Gesicom' } });
      await expect(svc.enviarWhatsapp(7, { para: '123', texto: 'x' })).rejects.toThrow('código de país');
    });

    test('fuera de las 24 h explica que solo se puede enviar una plantilla', async () => {
      const store = memoria(); conWhatsapp(store);
      const fuera = Object.assign(new Error('Re-engagement message'), { status: 400, metaCode: 131047 });
      const svc = createService({ store, graph: grafo(respuestasWa((ruta) => (ruta === '5001/messages' ? fuera : undefined))), r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
      await expect(svc.enviarWhatsapp(7, { para: '595981123456', texto: 'Hola' })).rejects.toThrow('plantilla aprobada');
    });

    test('lista y crea plantillas en la cuenta del número conectado', async () => {
      const store = memoria(); conWhatsapp(store);
      const g = grafo(respuestasWa((ruta, op) => {
        if (ruta === '111/message_templates' && op.method === 'POST') return { id: '777', status: 'PENDING', category: 'UTILITY' };
        if (ruta === '111/message_templates') return { data: [{ id: '1', name: 'hello_world', status: 'APPROVED', category: 'UTILITY', language: 'en_US', components: [{ type: 'BODY', text: 'Hello World' }] }] };
        return undefined;
      }));
      const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
      expect((await svc.plantillasWhatsapp(7, {})).items[0]).toMatchObject({ nombre: 'hello_world', estado: 'APPROVED', cuerpo: 'Hello World' });
      const r = await svc.crearPlantilla(7, { nombre: 'confirmacion_turno', categoria: 'UTILITY', idioma: 'es', cuerpo: 'Tu turno quedó confirmado.', pie: 'Gesicom' });
      expect(r).toEqual({ id: '777', estado: 'PENDING', categoria: 'UTILITY' });
      expect(g.llamadas.find((l) => l.method === 'POST').json).toEqual({ name: 'confirmacion_turno', language: 'es', category: 'UTILITY', components: [{ type: 'BODY', text: 'Tu turno quedó confirmado.' }, { type: 'FOOTER', text: 'Gesicom' }] });
      await expect(svc.crearPlantilla(7, { nombre: 'Con Mayúsculas', categoria: 'UTILITY', idioma: 'es', cuerpo: 'x' })).rejects.toThrow('minúsculas');
      await expect(svc.crearPlantilla(7, { nombre: 'con_variable', categoria: 'UTILITY', idioma: 'es', cuerpo: 'Hola {{1}}' })).rejects.toThrow('sin variables');
    });

    test('un acceso vencido pide reconectar', async () => {
      const store = memoria(); conWhatsapp(store);
      store.filas[0].token_expira = new Date(AHORA - 1000);
      const svc = createService({ store, graph: grafo(respuestasWa()), r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
      await expect(svc.enviarWhatsapp(7, { para: '595981123456', texto: 'Hola' })).rejects.toThrow('venció');
    });
  });
});
