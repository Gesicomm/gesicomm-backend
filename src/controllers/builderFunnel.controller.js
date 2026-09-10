'use strict';

/**
 * Controller de FUNNELS del Page Builder.
 * Montado en: /api/page-builder/funnels
 *
 * ⚠️ No confundir con el embudo legacy de producto sobre la tabla
 * `landings`; ese flujo de creación ya fue retirado.
 */

const BuilderFunnelService = require('../services/builderFunnel.service');
const BuilderPublishService = require('../services/builderPublish.service');
const { manejarError, duenoDe, idDeRuta, idDeCuerpo } = require('./builderComun');

async function detalle(req, res) {
  try {
    return res.json(await BuilderFunnelService.obtener(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al obtener el funnel.');
  }
}

async function actualizar(req, res) {
  try {
    return res.json(await BuilderFunnelService.actualizar(idDeRuta(req), duenoDe(req), req.body));
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar el funnel.');
  }
}

async function eliminar(req, res) {
  try {
    await BuilderFunnelService.eliminar(idDeRuta(req), duenoDe(req));
    return res.json({ message: 'Funnel eliminado.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar el funnel.');
  }
}

/** Crea una página nueva al final del funnel. */
async function agregarPagina(req, res) {
  try {
    const funnel = await BuilderFunnelService.agregarPagina(idDeRuta(req), duenoDe(req), req.body);
    return res.status(201).json(funnel);
  } catch (err) {
    return manejarError(res, err, 'Error al agregar la página al funnel.');
  }
}

/** Mete al funnel una página suelta que ya existe. */
async function adjuntarPagina(req, res) {
  try {
    const funnel = await BuilderFunnelService.adjuntarPagina(
      idDeRuta(req), duenoDe(req), idDeRuta(req, 'pageId'),
    );
    return res.json(funnel);
  } catch (err) {
    return manejarError(res, err, 'Error al mover la página al funnel.');
  }
}

/** La saca del funnel. NO la borra: vuelve a ser una página suelta. */
async function quitarPagina(req, res) {
  try {
    const funnel = await BuilderFunnelService.quitarPagina(
      idDeRuta(req), duenoDe(req), idDeRuta(req, 'pageId'),
    );
    return res.json(funnel);
  } catch (err) {
    return manejarError(res, err, 'Error al sacar la página del funnel.');
  }
}

/**
 * Body: { orden: [pageId, pageId, ...] } — el array COMPLETO, no deltas.
 * Cada elemento se valida como entero acá: un valor no numérico colado en
 * el array llegaría a un `where: { pagina_id }` y reventaría en Postgres
 * en vez de responder un 422 legible.
 */
async function reordenar(req, res) {
  try {
    const orden = Array.isArray(req.body.orden) ? req.body.orden.map(Number) : null;
    if (!orden || orden.some(v => !Number.isInteger(v) || v <= 0)) {
      return res.status(422).json({ message: 'El orden tiene que ser una lista de ids de página.' });
    }
    const funnel = await BuilderFunnelService.reordenar(idDeRuta(req), duenoDe(req), orden);
    return res.json(funnel);
  } catch (err) {
    return manejarError(res, err, 'Error al reordenar el funnel.');
  }
}

/** Body: { pagina_id } — a dónde lleva /f/<slug> pelado. */
async function definirEntrada(req, res) {
  try {
    const paginaId = idDeCuerpo(req, 'pagina_id');
    if (!paginaId) return res.status(422).json({ message: '"pagina_id" es requerido.' });
    const funnel = await BuilderFunnelService.definirEntrada(idDeRuta(req), duenoDe(req), paginaId);
    return res.json(funnel);
  } catch (err) {
    return manejarError(res, err, 'Error al definir la página de entrada.');
  }
}

/**
 * Publica de una todas las páginas del funnel con borrador pendiente.
 * Cada página va en su propia transacción: una que falla (por ejemplo,
 * vacía) no frena a las demás. La respuesta dice qué pasó con cada una.
 */
async function publicar(req, res) {
  try {
    return res.json(await BuilderPublishService.publicarFunnel(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al publicar el funnel.');
  }
}

async function despublicar(req, res) {
  try {
    return res.json(await BuilderPublishService.despublicarFunnel(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al despublicar el funnel.');
  }
}

module.exports = {
  detalle, actualizar, eliminar,
  agregarPagina, adjuntarPagina, quitarPagina,
  reordenar, definirEntrada,
  publicar, despublicar,
};
