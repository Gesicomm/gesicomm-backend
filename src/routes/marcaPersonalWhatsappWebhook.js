'use strict';
const express=require('express'),crypto=require('crypto');
const service=require('../services/marcaPersonalWhatsapp.service');
const {logger}=require('../utils/logger');
const router=express.Router();
router.use(require('express-rate-limit')({windowMs:60000,max:600,standardHeaders:true,legacyHeaders:false}));
const igual=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&crypto.timingSafeEqual(x,y);};
router.get('/',(req,res)=>{
 const token=process.env.MARCA_PERSONAL_WHATSAPP_VERIFY_TOKEN;
 if(!token)return res.sendStatus(503);
 if(req.query['hub.mode']!=='subscribe'||typeof req.query['hub.verify_token']!=='string'||!igual(req.query['hub.verify_token'],token))return res.sendStatus(403);
 const challenge=req.query['hub.challenge'];if(typeof challenge!=='string'||!/^\d{1,200}$/.test(challenge))return res.sendStatus(400);
 return res.type('text/plain').send(challenge);
});
// Montar antes del parser JSON global: la firma se calcula sobre estos bytes.
router.post('/',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
 const secret=process.env.FACEBOOK_APP_SECRET;
 if(!secret)return res.sendStatus(503);
 const signature=req.get('x-hub-signature-256');
 if(!Buffer.isBuffer(req.body)||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return res.sendStatus(403);
 const expected='sha256='+crypto.createHmac('sha256',secret).update(req.body).digest('hex');
 if(!igual(signature,expected))return res.sendStatus(403);
 let payload;try{payload=JSON.parse(req.body.toString('utf8'));}catch{return res.sendStatus(400);}
 try{await service.recibir(payload);return res.sendStatus(200);}
 catch{logger.error({mensaje:'No se pudo registrar un evento de la bandeja WhatsApp'});return res.sendStatus(503);}
});
module.exports=router;
