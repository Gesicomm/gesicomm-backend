'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verificarToken } = require('../middleware/autenticacion');
const service = require('../services/marcaPersonal.service');
const router = express.Router();
const origins = new Set(['https://automation.gesicomm.com']);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  res.set('Pragma', 'no-cache');
  res.vary('Cookie'); res.vary('Origin');
  // El navegador sólo puede iniciar este intercambio desde nuestra copia de T2E.
  if (!origins.has(req.get('origin'))) return res.status(403).json({ message: 'Origen no permitido.' });
  next();
});
router.use(verificarToken);
router.use(rateLimit({ windowMs: 60000, max: 30, keyGenerator:req=>String(req.usuario.id), standardHeaders: true, legacyHeaders: false }));
function handle(operation) {
  return async (req, res) => {
    try { res.json(await operation(req.usuario.id)); }
    catch (error) {
      const status = [400,401,403,409,503].includes(error.status) ? error.status : 503;
      res.status(status).json({ message: error.status ? error.message : 'Marca Personal está temporalmente en mantenimiento.' });
    }
  };
}
router.post('/session', handle(service.openSession));
router.get('/status', handle(service.status));
const links=require('../services/marcaPersonalLinks.service');
for(const method of ['get','put'])router[method]('/commercial-links',async(req,res)=>{
  try{
    res.json(await(method==='get'?links.read(req.usuario.id,req.query.account_id):links.write(req.usuario.id,req.query.account_id,req.body)));
  }catch(error){
    const status=[400,401,403,409].includes(error.status)?error.status:503;
    res.status(status).json({message:error.status?error.message:'No pudimos guardar o cargar los enlaces. Reintentá.'});
  }
});
module.exports = router;
