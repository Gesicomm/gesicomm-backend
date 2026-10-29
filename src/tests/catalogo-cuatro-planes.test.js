jest.mock('../models',()=>({Plan:{findAll:jest.fn()},Suscripcion:{findOne:jest.fn()},sequelize:{transaction:jest.fn()}}));
const Service=require('../services/suscripcion.service');
const {PLANES,CODIGOS}=require('../utils/catalogoPlanes');
const {Plan,Suscripcion}=require('../models');
test('el catálogo base contiene exactamente los cuatro planes y fija identidad y duración',()=>{
 expect(Service.planesPagosBase().map(p=>p.codigo)).toEqual(CODIGOS);
 for(const plan of PLANES){
   expect(Service.limpiarPlanAdmin({...plan,nombre:'Fundador',acceso_rutas:'ambas',periodicidad:'unico'},0)).toMatchObject({nombre:plan.nombre,acceso_rutas:plan.acceso_rutas,periodicidad:plan.periodicidad,equivale_plan:'pago'});
 }
});
test.each(['founders','free','starter','growth','scale'])('no permite recrear o contratar el plan retirado %s',async codigo=>{
 expect(()=>Service.limpiarPlanAdmin({codigo,nombre:codigo},0)).toThrow(/cuatro planes/);
 await expect(Service.crearCheckoutIntent({plan_codigo:codigo})).rejects.toMatchObject({status:404});
});
test('no permite borrar uno de los cuatro planes ni guardar catálogos parciales o repetidos',async()=>{
 await expect(Service.eliminarPlanAdmin('una-ruta-mensual')).rejects.toMatchObject({status:400});
 await expect(Service.guardarPlanesAdmin([PLANES[0]])).rejects.toMatchObject({status:400});
 await expect(Service.guardarPlanesAdmin(Array(4).fill(PLANES[0]))).rejects.toMatchObject({status:400});
});
test('las consultas públicas y de admin restringen los códigos comerciales',async()=>{
 Plan.findAll.mockResolvedValue([]);
 await Service.listarPlanesPagos();await Service.listarPlanesAdmin();
 for(const [query] of Plan.findAll.mock.calls)expect(Object.getOwnPropertySymbols(query.where.codigo).map(k=>query.where.codigo[k])[0]).toEqual(CODIGOS);
});
test('la consulta de acceso prioriza la concesión permanente',async()=>{
 await Service.suscripcionActivaDeUsuario(70);
 expect(Suscripcion.findOne).toHaveBeenCalledWith(expect.objectContaining({order:expect.arrayContaining([['acceso_permanente','DESC']])}));
});
