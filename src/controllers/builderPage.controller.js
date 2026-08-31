'use strict';

/**
 * Controller de PÁGINAS del Page Builder: identidad, código, versiones y
 * publicación.
 * Montado en: /api/page-builder/paginas
 *
 * El flujo que sostiene todo esto:
 *
 *   GET  /paginas/:id            → la página + el código de su BORRADOR
 *   POST /paginas/:id/importar   → pegar un HTML entero y repartirlo
 *   POST /paginas/:id/versions   → GUARDAR (versión nueva, no publica)
 *   POST /paginas/:id/publish    → recién acá cambia lo que ve el visitante
 */

const BuilderPageService = require('../services/builderPage.service');
const BuilderPageVersionService = require('../services/builderPageVersion.service');
const BuilderPublishService = require('../services/builderPublish.service');
const { manejarError, duenoDe, idDeRuta, idDeCuerpo } = require('./builderComun');

// ─── Identidad ────────────────────────────────────────────────────────

async function detalle(req, res) {
  try {
    return res.json(await BuilderPageVersionService.obtenerConCodigo(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al obtener la página.');
  }
}

async function actualizar(req, res) {
  try {
    return res.json(await BuilderPageService.actualizar(idDeRuta(req), duenoDe(req), req.body));
  } catch (err) {
    return manejarError(res, err, 'Error al actualizar la página.');
  }
}

async function eliminar(req, res) {
  try {
    await BuilderPageService.eliminar(idDeRuta(req), duenoDe(req));
    return res.json({ message: 'Página eliminada.' });
  } catch (err) {
    return manejarError(res, err, 'Error al eliminar la página.');
  }
}

// ─── Código y versiones ───────────────────────────────────────────────

/** Body: { documento }. Devuelve el reparto en HTML/CSS/JS SIN guardarlo. */
async function importar(req, res) {
  try {
    const resultado = await BuilderPageVersionService.importar(
      idDeRuta(req), duenoDe(req), req.body.documento,
    );
    return res.json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al importar el HTML.');
  }
}

/** GUARDAR. Body: { html, css, js, nota? }. Crea una versión draft. */
async function guardar(req, res) {
  try {
    const resultado = await BuilderPageVersionService.guardar(
      idDeRuta(req), duenoDe(req), req.body,
    );
    return res.status(201).json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al guardar la página.');
  }
}

/**
 * El preview EN VIVO del editor: resuelve los tokens de navegación
 * ({{siguiente}}, {{cta}}, ...) contra código que todavía no se guardó.
 *
 * Sin esto, el iframe del editor mostraba el href literal "{{siguiente}}"
 * — al hacer clic, el navegador navegaba a esa URL tal cual, React
 * Router la tomaba como :id de una ruta, y terminaba en un
 * "invalid input syntax for type integer" en Postgres. Acá se resuelve
 * ANTES de que ese HTML llegue al iframe, así el preview nunca contiene
 * un token crudo — el mismo comportamiento que ya tiene la página pública.
 *
 * NO guarda nada.
 */
async function preview(req, res) {
  try {
    const resultado = await BuilderPageVersionService.previsualizar(
      idDeRuta(req), duenoDe(req), req.body,
    );
    return res.json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al generar la vista previa.');
  }
}

async function listarVersiones(req, res) {
  try {
    return res.json(await BuilderPageVersionService.listar(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al listar las versiones.');
  }
}

async function detalleVersion(req, res) {
  try {
    return res.json(await BuilderPageVersionService.obtenerVersion(
      idDeRuta(req), idDeRuta(req, 'versionId'), duenoDe(req),
    ));
  } catch (err) {
    return manejarError(res, err, 'Error al obtener la versión.');
  }
}

/** Copia una versión vieja como borrador nuevo. No publica. */
async function restaurar(req, res) {
  try {
    const resultado = await BuilderPageVersionService.restaurar(
      idDeRuta(req), idDeRuta(req, 'versionId'), duenoDe(req),
    );
    return res.status(201).json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al restaurar la versión.');
  }
}

// ─── Publicación ──────────────────────────────────────────────────────

/** Body: { version_id? }. Sin version_id, publica el borrador actual. */
async function publicar(req, res) {
  try {
    const resultado = await BuilderPublishService.publicar(
      idDeRuta(req), duenoDe(req), idDeCuerpo(req, 'version_id'),
    );
    return res.json(resultado);
  } catch (err) {
    return manejarError(res, err, 'Error al publicar la página.');
  }
}

async function despublicar(req, res) {
  try {
    return res.json(await BuilderPublishService.despublicar(idDeRuta(req), duenoDe(req)));
  } catch (err) {
    return manejarError(res, err, 'Error al despublicar la página.');
  }
}

module.exports = {
  detalle, actualizar, eliminar,
  importar, guardar, preview, listarVersiones, detalleVersion, restaurar,
  publicar, despublicar,
};
