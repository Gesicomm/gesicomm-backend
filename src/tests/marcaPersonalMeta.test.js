process.env.INSTAGRAM_APP_ID = 'ig-app';
process.env.INSTAGRAM_APP_SECRET = 'ig-secreto';
process.env.FACEBOOK_APP_ID = 'fb-app';
process.env.FACEBOOK_APP_SECRET = 'fb-secreto';

const { createService } = require('../services/marcaPersonalMeta.service');
const EncryptionService = require('../utils/EncryptionService');

/**
 * Instagram y Facebook de Marca Personal. Unitario: base, R2 y Graph API
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
      const fila = { id: i >= 0 ? filas[i].id : seq++, account_id: c.account, usuario_id: c.usuario, plataforma: c.plataforma, external_id: c.external,
        meta_user_id: c.metaUser, nombre: c.nombre, username: c.username, access_token: c.token, token_expira: c.expira, permisos: c.permisos, updated_at: new Date(AHORA) };
      if (i >= 0) filas[i] = fila; else filas.push(fila);
      return { id: fila.id };
    },
    actualizarToken: async () => {},
    borrarConexion: async (account, id) => { const i = filas.findIndex((c) => c.account_id === account && c.id === id); return i < 0 ? null : filas.splice(i, 1)[0]; },
    borrarPorMetaUser: async (m, p) => filas.filter((c) => c.meta_user_id === m && c.plataforma === p),
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

function conInstagram(store, account = 'marca-1') {
  store.filas.push({ id: 50, account_id: account, plataforma: 'instagram', external_id: '1789', username: 'mimarca',
    access_token: EncryptionService.encrypt('tok-ig'), token_expira: new Date(AHORA + 50 * 86400000), updated_at: new Date(AHORA) });
}

describe('Marca Personal · Instagram y Facebook', () => {
  test('la marca sale del vínculo del usuario, nunca del navegador', async () => {
    const store = memoria(); conInstagram(store, 'marca-otra');
    const svc = createService({ store, graph: grafo(() => ({})), r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    await expect(svc.publicarInstagram(7, { formato: 'imagen', medios: [medio('marca-otra')], account_id: 'marca-otra' }))
      .rejects.toThrow('Conectá tu cuenta de Instagram primero.');
  });

  test('conectar Instagram guarda el token cifrado y el ID para la eliminación de datos', async () => {
    const store = memoria();
    const g = grafo((p, ruta) => {
      if (ruta.includes('api.instagram.com/oauth')) return { data: [{ access_token: 'corto', user_id: '555', permissions: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_manage_insights' }] };
      if (ruta.includes('graph.instagram.com/access_token')) return { access_token: 'largo', expires_in: 5184000 };
      if (ruta === 'me') return { user_id: '1789', username: 'mimarca', name: 'Mi Marca' };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    const r = await svc.completarInstagram(7, 'code');
    expect(r).toEqual({ username: 'mimarca', permisos_faltantes: [] });
    const [c] = store.filas;
    expect(c).toMatchObject({ account_id: 'marca-1', plataforma: 'instagram', external_id: '1789', meta_user_id: '555' });
    expect(c.access_token).not.toContain('largo');
    expect(EncryptionService.decrypt(c.access_token)).toBe('largo');
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
    await svc.confirmarPagina(7, r.pendiente, '2');
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
    expect(g.llamadas.find((l) => l.ruta === '1789/media').token).toBe('tok-ig');
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
      if (ruta === '1789/messages') return { message_id: 'mid.1', recibido: op.json };
      return {};
    });
    const svc = createService({ store, graph: g, r2, cuentaDe: async () => 'marca-1', ahora: () => AHORA });
    expect(await svc.enviarMensaje(7, { conversacion_id: 'conv1', texto: 'Hola!' })).toEqual({ id: 'mid.1' });
    expect(g.llamadas.find((l) => l.ruta === '1789/messages').json).toEqual({ recipient: { id: '4321' }, message: { text: 'Hola!' } });
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
});
