require('dotenv').config({quiet:true});
const {Client}=require('pg');
const c=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionTimeoutMillis:8000});
(async()=>{
 await c.connect();
 const {rows:[u]}=await c.query("SELECT u.id,u.inquilino_id,r.nombre AS rol FROM usuarios u LEFT JOIN roles r ON r.id=u.rol_id WHERE u.correo_electronico=$1",['andre@gmail.com']);
 await c.end();
 const token=require('jsonwebtoken').sign({id:u.id,tenantId:u.inquilino_id,rol:u.rol,permisos:['ver_productos','gestionar_landing'],tiendaId:69},process.env.JWT_SECRET,{expiresIn:'5m'});
 const r=await fetch('https://api.gesicomm.com/api/vitrina/catalogo-paginado',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({page:1,limit:10000,orden:'nombre',tipo:'producto',solamenteMios:false}),signal:AbortSignal.timeout(45000)});
 const data=await r.json();
 require('fs').writeFileSync('tmp/live-preview-catalog.json',JSON.stringify(data));
 console.log(r.status,JSON.stringify(data.items?.slice(0,3).map(p=>({id:p.id,imagen:p.imagen,imagenes:p.imagenes})))||JSON.stringify(data));
})().catch(e=>{console.error(e.message);process.exit(1)});
