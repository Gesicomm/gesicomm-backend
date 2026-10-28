const {accesoDelPlan,resolverRuta,rutasDeSuscripcion}=require('../utils/rutasPlan');
const active=(access,selected,extra={})=>({estado:'activa',periodo_fin:new Date(Date.now()+86400000),Plan:{acceso_rutas:access},ruta_acceso:selected,...extra});
test.each([
 ['elegir','fisico',{fisico:true,personal:false}],['elegir','personal',{fisico:false,personal:true}],
 ['fisico','fisico',{fisico:true,personal:false}],['personal','personal',{fisico:false,personal:true}],
 ['ambas','ambas',{fisico:true,personal:true}],
])('%s + %s habilita únicamente las rutas contratadas',(policy,selected,expected)=>{
 expect(resolverRuta({acceso_rutas:policy},selected)).toBe(selected);
 expect(rutasDeSuscripcion(active(policy,selected))).toEqual(expected);
});
test.each(['ambas',undefined,null])('una ruta no permite ampliar ni omitir la elección (%s)',ruta=>{
 expect(()=>resolverRuta({acceso_rutas:'elegir'},ruta)).toThrow();
});
test.each([['fisico','personal'],['personal','fisico'],['personal','ambas'],['fisico','ambas']])('no permite %s -> %s',(acceso,ruta)=>{
 expect(()=>resolverRuta({acceso_rutas:acceso},ruta)).toThrow();
});
test('datos viejos o manipulados no amplían una ruta a elegir',()=>{
 expect(rutasDeSuscripcion(active('elegir','ambas'))).toEqual({fisico:false,personal:false});
 expect(rutasDeSuscripcion(active('fisico','ambas'))).toEqual({fisico:true,personal:false});
});
test.each(['activa','cancelada','vencida'])('al vencer no hay acceso aunque estado sea %s',estado=>{
 expect(rutasDeSuscripcion(active('ambas','ambas',{estado,periodo_fin:new Date(Date.now()-1)}))).toEqual({fisico:false,personal:false});
});
jest.mock('../services/suscripcion.service',()=>({suscripcionActivaDeUsuario:jest.fn()}));
const Subs=require('../services/suscripcion.service');
const {verificarAccesoSolicitud,rutaDeSolicitud}=require('../middleware/accesoRutaNegocio');
const res=()=>({status:jest.fn().mockReturnThis(),json:jest.fn()});
test.each([
 ['fisico','fisico','/api/productos/1',true],['fisico','fisico','/api/auth/marca-personal/meta/status',false],
 ['personal','personal','/api/productos/1',false],['personal','personal','/api/auth/marca-personal/meta/status',true],
 ['ambas','ambas','/api/envios/list',true],['ambas','ambas','/api/auth/marca-personal/meta/status',true],
])('API %s %s %s acceso=%s',async(policy,selected,url,allowed)=>{
 Subs.suscripcionActivaDeUsuario.mockResolvedValue(active(policy,selected));
 const next=jest.fn(),response=res();
 await verificarAccesoSolicitud({originalUrl:url,usuario:{id:700,rol:'usuario'}},response,next);
 expect(next).toHaveBeenCalledTimes(allowed?1:0);
 if(!allowed) expect(response.status).toHaveBeenCalledWith(403);
});
test('JWT vigente no conserva acceso con una suscripción vencida',async()=>{
 Subs.suscripcionActivaDeUsuario.mockResolvedValue(null);
 const next=jest.fn(),response=res();
 await verificarAccesoSolicitud({originalUrl:'/api/productos/1',usuario:{id:700,rol:'usuario'}},response,next);
 expect(response.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
});
test('administrador conserva las rutas y el colaborador depende del plan del propietario',async()=>{
 let next=jest.fn();
 await verificarAccesoSolicitud({originalUrl:'/api/productos',usuario:{id:1,rol:'administrador'}},res(),next);
 expect(next).toHaveBeenCalledTimes(1);
 Subs.suscripcionActivaDeUsuario.mockResolvedValue(active('personal','personal'));
 next=jest.fn();const response=res();
 await verificarAccesoSolicitud({originalUrl:'/api/productos',usuario:{id:701,rol:'colaborador',propietarioId:700}},response,next);
 expect(Subs.suscripcionActivaDeUsuario).toHaveBeenCalledWith(700);
 expect(response.status).toHaveBeenCalledWith(403);
});
test('no bloquea login, planes, perfil o renovación por falta de ruta',()=>{
 for(const path of ['/api/auth/me','/api/auth/login','/api/auth/perfil','/api/planes','/api/suscripciones/checkout'])expect(rutaDeSolicitud({originalUrl:path})).toBeNull();
});



test.each(['1970-01-01T00:00:00Z','fecha-invalida'])('un fin inválido o vencido no concede acceso: %s',fin=>{
 expect(rutasDeSuscripcion(active('ambas','ambas',{periodo_fin:fin}))).toEqual({fisico:false,personal:false});
});
