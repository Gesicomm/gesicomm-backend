jest.mock('../services/marcaPersonalWhatsapp.service',()=>({recibir:jest.fn(async()=>{})}));
jest.mock('../utils/logger',()=>({logger:{error:jest.fn()}}));
const express=require('express'),request=require('supertest'),crypto=require('crypto');
const service=require('../services/marcaPersonalWhatsapp.service');
const app=express();app.use('/hook',require('../routes/marcaPersonalWhatsappWebhook'));app.use(express.json());
const body=JSON.stringify({object:'whatsapp_business_account',entry:[]});
const sign=text=>'sha256='+crypto.createHmac('sha256','secret-test').update(text).digest('hex');
beforeEach(()=>{jest.clearAllMocks();process.env.FACEBOOK_APP_SECRET='secret-test';process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN='verify-test';});
test('challenge sólo con token correcto y formato esperado',async()=>{
 await request(app).get('/hook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123').expect(403);
 const r=await request(app).get('/hook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=123').expect(200);expect(r.text).toBe('123');
 await request(app).get('/hook?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge[]=123').expect(400);
});
test('rechaza una firma ausente, falsa o que no corresponde a los bytes originales',async()=>{
 await request(app).post('/hook').send(JSON.parse(body)).expect(403);
 await request(app).post('/hook').set('x-hub-signature-256',sign(body+' ')).set('Content-Type','application/json').send(body).expect(403);
 expect(service.recibir).not.toHaveBeenCalled();
});
test('procesa el cuerpo firmado y no confirma si falla el almacenamiento',async()=>{
 await request(app).post('/hook').set('x-hub-signature-256',sign(body)).set('Content-Type','application/json').send(body).expect(200);expect(service.recibir).toHaveBeenCalledWith(JSON.parse(body));
 service.recibir.mockRejectedValueOnce(Error('DB'));await request(app).post('/hook').set('x-hub-signature-256',sign(body)).set('Content-Type','application/json').send(body).expect(503);
});
