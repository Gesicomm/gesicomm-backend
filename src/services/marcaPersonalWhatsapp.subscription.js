'use strict';
const {MarcaPersonalError}=require('./marcaPersonal.client');
async function suscribir({graph,cuenta,token}){
 if(!process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN||!process.env.FACEBOOK_APP_ID)throw new MarcaPersonalError('La recepción de WhatsApp todavía no está configurada en el servidor.',503);
 if(!/^\d{1,64}$/.test(String(cuenta||'')))throw new MarcaPersonalError('Volvé a conectar tu número de WhatsApp Business.',409);
 const result=await graph.facebook(cuenta+'/subscribed_apps',{method:'POST',token});
 if(result?.success!==true)throw new MarcaPersonalError('Meta no confirmó la activación de la recepción. Volvé a verificarla desde Conexiones.',503);
 // Un POST aceptado no prueba que la app correcta haya quedado suscrita.
 // Conservar las demás apps; nunca desuscribirlas ni modificar sus callbacks.
 const current=await graph.facebook(cuenta+'/subscribed_apps',{token});
 if(!(current.data||[]).some(x=>String(x.whatsapp_business_api_data?.id||x.id)===String(process.env.FACEBOOK_APP_ID)))throw new MarcaPersonalError('La app de Gesicom todavía no figura suscrita a esta cuenta Business. Verificá la recepción desde Conexiones.',503);
 return {ok:true};
}
module.exports={suscribir};
