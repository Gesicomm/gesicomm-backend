jest.mock('../models', () => ({ MensajeContacto: {
  create: jest.fn(), findOne: jest.fn(), findAndCountAll: jest.fn(), count: jest.fn(), update: jest.fn(),
}, ProveedorServicio: { findOrCreate: jest.fn(), findOne: jest.fn() } }));
jest.mock('../middleware/autenticacion', () => ({ verificarToken: (req, res, next) => {
  if (!req.headers['x-test-role']) return res.status(401).json({ message: 'Sin sesión' });
  req.usuario = { id: 8, rol: req.headers['x-test-role'] }; next();
} }));
jest.mock('../controllers/solicitudEliminacion.controller', () => ({ solicitar: jest.fn(), estado: jest.fn(), solicitarDesdePanel: jest.fn(), listar: jest.fn(), actualizarEstado: jest.fn() }));
jest.mock('../services/codigoPrueba.service', () => ({}));
jest.mock('../utils/logger', () => ({ auditoria: jest.fn(), logger: { error: jest.fn() } }));
jest.mock('../config/database', () => ({ query: jest.fn(), transaction: jest.fn(fn => fn({})) }));
jest.mock('../services/r2/r2.service', () => ({ R2Service: { uploadObject: jest.fn(), deleteObject: jest.fn() }, IMMUTABLE_CACHE_CONTROL: 'public, max-age=31536000, immutable' }));
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const { MensajeContacto, ProveedorServicio } = require('../models');
const sequelize = require('../config/database');
const { R2Service } = require('../services/r2/r2.service');
const { auditoria } = require('../utils/logger');
const app = express();
app.use(express.json());
app.use('/api/publico', require('../routes/publico'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
const endpoint = '/api/publico/solicitudes-proveedores';
const adminEndpoint = '/api/publico/admin/solicitudes-proveedores';
const datos = { nombre: 'Ana', apellido: 'Pérez', email: 'ANA@example.com', documento: '123456', whatsapp: '+595981123456', categoria: 'envios', oferta: 'Envíos para tiendas', descripcion: 'Realizo entregas para tiendas en Asunción y Central.' };
let imagen;
beforeAll(async () => { imagen = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#208451' } }).png().toBuffer(); });
const enviar = (campos = datos, conFoto = true) => {
  let req = request(app).post(endpoint);
  for (const [key, value] of Object.entries(campos)) req = req.field(key, value);
  return conFoto ? req.attach('foto', imagen, { filename: 'ana.png', contentType: 'image/png' }) : req;
};
let registro;
beforeEach(() => {
  jest.clearAllMocks();
  registro = { id: 41, area: 'comercial', nombre: 'Ana Pérez', email: 'ana@example.com', asunto: 'Gesicom · Postulación de proveedor · Envíos y logística', mensaje: 'Documento: 123456\nWhatsApp: +595981123456', datos_proveedor: { ...datos, especialidad: 'Envíos y logística', foto_url: 'https://images.example/ana.webp' }, revision_proveedor: 'pendiente' };
  R2Service.uploadObject.mockResolvedValue({ key: 'proveedores/perfiles/ana.webp', url: 'https://images.example/ana.webp' });
  sequelize.query.mockImplementation(async sql => sql.includes('COUNT(*)') ? [{ total: 1 }] : [{ id: 41, nombre: 'Ana Pérez', categoria: 'envios', titulo: datos.oferta, resumen: datos.descripcion, imagenes: [], datos_proveedor: registro.datos_proveedor }]);
  ProveedorServicio.findOrCreate.mockResolvedValue([{ id: 41 }, true]);
  MensajeContacto.create.mockImplementation(async d => ({ ...d, id: 41, created_at: new Date() }));
  MensajeContacto.findOne.mockImplementation(async ({ where }) => where.id === registro.id ? { ...registro } : null);
  MensajeContacto.findAndCountAll.mockImplementation(async () => ({ rows: [registro], count: 1 }));
  MensajeContacto.count.mockResolvedValue(1);
  MensajeContacto.update.mockImplementation(async d => {
    if (registro.revision_proveedor !== 'pendiente') return [0, []];
    Object.assign(registro, d); return [1, [{ ...registro }]];
  });
});

test('el formulario guarda una postulación pendiente y la bandeja conserva las anteriores', async () => {
  const res = await enviar({ ...datos, revision_proveedor: 'aceptada', revisado_por: '1' });
  expect(res.status).toBe(201);
  expect(res.body.mensaje.id).toBe(41);
  expect(MensajeContacto.create).toHaveBeenCalledWith(expect.objectContaining({ revision_proveedor: 'pendiente', email: 'ana@example.com', datos_proveedor: expect.objectContaining({ categoria: 'envios' }) }));
  expect(MensajeContacto.create.mock.calls[0][0]).not.toHaveProperty('revisado_por');
  expect(res.body.mensaje).not.toHaveProperty('datos_proveedor');
  const list = await request(app).get(adminEndpoint).set('x-test-role', 'administrador');
  expect(list.status).toBe(200);
  expect(list.headers['cache-control']).toBe('no-store');
  expect(list.body.solicitudes[0]).toMatchObject({ id: 41, estado: 'pendiente', datos: { documento: '123456', whatsapp: '+595981123456', especialidad: 'Envíos y logística' } });
});
test.each([{ categoria: 'admin' }, { documento: '' }, { whatsapp: 'abcdef' }, { nombre: 'x'.repeat(71) }, { descripcion: 'Corta' }, { oferta: '' }])('rechaza campos inválidos: %j', async cambio => {
  expect((await enviar({ ...datos, ...cambio })).status).toBe(400);
  expect(MensajeContacto.create).not.toHaveBeenCalled();
});
test('exige foto y no guarda una solicitud incompleta', async () => {
  expect((await enviar(datos, false)).status).toBe(400);
  expect(MensajeContacto.create).not.toHaveBeenCalled();
});
test('el honeypot no guarda postulaciones', async () => {
  expect((await enviar({ ...datos, sitio_web: 'bot' })).status).toBe(201);
  expect(MensajeContacto.create).not.toHaveBeenCalled();
});
test.each([undefined, 'usuario', 'proveedor'])('protege lectura y revisión frente al rol %s', async rol => {
  for (const method of ['get', 'patch']) {
    const req = request(app)[method](adminEndpoint + (method === 'patch' ? '/41' : ''));
    if (rol) req.set('x-test-role', rol);
    const res = await req.send({ estado: 'aceptada' });
    expect(res.status).toBe(rol ? 403 : 401);
  }
  expect(MensajeContacto.findAndCountAll).not.toHaveBeenCalled(); expect(MensajeContacto.update).not.toHaveBeenCalled();
});
test('aceptar persiste decisión, fecha y administrador sin alterar el mensaje', async () => {
  const texto = registro.mensaje;
  const res = await request(app).patch(adminEndpoint + '/41').set('x-test-role', 'administrador').send({ estado: 'aceptada', nota: ' Verificado ' });
  expect(res.status).toBe(200);
  expect(res.body.solicitud).toMatchObject({ estado: 'aceptada', nota_revision: 'Verificado', revisado_por: 8, mensaje: texto });
  expect(res.body.solicitud.revisado_en).toBeTruthy();
  expect(ProveedorServicio.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ where: { solicitud_id: 41 }, defaults: expect.objectContaining({ estado: 'publicado' }) }));
  expect(auditoria).toHaveBeenCalledWith('PROVEEDOR_SOLICITUD_REVISADA', expect.objectContaining({ id: 41, usuarioId: 8 }));
});
test('no publica una postulación anterior sin perfil completo', async () => {
  delete registro.datos_proveedor.foto_url;
  const res = await request(app).patch(adminEndpoint + '/41').set('x-test-role', 'administrador').send({ estado: 'aceptada' });
  expect(res.status).toBe(400);
  expect(MensajeContacto.update).not.toHaveBeenCalled();
});
test('el catálogo entrega solo datos públicos del perfil aprobado', async () => {
  const res = await request(app).get('/api/publico/servicios?categoria=envios&busqueda=tiendas');
  expect(res.status).toBe(200);
  expect(res.body.servicios[0]).toMatchObject({ nombre: 'Ana Pérez', oferta: 'Envíos para tiendas', foto_url: 'https://images.example/ana.webp' });
  expect(res.body.servicios[0]).not.toHaveProperty('documento');
  expect(res.body.servicios[0]).not.toHaveProperty('email');
  expect(sequelize.query.mock.calls[0][0]).toContain("revision_proveedor = 'aceptada'");
});
test('rechazar requiere motivo y conserva la decisión en la bandeja', async () => {
  const send = nota => request(app).patch(adminEndpoint + '/41').set('x-test-role', 'administrador').send({ estado: 'rechazada', nota });
  expect((await send(' ')).status).toBe(400);
  expect(MensajeContacto.update).not.toHaveBeenCalled();
  expect((await send('Fuera de cobertura')).body.solicitud.estado).toBe('rechazada');
  const list = await request(app).get(adminEndpoint + '?estado=rechazada').set('x-test-role', 'administrador');
  expect(list.body.solicitudes[0].nota_revision).toBe('Fuera de cobertura');
  expect(MensajeContacto.findAndCountAll.mock.calls[0][0].where.revision_proveedor).toBe('rechazada');
});
test('dos revisiones simultáneas no se sobrescriben', async () => {
  const results = await Promise.all(['aceptada', 'rechazada'].map(estado => request(app).patch(adminEndpoint + '/41').set('x-test-role', 'administrador').send({ estado, nota: 'Revisado' })));
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await request(app).patch(adminEndpoint + '/41').set('x-test-role', 'administrador').send({ estado: 'aceptada' })).status).toBe(409);
});
test('rechaza filtros, ids y solicitudes que no sean de proveedores', async () => {
  expect((await request(app).get(adminEndpoint + '?estado=otro').set('x-test-role', 'administrador')).status).toBe(400);
  expect((await request(app).patch(adminEndpoint + '/abc').set('x-test-role', 'administrador').send({ estado: 'aceptada' })).status).toBe(400);
  MensajeContacto.findOne.mockResolvedValue(null);
  expect((await request(app).patch(adminEndpoint + '/41').set('x-test-role', 'administrador').send({ estado: 'aceptada' })).status).toBe(404);
  expect(MensajeContacto.update).not.toHaveBeenCalled();
});
