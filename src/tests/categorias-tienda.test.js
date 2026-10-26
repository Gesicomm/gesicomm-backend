const {Op}=require('sequelize');
jest.mock('../models',()=>({Categoria:{findOne:jest.fn(),findAndCountAll:jest.fn(),create:jest.fn()}}));
const {Categoria}=require('../models');
const svc=require('../services/categoria.service');
beforeEach(()=>{jest.clearAllMocks();Categoria.findOne.mockResolvedValue(null);Categoria.create.mockImplementation(async x=>({id:5,...x}));});
test('el alta toma la tienda del contexto y no la enviada por el cliente',async()=>{
 await svc.crear({nombre:'Concepción',tienda_id:999,inquilino_id:999},2,80);
 expect(Categoria.create).toHaveBeenCalledWith(expect.objectContaining({nombre:'Concepción',inquilino_id:2,tienda_id:80}));
});
test('la búsqueda solo incluye la tienda activa y el catálogo general',async()=>{
 Categoria.findAndCountAll.mockResolvedValue({rows:[],count:0});
 await svc.buscar({tienda_id:80,include_children:true},2,81);
 const args=Categoria.findAndCountAll.mock.calls[0][0];
 expect(args.where[Op.or]).toEqual([{tienda_id:81},{tienda_id:null}]);
 expect(args.include[0].where[Op.or]).toEqual([{tienda_id:81},{tienda_id:null}]);
});
test('sin tienda no crea ni lista categorías del tenant completo',async()=>{
 await expect(svc.crear({nombre:'Privada'},2)).rejects.toMatchObject({status:409});
 await expect(svc.buscar({},2)).rejects.toMatchObject({status:409});
 expect(Categoria.create).not.toHaveBeenCalled();
});
test('no renombra ni elimina categorías ajenas o globales desde una tienda',async()=>{
 await expect(svc.actualizar(80,{nombre:'Otra'},2,81)).rejects.toThrow('no encontrada');
 await expect(svc.eliminar(80,2,81)).rejects.toThrow('no encontrada');
 expect(Categoria.findOne).toHaveBeenLastCalledWith({where:{id:80,inquilino_id:2,tienda_id:81}});
});
test('no asigna categorías ni padres privados de otra tienda',async()=>{
 await expect(svc.validarAsignacion(80,2,81)).rejects.toMatchObject({status:400});
 await expect(svc.crear({nombre:'Hija',parent_id:80},2,81)).rejects.toMatchObject({status:400});
 expect(Categoria.create).not.toHaveBeenCalled();
});
