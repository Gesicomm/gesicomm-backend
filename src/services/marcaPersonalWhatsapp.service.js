'use strict';
const {MarcaPersonalError}=require('./marcaPersonal.client');
const {logger}=require('../utils/logger');
const fail=(text,status=400)=>new MarcaPersonalError(text,status);
const tel=value=>{const s=String(value??'').replace(/[\s()+.-]/g,'');if(!/^\d{8,15}$/.test(s))throw fail('Escribí el número con código de país, de 8 a 15 dígitos.');return s;};
const entero=(v,def,max)=>{if(v==null)return def;const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>max)throw fail('Página inválida.');return n;};
function createService({store,meta,graph,ahora=()=>Date.now()}={}){
 const db=()=>store||(store=require('./marcaPersonalWhatsapp.store').createStore());
 const m=()=>meta||(meta=require('./marcaPersonalMeta.service'));
 const g=()=>graph||(graph=require('./marcaPersonalMeta.graph'));
 const context=async usuario=>{const c=await m().contextoWhatsapp(usuario);return {...c,phone:c.external_id};};
 const ventana=fecha=>!!fecha&&Date.parse(fecha)<=ahora()&&ahora()-Date.parse(fecha)<86400000;
 async function conversaciones(usuario,body={}){
  const c=await context(usuario),offset=entero(body.offset,0,1000000);
  const rows=await db().conversaciones(c,31,offset);
  return {items:rows.slice(0,30).map(r=>({...r,ventana_abierta:ventana(r.ultimo_entrante)})),siguiente:rows.length>30?offset+30:null,
   recepcion_configurada:!!process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN};
 }
 async function mensajes(usuario,body={}){
  const c=await context(usuario),contacto=tel(body.contacto),before=entero(body.before,0,Number.MAX_SAFE_INTEGER);
  const [rows,ultimo]=await Promise.all([db().mensajes(c,contacto,before,51),db().ultimoEntrante(c,contacto)]);
  const items=rows.slice(0,50);
  return {contacto,items:items.reverse(),anterior:rows.length>50?items[0].id:null,ventana_abierta:ventana(ultimo),ultimo_entrante:ultimo||null};
 }
 async function enviar(usuario,body={}){
  const c=await context(usuario),contacto=tel(body.para);
  if(!/^[a-f0-9]{32,64}$/.test(body.solicitud||''))throw fail('Identificador de envío inválido. Recargá la bandeja.');
  const tipo=body.tipo==='plantilla'?'plantilla':'texto';
  if(tipo==='texto'&&!ventana(await db().ultimoEntrante(c,contacto)))throw fail('Para iniciar o retomar este chat, elegí una plantilla aprobada. El texto libre se habilita cuando la persona te escribe y durante las 24 horas siguientes.',409);
  if(tipo==='texto'&&(typeof body.texto!=='string'||!body.texto.trim()||body.texto.length>4096))throw fail('Escribí un mensaje de hasta 4.096 caracteres.');
  if(tipo==='plantilla'&&(!/^[a-z0-9_]{1,512}$/.test(body.plantilla||'')||!/^[a-z]{2}(_[A-Z]{2})?$/.test(body.idioma||'')))throw fail('Elegí una plantilla y un idioma válidos.');
  const reserved=await db().reservar(c,{solicitud:body.solicitud,contacto,tipo,texto:tipo==='texto'?body.texto.trim():'Plantilla: '+body.plantilla});
  if(!reserved)throw fail('Este envío ya se registró. Actualizá el chat antes de volver a enviarlo.',409);
  let result;
  try{result=await m().enviarWhatsapp(usuario,{...body,para:contacto});}
  catch(e){await db().fallo(c,reserved.id,e.status===503?'incierto':'error');throw e;}
  try{await db().confirmar(c,reserved.id,result.id,'aceptado');}
  catch{logger.error({mensaje:'WhatsApp aceptó un mensaje pero no se pudo actualizar su estado local',registro:reserved.id});return {...result,guardado:false};}
  return {...result,guardado:true};
 }
 async function suscribir(usuario){
  const c=await context(usuario);
  if(!process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN)throw fail('Falta configurar la recepción de WhatsApp en el servidor y el webhook de Meta.',503);
  if(!/^\d{1,64}$/.test(c.cuenta_id||''))throw fail('Volvé a conectar tu número de WhatsApp Business.',409);
  await g().facebook(c.cuenta_id+'/subscribed_apps',{method:'POST',token:c.token});
  return {ok:true};
 }
 // Sólo se invoca después de verificar la firma del cuerpo HTTP original.
 async function recibir(payload){
  if(payload?.object!=='whatsapp_business_account')return;
  for(const entry of payload.entry||[])for(const change of entry.changes||[]){
   if(change.field!=='messages')continue;
   const value=change.value||{},phone=String(value.metadata?.phone_number_id||''),waba=String(entry.id||'');
   if(!/^\d{1,64}$/.test(phone)||!/^\d{1,64}$/.test(waba))continue;
   const c=await db().destino(phone,waba);if(!c)continue;
   const guardar=async(msg,direccion='entrante',contactoForzado,nombreForzado)=>{
    const external=String(msg.id||'');if(!external||external.length>300)return;
    let contacto;try{contacto=tel(contactoForzado|| (direccion==='entrante'?msg.from:msg.to));}catch{return;}
    const seconds=Number(msg.timestamp),fecha=new Date(seconds*1000);
    if(!Number.isFinite(seconds)||seconds<=0||fecha.getTime()>ahora()+300000||!Number.isFinite(fecha.getTime()))return;
    const tipo=String(msg.type||'desconocido').slice(0,30);
    const contenido=msg.text?.body||msg[tipo]?.caption||msg.interactive?.button_reply?.title||msg.interactive?.list_reply?.title||msg.button?.text||'';
    const nombre=nombreForzado||(value.contacts||[]).find(x=>x.wa_id===contacto)?.profile?.name;
    await db().guardar(c,{external,contacto,nombre:typeof nombre==='string'?nombre.slice(0,200):null,direccion,tipo,texto:String(contenido).slice(0,12000),estado:direccion==='entrante'?'recibido':'enviado',fecha});
   };
   for(const msg of value.messages||[])await guardar(msg);
   const estados={sent:'enviado',delivered:'entregado',read:'leido',failed:'error'};
   for(const s of value.statuses||[]){
    if(!estados[s.status]||typeof s.id!=='string'||s.id.length>300)continue;
    let contacto;try{contacto=tel(s.recipient_id);}catch{continue;}
    const fecha=new Date(Number(s.timestamp)*1000);if(!Number.isFinite(fecha.getTime())||fecha.getTime()>ahora()+300000)continue;
    await db().estado(c,{external:s.id,contacto,estado:estados[s.status],fecha});
   }
  }
 }
 return {conversaciones,mensajes,enviar,suscribir,recibir};
}
module.exports={createService,...createService()};
