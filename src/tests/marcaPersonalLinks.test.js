'use strict';
const {normalizeLinks,createService}=require('../services/marcaPersonalLinks.service');
const valid=[{title:' Mi agenda ',description:' Reservá un horario ',url:'https://example.com/agenda'}];
test('normaliza enlaces sin interpretar el nombre como HTML',()=>{
 expect(normalizeLinks(valid)).toEqual([{title:'Mi agenda',description:'Reservá un horario',url:'https://example.com/agenda'}]);
 expect(normalizeLinks([{title:'<script>alert(1)</script>',url:'https://example.com'}])[0].title).toBe('<script>alert(1)</script>');
});
test.each(['javascript:alert(1)','data:text/html,x','file:///etc/passwd','https://user:secret@example.com','no-es-url'])('rechaza URL insegura o incompleta: %s',url=>{
 expect(()=>normalizeLinks([{title:'Prueba',url}])).toThrow();
});
test('acepta eliminar todos los enlaces y limita tamaños',()=>{
 expect(normalizeLinks([])).toEqual([]);
 expect(()=>normalizeLinks(Array(51).fill(valid[0]))).toThrow();
 expect(()=>normalizeLinks([{title:'x'.repeat(101),url:'https://example.com'}])).toThrow();
});
function setup(enabled=true,allowed=true){
 const store={read:jest.fn(async account=>({links:[],version:0,account})),write:jest.fn(async(user,account,links,version)=>({links,version:version+1}))};
 const accountAccess=jest.fn(async()=>allowed),identity=jest.fn(async()=>({enabled}));
 return {store,accountAccess,service:createService({identity,remote:()=>({accountAccess}),store})};
}
test('usa el usuario autenticado para verificar membresía y guarda por marca',async()=>{
 const {service,store,accountAccess}=setup();
 await service.write(41,'marca-a',{links:valid,version:0});
 expect(accountAccess).toHaveBeenCalledWith(41,'marca-a');
 expect(store.write).toHaveBeenCalledWith(41,'marca-a',normalizeLinks(valid),0);
 await service.read(41,'marca-b');expect(store.read).toHaveBeenCalledWith('marca-b');
});
test('rechaza acceder a marcas ajenas antes de leer o escribir datos',async()=>{
 const {service,store}=setup(true,false);
 await expect(service.read(41,'otra-marca')).rejects.toMatchObject({status:403});
 await expect(service.write(41,'otra-marca',{links:valid,version:0})).rejects.toMatchObject({status:403});
 expect(store.read).not.toHaveBeenCalled();expect(store.write).not.toHaveBeenCalled();
});
test('no permite editar a usuarios sin acceso vigente ni usar filtros manipulados',async()=>{
 const {service,store,accountAccess}=setup(false);
 await expect(service.read(41,'marca-a')).rejects.toMatchObject({status:403});
 await expect(service.read(41,'a&select=secret')).rejects.toMatchObject({status:400});
 expect(accountAccess).not.toHaveBeenCalled();expect(store.read).not.toHaveBeenCalled();
});
test('exige versión y conserva un conflicto de edición para no pisar cambios',async()=>{
 const {service,store}=setup();
 await expect(service.write(41,'marca-a',{links:valid})).rejects.toMatchObject({status:400});
 store.write.mockRejectedValueOnce(Object.assign(Error('Cambió la versión'),{status:409}));
 await expect(service.write(41,'marca-a',{links:valid,version:2})).rejects.toMatchObject({status:409});
});
