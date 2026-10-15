const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { resolverTiendaActiva } = require('../middleware/resolverTiendaActiva');
const ctrl = require('../controllers/importadaChinaController');

router.use(verificarToken);
router.use(resolverTiendaActiva);

router.post('/solicitudes', ctrl.solicitar);
router.get('/solicitudes', ctrl.listar);

module.exports = router;
