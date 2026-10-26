jest.mock('../utils/logger',()=>({logger:{error:jest.fn()}}));
const {createService}=require('../services/marcaPersonalWhatsapp.service');
const now=Date.parse('2026-10-26T15:00:00Z'),phone='123456',account='marca-a';
function setup(){
 const c={account,external_id:phone,cuenta_id:'999',token:'no-exponer'};
 const meta={contextoWhatsapp:jest.fn(async id=>{if(id!==7)throw Object.assign(Error('Sin acceso'),{status:403});return c;}),enviarWhatsapp:jest.fn(async()=>({id:'wamid.1',para:'595981123456',estado:'accepted'}))};
 const store={destino:jest.fn(async(p,w)=>p===phone&&w==='999'?{account,phone}:null),guardar:jest.fn(),estado:jest.fn(),conversaciones:jest.fn(async()=>[]),mensajes:jest.fn(async()=>[]),ultimoEntrante:jest.fn(async()=>new Date(now-3600000)),reservar:jest.fn(async()=>({id:1})),confirmar:jest.fn(),fallo:jest.fn()};
 const graph={facebook:jest.fn(async()=>({success:true}))};
 return {store,meta,graph,s:createService({store,meta,graph,ahora:()=>now})};
}
const send={para:'595981123456',tipo:'texto',texto:'Hola',solicitud:'a'.repeat(48)};
const event=(value,entry='999')=>({object:'whatsapp_business_account',entry:[{id:entry,changes:[{field:'messages',value:{metadata:{phone_number_id:phone},...value}}]}]});
test('las lecturas resuelven la marca con la sesión e ignoran un account_id ajeno',async()=>{
 const {s,store,meta}=setup();await s.conversaciones(7,{account_id:'otra'});
 expect(meta.contextoWhatsapp).toHaveBeenCalledWith(7);expect(store.conversaciones).toHaveBeenCalledWith(expect.objectContaining({account,phone}),31,0);
 expect(JSON.stringify(await s.conversaciones(7))).not.toContain('no-exponer');
 await expect(s.conversaciones(8)).rejects.toMatchObject({status:403});expect(store.conversaciones).toHaveBeenCalledTimes(2);
});
test('página de chats acotada, historial paginado cronológico y ventana calculada en servidor',async()=>{
 const {s,store}=setup();store.conversaciones.mockResolvedValue(Array.from({length:31},(_,i)=>({contacto:String(i),ultimo_entrante:new Date(now-1000)})));
 const list=await s.conversaciones(7);expect(list.items).toHaveLength(30);expect(list.siguiente).toBe(30);expect(list.items[0].ventana_abierta).toBe(true);
 store.mensajes.mockResolvedValue(Array.from({length:51},(_,i)=>({id:100-i})));const r=await s.mensajes(7,{contacto:send.para});
 expect(r.items[0].id).toBe(51);expect(r.items.at(-1).id).toBe(100);expect(r.anterior).toBe(51);
 await expect(s.conversaciones(7,{offset:-1})).rejects.toMatchObject({status:400});await expect(s.mensajes(7,{contacto:'1'})).rejects.toMatchObject({status:400});
});
test('rechaza texto libre sin entrante reciente y no reserva ni envía',async()=>{
 const {s,store,meta}=setup();for(const date of [null,new Date(now-86400000),new Date(now+1000)]){store.ultimoEntrante.mockResolvedValue(date);await expect(s.enviar(7,send)).rejects.toMatchObject({status:409});}
 expect(store.reservar).not.toHaveBeenCalled();expect(meta.enviarWhatsapp).not.toHaveBeenCalled();
});
test('reserva antes de enviar y no repite una solicitud registrada',async()=>{
 const {s,store,meta}=setup();await expect(s.enviar(7,send)).resolves.toMatchObject({id:'wamid.1',guardado:true});
 expect(store.reservar.mock.invocationCallOrder[0]).toBeLessThan(meta.enviarWhatsapp.mock.invocationCallOrder[0]);
 expect(store.confirmar).toHaveBeenCalledWith(expect.objectContaining({account}),1,'wamid.1','aceptado');
 store.reservar.mockResolvedValue(null);await expect(s.enviar(7,send)).rejects.toMatchObject({status:409});expect(meta.enviarWhatsapp).toHaveBeenCalledTimes(1);
});
test('permite iniciar con plantilla y conserva el estado incierto sin repetir',async()=>{
 const {s,store,meta}=setup();store.ultimoEntrante.mockResolvedValue(null);
 const body={...send,tipo:'plantilla',plantilla:'bienvenida',idioma:'es'};await s.enviar(7,body);expect(meta.enviarWhatsapp).toHaveBeenCalledTimes(1);
 meta.enviarWhatsapp.mockRejectedValue(Object.assign(Error('No respondió'),{status:503}));await expect(s.enviar(7,body)).rejects.toMatchObject({status:503});expect(store.fallo).toHaveBeenCalledWith(expect.anything(),1,'incierto');
});
test('si Meta acepta pero falla la confirmación local, informa aceptación sin incitar reintento',async()=>{
 const {s,store,meta}=setup();store.confirmar.mockRejectedValue(Error('DB'));expect(await s.enviar(7,send)).toMatchObject({id:'wamid.1',guardado:false});expect(meta.enviarWhatsapp).toHaveBeenCalledTimes(1);
});
test('los mensajes entrantes se asignan sólo al número y WABA conectados, con ID para deduplicar',async()=>{
 const {s,store}=setup();const msg={id:'wamid.in',from:send.para,type:'text',timestamp:String(now/1000-10),text:{body:'<script>Hola</script>'}};
 await s.recibir(event({messages:[msg],contacts:[{wa_id:send.para,profile:{name:'Ana'}}]}));
 expect(store.guardar).toHaveBeenCalledWith({account,phone},expect.objectContaining({external:'wamid.in',contacto:send.para,nombre:'Ana',texto:'<script>Hola</script>',direccion:'entrante'}));
 await s.recibir(event({messages:[msg]},'otra'));expect(store.guardar).toHaveBeenCalledTimes(1);
 await s.recibir(event({messages:[{...msg,timestamp:String(now/1000+86400)}]}));expect(store.guardar).toHaveBeenCalledTimes(1);
});
test('recepción registra estados de entrega sin exponer el payload ni enviar mensajes',async()=>{
 const {s,store,meta}=setup();await s.recibir(event({statuses:[{id:'wamid.1',recipient_id:send.para,status:'read',timestamp:String(now/1000)}]}));
 expect(store.estado).toHaveBeenCalledWith({account,phone},expect.objectContaining({estado:'leido',external:'wamid.1'}));expect(meta.enviarWhatsapp).not.toHaveBeenCalled();
});
test('suscribir requiere configuración y usa solamente el WABA de la marca',async()=>{
 const {s,graph}=setup();delete process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN;await expect(s.suscribir(7)).rejects.toMatchObject({status:503});
 const old=process.env.FACEBOOK_APP_ID;process.env.FACEBOOK_APP_ID='app-test';
 process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN='verificacion-test';graph.facebook.mockImplementation(async(path,options)=>options?.method==='POST'?{success:true}:{data:[{whatsapp_business_api_data:{id:'app-test'}}]});
 try{await s.suscribir(7);expect(graph.facebook).toHaveBeenCalledWith('999/subscribed_apps',{method:'POST',token:'no-exponer'});expect(graph.facebook).toHaveBeenCalledWith('999/subscribed_apps',{token:'no-exponer'});}finally{delete process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN;if(old===undefined)delete process.env.FACEBOOK_APP_ID;else process.env.FACEBOOK_APP_ID=old;}
});
