const { Op } = require('sequelize');

jest.mock('../models', () => ({
  Landing: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    destroy: jest.fn(),
    update: jest.fn(),
  },
  LandingItem: {},
  Faq: {},
  LandingBeneficio: {},
  LandingTemplate: {},
  Testimonio: {
    findAll: jest.fn(),
  },
  Producto: {},
}));

jest.mock('../services/landing.service', () => ({
  generarSlugUnico: jest.fn(async () => 'basico'),
}));

jest.mock('../services/landingCodigo.service', () => ({}));
jest.mock('../services/imagen.service', () => ({
  eliminarObjetoStorage: jest.fn(async () => {}),
}));
jest.mock('../factories/PaginaFactory', () => ({
  crearInicio: jest.fn(async payload => ({ id: 99, ...payload })),
}));

const { Landing, Testimonio } = require('../models');
const ImagenService = require('../services/imagen.service');
const LandingSimpleService = require('../services/landingSimple.service');

describe('LandingSimpleService.eliminar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Testimonio.findAll.mockResolvedValue([]);
  });

  test('conserva la landing si falla la limpieza de almacenamiento', async () => {
    const actual = { id: 193, tienda_id: 7, banner_imagen: 'https://cdn.gesicomm.com/banner.webp' };
    const storageError = Object.assign(new Error('Error de red al contactar almacenamiento.'), { status: 503 });
    Landing.findOne.mockResolvedValue(actual);
    Landing.findAll.mockResolvedValue([actual]);
    ImagenService.eliminarObjetoStorage.mockRejectedValueOnce(storageError);

    await expect(LandingSimpleService.eliminar(193, 7)).rejects.toBe(storageError);
    expect(Landing.destroy).not.toHaveBeenCalled();
  });

  test('borra todas las landings simples residuales de la tienda', async () => {
    const actual = {
      id: 10,
      tienda_id: 7,
      banner_imagen: null,
      seo_og_imagen: null,
      logo_imagen: null,
    };
    const residual = {
      id: 11,
      tienda_id: 7,
      banner_imagen: '/uploads/banner.jpg',
      banner_imagen_storage_key: 'banner-key',
      seo_og_imagen: null,
      logo_imagen: null,
    };

    Landing.findOne.mockResolvedValue(actual);
    Landing.findAll.mockResolvedValue([actual, residual]);
    Landing.destroy.mockResolvedValue(2);

    await LandingSimpleService.eliminar(10, 7);

    expect(Landing.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 10, tienda_id: 7 },
    }));
    expect(Landing.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { tienda_id: 7 },
      include: [expect.objectContaining({
        required: true,
        where: { kind: { [Op.in]: ['rigido', 'codigo'] } },
      })],
    }));
    expect(ImagenService.eliminarObjetoStorage).toHaveBeenCalledWith({
      url: '/uploads/banner.jpg',
      storage_key: 'banner-key',
    });
    expect(Landing.destroy).toHaveBeenCalledWith({
      where: { id: { [Op.in]: [10, 11] }, tienda_id: 7 },
    });
  });
});
