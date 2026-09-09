'use strict';

/**
 * Rutas privadas del PAGE BUILDER.
 * Montadas en: /api/page-builder
 *
 * ⚠️ ACCESO: hoy el módulo es exclusivo del administrador. No alcanza con
 * verificarPermiso('gestionar_paginas'): ese middleware deja pasar al
 * admin PERO TAMBIÉN a cualquiera que tenga el permiso, y todavía no
 * queremos eso. El permiso ya existe en scripts/seed-permissions.js
 * justamente para que liberar el módulo sea cambiar las dos líneas de
 * abajo y nada más.
 *
 * ⚠️ Nada de esto depende de una Tienda: una página del builder es de un
 * USUARIO, existe sin tienda y se publica en el host propio del builder
 * (/p/<slug>, /f/<funnel>/<pagina>). Las rutas públicas son otras
 * (/api/pb y /pb, FASE 4) y no pasan por acá.
 */

const express = require('express');
const router = express.Router();

const { verificarToken } = require('../middleware/autenticacion');
const { soloAdministrador } = require('../middleware/soloAdministrador');
// const { verificarPermiso } = require('../middleware/autorizacion');

const proyectos = require('../controllers/builderProject.controller');
const funnels = require('../controllers/builderFunnel.controller');
const paginas = require('../controllers/builderPage.controller');
const hostnames = require('../controllers/builderDomain.controller');

router.use(verificarToken);
router.use(soloAdministrador);                          // ← hoy
// router.use(verificarPermiso('gestionar_paginas'));   // ← el día que se libere

// ─── Proyectos ────────────────────────────────────────────────────────
router.get('/proyectos', proyectos.listar);
router.post('/proyectos', proyectos.crear);
router.get('/proyectos/:id', proyectos.detalle);
router.put('/proyectos/:id', proyectos.actualizar);
router.delete('/proyectos/:id', proyectos.eliminar);

// Lo que cuelga de un proyecto: páginas sueltas y funnels.
router.post('/proyectos/:id/paginas', proyectos.crearPagina);
router.post('/proyectos/:id/funnels', proyectos.crearFunnel);

// ─── Funnels ──────────────────────────────────────────────────────────
// "/pages/order" y "/entry" van ANTES de "/pages/:pageId" — si no, Express
// matchearía "order" como un pageId.
router.put('/funnels/:id/pages/order', funnels.reordenar);
router.put('/funnels/:id/entry', funnels.definirEntrada);

router.get('/funnels/:id', funnels.detalle);
router.put('/funnels/:id', funnels.actualizar);
router.delete('/funnels/:id', funnels.eliminar);

router.post('/funnels/:id/pages', funnels.agregarPagina);
router.post('/funnels/:id/pages/:pageId', funnels.adjuntarPagina);
router.delete('/funnels/:id/pages/:pageId', funnels.quitarPagina);

router.post('/funnels/:id/publish', funnels.publicar);
router.post('/funnels/:id/unpublish', funnels.despublicar);

// ─── Páginas ──────────────────────────────────────────────────────────
router.get('/paginas/:id', paginas.detalle);
router.put('/paginas/:id', paginas.actualizar);
router.delete('/paginas/:id', paginas.eliminar);

// Código y versiones. GUARDAR es POST /versions: crea una versión draft y
// NO toca lo que ve el visitante. Publicar es el paso aparte de abajo.
router.post('/paginas/:id/importar', paginas.importar);
// Preview EN VIVO: resuelve los tokens de navegación contra código que
// todavía no se guardó. No persiste nada — ver builderPage.controller.js.
router.post('/paginas/:id/preview', paginas.preview);
router.post('/paginas/:id/versions', paginas.guardar);
router.get('/paginas/:id/versions', paginas.listarVersiones);
router.get('/paginas/:id/versions/:versionId', paginas.detalleVersion);
router.post('/paginas/:id/versions/:versionId/restore', paginas.restaurar);

// Lo único que mueve published_version_id.
router.post('/paginas/:id/publish', paginas.publicar);
router.post('/paginas/:id/unpublish', paginas.despublicar);

// ─── Hostnames ────────────────────────────────────────────────────────
// Dónde se publica cada página suelta o funnel: un subdominio de la
// plataforma (calcula.gesicomm.com) o el dominio propio del usuario
// (t2e.com.py). Ver builderDomain.service.js.
router.get('/hostnames', hostnames.listar);
router.post('/hostnames/subdominio', hostnames.crearSubdominio);
router.post('/hostnames/dominio-propio', hostnames.crearDominioPropio);
router.post('/hostnames/:id/verificar', hostnames.verificar);
router.patch('/hostnames/:id/habilitado', hostnames.habilitacion);
router.put('/hostnames/:id/principal', hostnames.definirPrincipal);
router.delete('/hostnames/:id', hostnames.eliminar);

module.exports = router;
