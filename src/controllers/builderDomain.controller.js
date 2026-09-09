'use strict';

/**
 * Controller de HOSTNAMES del Page Builder.
 * Montado en: /api/page-builder/hostnames
 *
 * Cada página suelta o funnel se publica en su propia dirección:
 * calcula.gesicomm.com, t2e.gesicomm.com, o el dominio propio del
 * usuario (t2e.com.py). Ver builderDomain.service.js.
 */

const BuilderDomainService = require('../services/builderDomain.service');
const { manejarError, duenoDe, contextoDe, idDeRuta } = require('./builderComun');

/** ?pagina_id= o ?funnel_id= para filtrar los de un target. */
async function listar(req, res) {
  try {
    return res.json(await BuilderDomainService.listar(duenoDe(req), req.query));
  } catch (err) {
    return manejarError(res, err, 'Error al listar los hostnames.');
  }
}

/** Body: { subdominio, pagina_id | funnel_id }. Publicable en el momento. */
async function crearSubdominio(req, res) {
  try {
    const hostname = await BuilderDomainService.crearSubdominio(contextoDe(req), req.body);
    return res.status(201).json(hostname);
  } catch (err) {
    return manejarError(res, err, 'Error al asignar el subdominio.');
  }
}

/** Body: { dominio, pagina_id | funnel_id }. Queda pendiente de verificar. */
async function crearDominioPropio(req, res) {
  try {
    const hostname = await BuilderDomainService.crearDominioPropio(contextoDe(req), req.body);
    return res.status(201).json(hostname);
  } catch (err) {
    return manejarError(res, err, 'Error al agregar el dominio propio.');
  }
}

async function verificar(req, res) {
  try {
    return res.json(await BuilderDomainService.verificar(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al verificar el dominio.');
  }
}

async function habilitacion(req, res) {
  try {
    if (typeof req.body.habilitado !== 'boolean') {
      return res.status(400).json({ message: 'Falta indicar si el hostname queda habilitado.' });
    }
    return res.json(await BuilderDomainService.cambiarHabilitacion(
      idDeRuta(req), duenoDe(req), req.body.habilitado,
    ));
  } catch (err) {
    return manejarError(res, err, 'Error al cambiar el estado del dominio.');
  }
}

async function definirPrincipal(req, res) {
  try {
    return res.json(await BuilderDomainService.definirPrincipal(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al definir la URL principal.');
  }
}

async function eliminar(req, res) {
  try {
    await BuilderDomainService.eliminar(idDeRuta(req), duenoDe(req));
    return res.json({ message: 'Hostname eliminado.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar el hostname.');
  }
}

module.exports = {
  listar, crearSubdominio, crearDominioPropio, verificar, habilitacion,
  definirPrincipal, eliminar,
};
