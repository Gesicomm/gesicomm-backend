const express = require('express');
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const { asyncHandler } = require('../utils/asyncHandler');
const service = require('../services/partner.service');
const PartnerSolicitud = require('../models/PartnerSolicitud');
const router = express.Router();

router.use(verificarToken);
router.get('/me', asyncHandler(async (req, res) => res.json(await service.obtener((req.comercioId || req.usuario.id)))));
router.post('/me', asyncHandler(async (req, res) => {
  const { solicitud, creada } = await service.solicitar((req.comercioId || req.usuario.id), req.body);
  res.status(creada ? 201 : 200).json({ solicitud });
}));
router.get('/solicitudes', soloAdministrador, asyncHandler(async (req, res) => {
  const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
  const { rows, count } = await PartnerSolicitud.findAndCountAll({
    order: [['created_at', 'DESC'], ['id', 'DESC']], limit: 20, offset: (pagina - 1) * 20,
  });
  res.json({ solicitudes: rows, total: count, pagina });
}));
module.exports = router;
