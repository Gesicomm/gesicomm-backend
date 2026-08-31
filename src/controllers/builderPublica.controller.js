'use strict';

/**
 * Controller PÚBLICO del Page Builder — SIN verificarToken.
 * Montado en: /api/pb
 *
 * Devuelve el código de la versión PUBLICADA para que el frontend lo
 * pinte dentro del iframe sandbox (CodigoPreview), el mismo componente
 * que usa el editor.
 *
 * El preview del borrador es la única ruta de acá que mira la sesión, y
 * exige que sea la del dueño de la página.
 */

const jwt = require('jsonwebtoken');

const BuilderPublicPageService = require('../services/builderPublicPage.service');

function responderError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[pb-publico]', err);
  return res.status(status).json({
    message: err.message || 'Error al cargar la página.',
    en_construccion: !!err.enConstruccion,
  });
}

/**
 * Raíz del hostname del builder, o un paso del funnel que sirve ese
 * hostname. req.builderHost lo dejó el middleware resolverHostBuilder.
 */
async function porHostname(req, res) {
  try {
    if (!req.builderHost) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna página.' });
    }
    const resultado = await BuilderPublicPageService.porHostname(
      req.builderHost, req.params.pageSlug || null,
    );
    return res.json(resultado);
  } catch (err) {
    return responderError(res, err);
  }
}

/** Fallback /p/:slug — página suelta en el host de la app. */
async function porSlugSuelto(req, res) {
  try {
    return res.json(await BuilderPublicPageService.porSlugSuelto(req.params.slug));
  } catch (err) {
    return responderError(res, err);
  }
}

/** Fallback /f/:funnelSlug[/:pageSlug]. */
async function porSlugDeFunnel(req, res) {
  try {
    return res.json(await BuilderPublicPageService.porSlugDeFunnel(
      req.params.funnelSlug, req.params.pageSlug || null,
    ));
  } catch (err) {
    return responderError(res, err);
  }
}

/**
 * Preview del BORRADOR. Solo para el dueño: se lee la cookie de sesión y
 * se compara con el dueño de la página. Sin sesión válida, 404 — no 401:
 * desde afuera esta página no existe.
 */
async function preview(req, res) {
  try {
    const token = req.cookies?.accessToken;
    if (!token) return res.status(404).json({ message: 'Página no encontrada.' });

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(404).json({ message: 'Página no encontrada.' });
    }

    const resultado = await BuilderPublicPageService.obtenerPreview(req.params.id, payload.id);
    return res.json(resultado);
  } catch (err) {
    return responderError(res, err);
  }
}

module.exports = { porHostname, porSlugSuelto, porSlugDeFunnel, preview };
