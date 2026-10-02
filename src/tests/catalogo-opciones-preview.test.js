const { Op } = require('sequelize');
jest.mock('../models', () => ({ ProductoVariante: { findAll: jest.fn() }, Oferta: { findAll: jest.fn() } }));
jest.mock('../services/comboConfiguracion.service', () => ({}));
jest.mock('../services/combo.service', () => ({}));
jest.mock('../services/imagen.service', () => ({}));
const { ProductoVariante, Oferta } = require('../models');
const Servicio = require('../services/precioUsuario.service');
describe('Opciones comerciales para la preview de catálogo', () => {
 beforeEach(() => jest.clearAllMocks());
 it('reconoce variantes activas y paquetes normales sin consultar otros productos o tenants', async () => {
  ProductoVariante.findAll.mockResolvedValue([{producto_id:11}]);
  Oferta.findAll.mockResolvedValue([{producto_ancla_id:12}]);
  const ids = await Servicio.idsConOpciones([{id:11},{id:12},{id:13}],7);
  expect([...ids]).toEqual([11,12]);
  expect(ProductoVariante.findAll).toHaveBeenCalledWith(expect.objectContaining({where:{producto_id:{[Op.in]:[11,12,13]},inquilino_id:7,activo:true}}));
  expect(Oferta.findAll).toHaveBeenCalledWith(expect.objectContaining({where:{producto_ancla_id:{[Op.in]:[11,12,13]},inquilino_id:7,activo:true,estrategia:'normal'}}));
 });
 it('no consulta datos comerciales para un catálogo vacío',async()=>{
  expect(await Servicio.idsConOpciones([],7)).toEqual(new Set());
  expect(ProductoVariante.findAll).not.toHaveBeenCalled();
  expect(Oferta.findAll).not.toHaveBeenCalled();
 });
});
