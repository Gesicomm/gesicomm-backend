jest.mock('../models/TutorialSistema', () => ({ findAll: jest.fn(), upsert: jest.fn(), destroy: jest.fn() }));
const Modelo = require('../models/TutorialSistema');
const Service = require('../services/tutorialSistema.service');

beforeEach(() => jest.clearAllMocks());

test('lista los destinos de e-commerce y Mi negocio con los videos guardados', async () => {
  Modelo.findAll.mockResolvedValue([{ clave: 'ecommerce.inicio', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }]);
  const resultado = await Service.listar();
  expect(resultado.secciones).toEqual(expect.arrayContaining([
    expect.objectContaining({ clave: 'ecommerce.inicio', grupo: 'E-commerce' }),
    expect.objectContaining({ clave: 'mi-negocio.tienda', grupo: 'Mi negocio' }),
  ]));
  expect(resultado.videos['ecommerce.inicio']).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('ofrece un destino de video para cada modulo del menu del usuario', () => {
  const modulos = ['negocio', 'depositos', 'productos', 'clientes', 'ecommerce', 'publicidad', 'comercial', 'logistica', 'dashboard_operativo', 'dashboard_general', 'finanzas', 'importacion', 'afiliados', 'partner', 'academia', 'configuracion'];
  for (const modulo of modulos) {
    expect(Service.SECCIONES.some(seccion => seccion.clave === `modulo.${modulo}`)).toBe(true);
  }
});

test('normaliza YouTube y guarda solo destinos conocidos', async () => {
  const resultado = await Service.guardar('ecommerce.inicio', 'https://youtu.be/dQw4w9WgXcQ?t=20', 31);
  expect(resultado.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  expect(Modelo.upsert).toHaveBeenCalledWith(expect.objectContaining({ clave: 'ecommerce.inicio', actualizado_por: 31 }));
  await expect(Service.guardar('otro.inicio', resultado.url, 31)).rejects.toMatchObject({ status: 404 });
});

test.each(['javascript:alert(1)', 'http://youtu.be/dQw4w9WgXcQ', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtu.be/invalido'])('rechaza enlace inseguro o inválido: %s', async url => {
  await expect(Service.guardar('ecommerce.inicio', url, 31)).rejects.toMatchObject({ status: 400 });
  expect(Modelo.upsert).not.toHaveBeenCalled();
});

test('quitar un video no afecta otras secciones', async () => {
  await expect(Service.guardar('mi-negocio.contacto', '', 31)).resolves.toEqual({ clave: 'mi-negocio.contacto', url: null });
  expect(Modelo.destroy).toHaveBeenCalledWith({ where: { clave: 'mi-negocio.contacto' } });
});
