jest.mock('../models', () => ({
  sequelize: { query: jest.fn() },
  Usuario: { findByPk: jest.fn() },
  MensajeContacto: { findOne: jest.fn() },
  ProveedorServicio: { findOne: jest.fn() },
}));
jest.mock('../services/r2/r2.service', () => ({ R2Service: { uploadObject: jest.fn(), deleteObject: jest.fn() }, IMMUTABLE_CACHE_CONTROL: 'public' }));

const { sequelize, Usuario, MensajeContacto, ProveedorServicio } = require('../models');
const Portal = require('../services/proveedorPortal.service');
const { limpiarDetalle, normalizarVideo } = Portal;

const postulacion = { id: 20, revision_proveedor: 'aceptada', nombre: 'Ana Pérez', datos_proveedor: { categoria: 'editor_videos', foto_url: 'https://images.example/ana.webp', whatsapp: '+595981000000' } };
beforeEach(() => {
  jest.clearAllMocks();
  Usuario.findByPk.mockResolvedValue({ id: 7, nombre: 'Ana Pérez', correo_electronico: 'ana@example.com', email_verificado: true });
  sequelize.query.mockResolvedValue([{ '?column?': 1 }]);
  MensajeContacto.findOne.mockResolvedValue(postulacion);
  ProveedorServicio.findOne.mockResolvedValue({ id: 31, solicitud_id: 20, titulo: 'Edición de videos', resumen: 'Produzco videos breves para marcas y tiendas.', imagenes: [], update: jest.fn(async function (data) { Object.assign(this, data); }) });
});

test('solo el dueño aprobado puede abrir y editar un servicio', async () => {
  expect((await Portal.propio(7, 31)).id).toBe(31);
  expect(ProveedorServicio.findOne).toHaveBeenCalledWith({ where: { id: 31, solicitud_id: 20 } });
  ProveedorServicio.findOne.mockResolvedValue(null);
  await expect(Portal.propio(7, 99)).rejects.toMatchObject({ status: 404 });
  sequelize.query.mockResolvedValue([]);
  await expect(Portal.propio(7, 31)).rejects.toMatchObject({ status: 403 });
});

test('un usuario sin correo verificado no puede activar el rol', async () => {
  Usuario.findByPk.mockResolvedValue({ id: 7, correo_electronico: 'ana@example.com', email_verificado: false });
  await expect(Portal.activar(7)).rejects.toMatchObject({ status: 403 });
  expect(sequelize.query).not.toHaveBeenCalled();
});

test('acepta solamente enlaces seguros de YouTube y Vimeo', () => {
  expect(normalizarVideo('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  expect(normalizarVideo('https://vimeo.com/123456')).toBe('https://vimeo.com/123456');
  expect(normalizarVideo('javascript:alert(1)')).toBeNull();
  expect(normalizarVideo('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
});

test('limpia HTML e imágenes que no pertenecen al portafolio', () => {
  const safe = limpiarDetalle('<p><strong>Hola</strong><script>alert(1)</script><img src="https://evil.example/a.png"><img src="https://images.example/propia.webp"></p>', [{ url: 'https://images.example/propia.webp' }]);
  expect(safe).toContain('<strong>Hola</strong>');
  expect(safe).toContain('propia.webp');
  expect(safe).not.toContain('<script');
  expect(safe).not.toContain('evil.example');
});

test('una ficha pública exige servicio publicado y postulación aceptada', async () => {
  MensajeContacto.findOne.mockResolvedValue(null);
  await expect(Portal.publico(31)).rejects.toMatchObject({ status: 404 });
  expect(ProveedorServicio.findOne).toHaveBeenCalledWith({ where: { id: 31, estado: 'publicado' } });
});

test('la ficha pública entrega portafolio y contacto sin datos privados', async () => {
  const ficha = await Portal.publico(31);
  expect(ficha).toMatchObject({ id: 31, nombre: 'Ana Pérez', whatsapp: '+595981000000', oferta: 'Edición de videos' });
  expect(ficha).not.toHaveProperty('email');
  expect(ficha).not.toHaveProperty('documento');
});

test('rechaza videos de sitios ajenos al guardar', async () => {
  await expect(Portal.guardar(7, 31, { categoria: 'editor_videos', titulo: 'Videos de producto', resumen: 'Videos pensados para tiendas y marcas.', detalle_html: '<p>Texto</p>', beneficios: [], video_urls: ['https://evil.example/video'], imagenes: [], estado: 'publicado' })).rejects.toMatchObject({ status: 400 });
});
