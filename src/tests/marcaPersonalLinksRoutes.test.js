'use strict';
const request=require('supertest'),express=require('express');
jest.mock('../middleware/autenticacion',()=>({verificarToken(req,res,next){if(!req.get('x-test-user'))return res.status(401).json({message:'No autenticado'});req.usuario={id:41};next();}}));
jest.mock('../services/marcaPersonalLinks.service',()=>({read:jest.fn(async()=>({links:[],version:0})),write:jest.fn(async()=>({links:[],version:1}))}));
const links=require('../services/marcaPersonalLinks.service'),router=require('../routes/marcaPersonalSso');
const app=express();app.use(express.json());app.use(router);
test('rechaza un origen distinto y una petición sin sesión',async()=>{
 await request(app).get('/commercial-links?account_id=marca-a').set('Origin','https://otro.example').expect(403);
 await request(app).get('/commercial-links?account_id=marca-a').set('Origin','https://automation.gesicomm.com').expect(401);
 expect(links.read).not.toHaveBeenCalled();
});
test('usa la identidad de sesión e ignora identidades enviadas en el cuerpo',async()=>{
 await request(app).put('/commercial-links?account_id=marca-a').set('Origin','https://automation.gesicomm.com').set('x-test-user','sí').send({user_id:999,links:[],version:0}).expect(200);
 expect(links.write).toHaveBeenCalledWith(41,'marca-a',expect.objectContaining({user_id:999}));
});
test('devuelve conflicto sin exponer fallas internas del servidor',async()=>{
 links.write.mockRejectedValueOnce(Object.assign(Error('Recargá'),{status:409}));
 await request(app).put('/commercial-links?account_id=marca-a').set('Origin','https://automation.gesicomm.com').set('x-test-user','sí').send({links:[],version:0}).expect(409);
 links.read.mockRejectedValueOnce(Error('database-secret'));
 const response=await request(app).get('/commercial-links?account_id=marca-a').set('Origin','https://automation.gesicomm.com').set('x-test-user','sí').expect(503);
 expect(JSON.stringify(response.body)).not.toContain('database-secret');
});
