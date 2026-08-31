'use strict';

/**
 * Controller de PROYECTOS del Page Builder.
 * Montado en: /api/page-builder/proyectos
 *
 * Un proyecto agrupa páginas sueltas y funnels de un mismo usuario. No se
 * publica ni tiene URL pública.
 */

const BuilderProjectService = require('../services/builderProject.service');
const { manejarError, duenoDe, contextoDe, idDeRuta } = require('./builderComun');

async function listar(req, res) {
  try {
    return res.json(await BuilderProjectService.listar(duenoDe(req), req.query));
  } catch (err) {
    return manejarError(res, err, 'Error al listar los proyectos.');
  }
}

async function crear(req, res) {
  try {
    const proyecto = await BuilderProjectService.crear(contextoDe(req), req.body);
    return res.status(201).json(proyecto);
  } catch (err) {
    return manejarError(res, err, 'Error al crear el proyecto.');
  }
}

async function detalle(req, res) {
  try {
    return res.json(await BuilderProjectService.obtener(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al obtener el proyecto.');
  }
}

async function actualizar(req, res) {
  try {
    return res.json(await BuilderProjectService.actualizar(idDeRuta(req), duenoDe(req), req.body));
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar el proyecto.');
  }
}

async function eliminar(req, res) {
  try {
    await BuilderProjectService.eliminar(idDeRuta(req), duenoDe(req));
    return res.json({ message: 'Proyecto eliminado.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar el proyecto.');
  }
}

/** Página SUELTA del proyecto (/p/<slug>). */
async function crearPagina(req, res) {
  try {
    const pagina = await BuilderProjectService.crearPagina(idDeRuta(req), duenoDe(req), req.body);
    return res.status(201).json(pagina);
  } catch (err) {
    return manejarError(res, err, 'Error al crear la página.');
  }
}

async function crearFunnel(req, res) {
  try {
    const funnel = await BuilderProjectService.crearFunnel(idDeRuta(req), duenoDe(req), req.body);
    return res.status(201).json(funnel);
  } catch (err) {
    return manejarError(res, err, 'Error al crear el funnel.');
  }
}

module.exports = { listar, crear, detalle, actualizar, eliminar, crearPagina, crearFunnel };
