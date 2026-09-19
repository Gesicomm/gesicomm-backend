const express = require('express');
const router = express.Router();
const depositoController = require('../controllers/depositoController');
const { verificarToken } = require('../middleware/autenticacion');

router.use(verificarToken);

// Listado paginado con filtros dinámicos (ver RF Gestión de Depósitos)
router.post('/listado', depositoController.listar);

router.get('/:id', depositoController.obtenerPorId);
router.post('/', depositoController.crear);
router.put('/:id', depositoController.editar);
router.patch('/:id/estado', depositoController.cambiarEstado);
router.delete('/:id', depositoController.eliminar);

module.exports = router;
