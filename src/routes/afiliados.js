const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
const ctrl = require('../controllers/afiliados.controller');

router.post('/track', ctrl.registrarClick);

router.use(verificarToken);

router.get('/me', ctrl.miAfiliado);
router.post('/me', ctrl.solicitarMiAfiliado);

router.use(soloAdministrador);

router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.put('/:id', ctrl.actualizar);
router.delete('/:id', ctrl.eliminar);
router.get('/comisiones/listado', ctrl.listarComisiones);
router.put('/comisiones/:id', ctrl.actualizarComision);

module.exports = router;
