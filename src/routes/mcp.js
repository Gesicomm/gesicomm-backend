'use strict';

/**
 * Rutas de la API MCP (Model Context Protocol).
 * Permite a agentes de IA (Claude, Codex, Cursor) conectarse al motor comercial
 * de Gesicomm para consultar catálogo, validar directivas y actualizar landings.
 * Montadas en: /api/mcp
 */

const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/autenticacion');
const ctrl = require('../controllers/mcp.controller');

router.use(verificarToken);

router.post('/token', ctrl.generarToken);
router.get('/landings', ctrl.listarLandings);
router.get('/landings/:id/contexto', ctrl.obtenerContexto);
router.get('/landings/:id/codigo', ctrl.obtenerCodigo);
router.post('/landings/:id/validar', ctrl.validarCodigo);
router.post('/landings/:id/codigo', ctrl.guardarCodigo);

module.exports = router;
