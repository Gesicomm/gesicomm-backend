jest.mock('../models',()=>({
 sequelize:{transaction:jest.fn(fn=>fn('TX'))},
 Producto:{findAll:jest.fn(async()=>[{id:8,precio_base:100}])},
 Categoria:{findOne:jest.fn(async()=>null),create:jest.fn(async data=>({id:data.tienda_id+100,...data}))},
 PrecioUsuario:{findOrCreate:jest.fn()},
}));
jest.mock('../models/CategoriaAsignacionTienda',()=>({upsert:jest.fn()}));
const svc=require('../services/precioUsuario.service');
const Asignacion=require('../models/CategoriaAsignacionTienda');
const {Categoria,PrecioUsuario}=require('../models');
test('el mismo producto admite categorías diferentes por tienda sin cambiar su precio',async()=>{
 jest.spyOn(svc,'obtenerIdsAdministradores').mockResolvedValue([]);
 await svc.categorizarProductos(171,2,{producto_ids:[8],categoria_nombre:'Concepción'},false,80);
 await svc.categorizarProductos(171,2,{producto_ids:[8],categoria_nombre:'Otra'},false,81);
 expect(Asignacion.upsert).toHaveBeenNthCalledWith(1,{tienda_id:80,tipo:'producto',referencia_id:8,categoria_id:180},{transaction:'TX'});
 expect(Asignacion.upsert).toHaveBeenNthCalledWith(2,{tienda_id:81,tipo:'producto',referencia_id:8,categoria_id:181},{transaction:'TX'});
 expect(Categoria.create).toHaveBeenCalledWith(expect.objectContaining({tienda_id:80,nombre:'Concepción'}),{transaction:'TX'});
 expect(PrecioUsuario.findOrCreate).not.toHaveBeenCalled();
});
test('sin tienda no crea personalizaciones generales',async()=>{
 await expect(svc.categorizarProductos(171,2,{producto_ids:[8],categoria_nombre:'Prueba'})).rejects.toMatchObject({status:409});
});
