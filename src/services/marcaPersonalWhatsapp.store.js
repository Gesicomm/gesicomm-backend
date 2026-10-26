'use strict';
function createStore(database){
 const db=()=>database||require('../config/database');
 const q=async(sql,replacements={})=>(await db().query(sql,{replacements}))[0];
 const scope=c=>({account:c.account,phone:c.phone});
 const locked=async(c,external,fn)=>db().transaction(async transaction=>{
  await db().query('SELECT pg_advisory_xact_lock(hashtext(:account),hashtext(:key))',{replacements:{account:c.account,key:c.phone+':'+external},transaction});
  const query=async(sql,replacements)=>(await db().query(sql,{replacements,transaction}))[0];
  return fn(query);
 });
 return {
  async destino(phone,waba){return (await q(`SELECT account_id AS account,external_id AS phone FROM marca_personal_meta_conexiones
   WHERE plataforma='whatsapp' AND external_id=:phone AND cuenta_id=:waba`,{phone,waba}))[0];},
  async guardar(c,m){return locked(c,m.external,async query=>(await query(`INSERT INTO marca_personal_whatsapp_mensajes
   (account_id,phone_id,external_id,contacto,nombre,direccion,tipo,texto,estado,estado_fecha,fecha)
   VALUES(:account,:phone,:external,:contacto,:nombre,:direccion,:tipo,:texto,:estado,:fecha,:fecha)
   ON CONFLICT(account_id,phone_id,external_id) DO UPDATE SET
    nombre=COALESCE(EXCLUDED.nombre,marca_personal_whatsapp_mensajes.nombre),
    tipo=CASE WHEN marca_personal_whatsapp_mensajes.tipo='pendiente' THEN EXCLUDED.tipo ELSE marca_personal_whatsapp_mensajes.tipo END,
    texto=CASE WHEN marca_personal_whatsapp_mensajes.tipo='pendiente' THEN EXCLUDED.texto ELSE marca_personal_whatsapp_mensajes.texto END
   RETURNING id`,{...scope(c),...m}))[0]);},
  async reservar(c,m){return (await q(`INSERT INTO marca_personal_whatsapp_mensajes
   (account_id,phone_id,solicitud,contacto,direccion,tipo,texto,estado)
   VALUES(:account,:phone,:solicitud,:contacto,'saliente',:tipo,:texto,'enviando')
   ON CONFLICT(account_id,phone_id,solicitud) DO NOTHING RETURNING id`,{...scope(c),...m}))[0];},
  async confirmar(c,id,external,estado){
   // Si llegó el webhook antes de la respuesta de envío, conserva su estado.
   await locked(c,external,async query=>{
    // El estado pendiente puede existir antes del mensaje enviado. La transacción
    // bloquea ese registro y lo fusiona antes de asignar el identificador único.
    const pending=await query(`DELETE FROM marca_personal_whatsapp_mensajes WHERE account_id=:account AND phone_id=:phone AND external_id=:external AND tipo='pendiente' AND id <> :id RETURNING estado,estado_fecha`,{...scope(c),id,external});
    await query(`UPDATE marca_personal_whatsapp_mensajes SET external_id=:external,estado=:estado,estado_fecha=:estadoFecha
     WHERE id=:id AND account_id=:account AND phone_id=:phone`,{...scope(c),id,external,estado:pending[0]?.estado||estado,estadoFecha:pending[0]?.estado_fecha||new Date()});
   });
  },
  fallo:(c,id,estado)=>q('UPDATE marca_personal_whatsapp_mensajes SET estado=:estado WHERE id=:id AND account_id=:account AND phone_id=:phone',{...scope(c),id,estado}),
  async estado(c,m){await locked(c,m.external,query=>query(`INSERT INTO marca_personal_whatsapp_mensajes(account_id,phone_id,external_id,contacto,direccion,tipo,estado,estado_fecha,fecha)
   VALUES(:account,:phone,:external,:contacto,'saliente','pendiente',:estado,:fecha,:fecha)
   ON CONFLICT(account_id,phone_id,external_id) DO UPDATE SET estado=EXCLUDED.estado,estado_fecha=EXCLUDED.estado_fecha
   WHERE (marca_personal_whatsapp_mensajes.estado_fecha IS NULL OR EXCLUDED.estado_fecha>=marca_personal_whatsapp_mensajes.estado_fecha)
   AND (CASE EXCLUDED.estado WHEN 'leido' THEN 5 WHEN 'entregado' THEN 4 WHEN 'error' THEN 3 WHEN 'enviado' THEN 2 ELSE 1 END)>=
       (CASE marca_personal_whatsapp_mensajes.estado WHEN 'leido' THEN 5 WHEN 'entregado' THEN 4 WHEN 'error' THEN 3 WHEN 'enviado' THEN 2 ELSE 1 END)`,{...scope(c),...m}));},
  conversaciones:(c,limite,offset)=>q(`SELECT x.contacto,COALESCE(x.nombre,
   (SELECT nombre FROM marca_personal_whatsapp_mensajes n WHERE n.account_id=:account AND n.phone_id=:phone AND n.contacto=x.contacto AND n.nombre IS NOT NULL ORDER BY n.id DESC LIMIT 1)) AS nombre,x.texto,x.tipo,x.estado,x.direccion,x.fecha,
   (SELECT MAX(fecha) FROM marca_personal_whatsapp_mensajes i WHERE i.account_id=:account AND i.phone_id=:phone AND i.contacto=x.contacto AND i.direccion='entrante') AS ultimo_entrante
   FROM (SELECT DISTINCT ON(contacto) contacto,nombre,texto,tipo,estado,direccion,fecha,id
    FROM marca_personal_whatsapp_mensajes WHERE account_id=:account AND phone_id=:phone AND tipo<>'pendiente'
    ORDER BY contacto,fecha DESC,id DESC) x ORDER BY x.fecha DESC,x.id DESC LIMIT :limite OFFSET :offset`,{...scope(c),limite,offset}),
  mensajes:(c,contacto,before,limite)=>q(`SELECT id,external_id,contacto,nombre,direccion,tipo,texto,estado,fecha FROM marca_personal_whatsapp_mensajes
   WHERE account_id=:account AND phone_id=:phone AND contacto=:contacto AND tipo<>'pendiente' AND (:before = 0 OR id < :before)
   ORDER BY id DESC LIMIT :limite`,{...scope(c),contacto,before,limite}),
  async ultimoEntrante(c,contacto){return (await q(`SELECT MAX(fecha) AS fecha FROM marca_personal_whatsapp_mensajes
   WHERE account_id=:account AND phone_id=:phone AND contacto=:contacto AND direccion='entrante'`,{...scope(c),contacto}))[0]?.fecha;},
 };
}
module.exports={createStore};
