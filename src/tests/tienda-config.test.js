jest.mock('whois-json', () => jest.fn());

jest.mock('../models', () => ({
  Tienda: { findOne: jest.fn(), create: jest.fn() },
  Usuario: { findByPk: jest.fn(), update: jest.fn() },
  ProveedorDns: { findAll: jest.fn() },
  Suscripcion: { findOne: jest.fn() },
  Plan: {},
  Landing: { findOne: jest.fn(), update: jest.fn() },
}));

jest.mock('../utils/validarSubdominio', () => ({
  validarFormato: jest.fn(() => ({ valido: true, motivo: null })),
  disponible: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../utils/EncryptionService', () => ({
  encrypt: jest.fn(token => `ENC(${token})`),
}));

const { Tienda, Usuario, Suscripcion, Landing } = require('../models');
const { validarFormato, disponible } = require('../utils/validarSubdominio');
const EncryptionService = require('../utils/EncryptionService');
const TiendaService = require('../services/tienda.service');

function tiendaMock(extra = {}) {
  return {
    id: 12,
    usuario_id: 7,
    inquilino_id: 3,
    nombre: 'SomMix',
    subdominio: 'sommix',
    documento: '4123456',
    ruc: null,
    color_primario: '#10b981',
    color_secundario: '#059669',
    color_fondo: '#0a0a0a',
    meta_access_token: null,
    dominio_propio: null,
    save: jest.fn(),
    toJSON() {
      const { save, toJSON, ...data } = this;
      return { ...data };
    },
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Usuario.findByPk.mockResolvedValue({ plan: 'pago' });
  Usuario.update.mockResolvedValue([1]);
  Suscripcion.findOne.mockResolvedValue(null);
  Landing.update.mockResolvedValue([3]);
  validarFormato.mockReturnValue({ valido: true, motivo: null });
  disponible.mockResolvedValue(true);
});

describe('TiendaService.actualizar — configuración completa de Mi tienda', () => {
  test('persiste identidad, documentos, contacto, analítica, subdominio y sincroniza colores', async () => {
    const tienda = tiendaMock();
    Tienda.findOne.mockResolvedValue(tienda);

    const res = await TiendaService.actualizar(7, {
      nombre: 'SomMix Natural',
      subdominio: 'sommix-natural-py',
      documento: '5123456',
      ruc: '80123456-7',
      color_primario: '#155e63',
      color_secundario: '#d8a862',
      color_fondo: '#101a21',
      whatsapp: '595981234567',
      telefono: '021555555',
      nombre_contacto: 'Martin',
      canal_contacto: 'email',
      email: 'hola@sommix.com.py',
      instagram: 'sommixpy',
      facebook: 'sommixparaguay',
      ciudad_publica: 'Asuncion, Paraguay',
      direccion_publica: 'Av. Test 123',
      mensaje_contacto: 'Hola, quiero saber de {producto}',
      meta_pixel_id: '1234567890123456',
      meta_test_event_code: 'TEST98765',
      meta_access_token: 'EAAB-token-test',
      meta_capi_activo: true,
      google_analytics_id: 'G-ABC1234DEF',
      tiktok_pixel_id: 'TTPIXEL12345',
    });

    expect(disponible).toHaveBeenCalledWith('sommix-natural-py', 12);
    expect(tienda.save).toHaveBeenCalled();
    expect(Landing.update).toHaveBeenCalledWith({
      color_primario: '#155e63',
      color_texto: '#d8a862',
      color_fondo: '#101a21',
    }, { where: { tienda_id: 12 } });
    expect(EncryptionService.encrypt).toHaveBeenCalledWith('EAAB-token-test');

    expect(tienda).toMatchObject({
      nombre: 'SomMix Natural',
      subdominio: 'sommix-natural-py',
      documento: '5123456',
      ruc: '80123456-7',
      whatsapp: '595981234567',
      telefono: '021555555',
      email: 'hola@sommix.com.py',
      instagram: 'sommixpy',
      meta_pixel_id: '1234567890123456',
      meta_capi_activo: true,
      meta_access_token: 'ENC(EAAB-token-test)',
    });
    expect(res).toMatchObject({
      nombre: 'SomMix Natural',
      subdominio: 'sommix-natural-py',
      documento: '5123456',
      ruc: '80123456-7',
      meta_access_token_configurado: true,
    });
    expect(res).not.toHaveProperty('meta_access_token');
  });

  test('rechaza documentos, RUC y URLs inválidas antes de guardar', async () => {
    const tienda = tiendaMock();
    Tienda.findOne.mockResolvedValue(tienda);
    validarFormato.mockReturnValue({ valido: false, motivo: 'El subdominio no es válido.' });

    await expect(TiendaService.actualizar(7, {
      subdominio: 'no válido',
      documento: 'abc',
      ruc: 'ruc raro',
      whatsapp: '09 81',
      email: 'sin-arroba',
      color_primario: 'verde',
    })).rejects.toMatchObject({
      message: 'Validación fallida.',
      errores: expect.arrayContaining([
        'documento debe ser un número de cédula válido (solo dígitos, puntos o guiones).',
        'ruc debe ser un número válido (solo dígitos, puntos o guiones).',
        'whatsapp debe contener solo dígitos (código de país + número), entre 8 y 15 caracteres.',
        'email no tiene un formato válido.',
        'color_primario debe ser un color hexadecimal válido (#rrggbb).',
        'El subdominio no es válido.',
      ]),
    });
    expect(tienda.save).not.toHaveBeenCalled();
    expect(Landing.update).not.toHaveBeenCalled();
  });
});

describe('TiendaService.guardarDominioPropio', () => {
  test('normaliza la URL propia y devuelve registros DNS accionables', async () => {
    const tienda = tiendaMock();
    Tienda.findOne
      .mockResolvedValueOnce(tienda)
      .mockResolvedValueOnce(null);

    const res = await TiendaService.guardarDominioPropio(7, '  MiTienda.COM.PY  ');

    expect(tienda.dominio_propio).toBe('mitienda.com.py');
    expect(tienda.dominio_propio_verificado).toBe(false);
    expect(tienda.dominio_propio_habilitado).toBe(true);
    expect(tienda.save).toHaveBeenCalled();
    expect(res).toMatchObject({
      dominio: 'mitienda.com.py',
      estado: 'pendiente',
      verificado: false,
    });
    expect(res.registros.length).toBeGreaterThan(0);
    expect(res.registros[0]).toEqual(expect.objectContaining({ tipo: 'A', obligatorio: true }));
  });
});
