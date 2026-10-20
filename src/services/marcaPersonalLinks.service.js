'use strict';
const {MarcaPersonalError}=require('./marcaPersonal.client');
function normalizeLinks(input){
 if(!Array.isArray(input)||input.length>50)throw new MarcaPersonalError('Podés guardar hasta 50 enlaces.',400);
 return input.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw new MarcaPersonalError('Enlace inválido.',400);
  const {title,description='',url}=item;
  if(typeof title!=='string'||!title.trim()||title.trim().length>100||typeof description!=='string'||description.trim().length>240||typeof url!=='string'||url.trim().length>2048)throw new MarcaPersonalError('Revisá el nombre, la descripción y la URL de cada enlace.',400);
  let parsed;try{parsed=new URL(url.trim());}catch{throw new MarcaPersonalError('Ingresá una URL completa con https:// o http://.',400);}
  if(!['https:','http:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password)throw new MarcaPersonalError('Usá enlaces web sin credenciales, con https:// o http://.',400);
  return {title:title.trim(),description:description.trim(),url:parsed.href};
 });
}
function databaseStore(){
 const db=require('../config/database');
 return {
  async read(account){const [rows]=await db.query('SELECT links, version FROM marca_personal_commercial_links WHERE account_id=:account',{replacements:{account}});return rows[0]||{links:[],version:0};},
  async write(user,account,links,version){
   return db.transaction(async transaction=>{
    const replacements={user,account,links:JSON.stringify(links),version};
    await db.query('INSERT INTO marca_personal_commercial_links (account_id,creado_por) VALUES (:account,:user) ON CONFLICT (account_id) DO NOTHING',{replacements,transaction});
    const [rows]=await db.query('UPDATE marca_personal_commercial_links SET links=CAST(:links AS JSONB), version=version+1, updated_at=NOW() WHERE account_id=:account AND version=:version RETURNING links,version',{replacements,transaction});
    if(!rows.length)throw new MarcaPersonalError('Los enlaces cambiaron en otra ventana. Recargá antes de guardar.',409);
    return rows[0];
   });
  }
 };
}
function createService({identity,remote,store}={}){
 const userService=()=>require('./marcaPersonal.service');
 async function authorize(user,account){
  if(typeof account!=='string'||!/^[-a-z0-9]{1,80}$/i.test(account))throw new MarcaPersonalError('Seleccioná una marca válida.',400);
  const profile=await(identity||userService().identity)(user);
  if(!profile?.enabled)throw new MarcaPersonalError('Tu acceso de Gesicomm no está activo.',403);
  if(!await(remote||userService().remote)().accountAccess(user,account))throw new MarcaPersonalError('No tenés permiso para editar enlaces de esta marca.',403);
 }
 return {
  async read(user,account){await authorize(user,account);return (store||databaseStore()).read(account);},
  async write(user,account,body){
   const links=normalizeLinks(body?.links),version=body?.version;
   if(!Number.isSafeInteger(version)||version<0)throw new MarcaPersonalError('Versión de enlaces inválida. Recargá la página.',400);
   await authorize(user,account);return (store||databaseStore()).write(user,account,links,version);
  }
 };
}
module.exports={normalizeLinks,createService,...createService()};
