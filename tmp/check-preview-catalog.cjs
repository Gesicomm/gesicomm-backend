require('dotenv').config({quiet:true});
process.env.NODE_ENV='test';
const db=require('../src/config/database');
db.options.logging=false;
(async()=>{
 const [users]=await db.query("SELECT id,inquilino_id FROM usuarios WHERE correo_electronico='andre@gmail.com'");
 const u=users[0];
 const data=await require('../src/services/precioUsuario.service').listarCatalogoPaginado(u.id,u.inquilino_id,{page:1,limit:10000,orden:'nombre',tipo:'producto',solamenteMios:false},false,69);
 require('fs').writeFileSync('tmp/llevalofacil-preview-products.json',JSON.stringify(data.items));
 console.log(JSON.stringify(data.items.slice(0,3).map(p=>({id:p.id,imagen:p.imagen,imagenes:p.imagenes}))));
 await db.close();
})().catch(e=>{console.error(e.stack);process.exit(1)});
