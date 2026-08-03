const express = require('express');
const router = express.Router();
const adminEducacionController = require('../controllers/adminEducacionController');
const { verificarToken } = require('../middleware/autenticacion');

// Rutas de administración
router.use(verificarToken);

router.get('/modulos', adminEducacionController.listModulos);
router.post('/modulos', adminEducacionController.createModulo);
router.post('/modulos/reordenar', adminEducacionController.reordenarModulos);
router.post('/modulos/:id/duplicar', adminEducacionController.duplicarModulo);
router.put('/modulos/:id', adminEducacionController.updateModulo);
router.delete('/modulos/:id', adminEducacionController.deleteModulo);

module.exports = router;
