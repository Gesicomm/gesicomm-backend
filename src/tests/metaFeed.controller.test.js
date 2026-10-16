jest.mock('../models', () => ({ Landing: { findOne: jest.fn() }, sequelize: { literal: jest.fn(s => s) } }));
jest.mock('../services/metaFeed.service', () => ({ tiendaPrivada: jest.fn(), estado: jest.fn() }));
const { Landing } = require('../models');
const Feed = require('../services/metaFeed.service');
const ctrl = require('../controllers/metaFeed.controller');
function respuesta() { return { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }; }
beforeEach(() => jest.clearAllMocks());
test('resuelve la misma landing que la pestaña del catálogo, dentro de la tienda autorizada', async () => {
  const tienda = { id: 8 };
  Feed.tiendaPrivada.mockResolvedValue(tienda);
  Landing.findOne.mockResolvedValue({ id: 27, slug: 'mi-catalogo' });
  Feed.estado.mockResolvedValue({ landing_id: 27, url: 'https://propia.example/feed' });
  const res = respuesta();
  await ctrl.actual({ usuario: { id: 3, tiendaId: 8, tenantId: 1 }, body: { tienda_id: 999, landing_id: 999 } }, res);
  expect(Landing.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { tienda_id: 8, inquilino_id: 1, activo: true }, order: expect.arrayContaining([['id', 'DESC']]) }));
  expect(tienda.feed_landing_id).toBe(27);
  expect(Feed.estado).toHaveBeenCalledWith(tienda);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ landing_id: 27 }));
});
test('sin landing publicada no retorna un enlace al catálogo general', async () => {
  Feed.tiendaPrivada.mockResolvedValue({ id: 8 });
  Landing.findOne.mockResolvedValue(null);
  const res = respuesta();
  await ctrl.actual({ usuario: { tenantId: 1 } }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(Feed.estado).not.toHaveBeenCalled();
});
