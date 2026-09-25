const PageService = require('../services/page.service');
const { resolverTiendaPropia } = require('./landingSimple.controller'); // Reuse auth/tenant resolution

async function list(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const { page, limit, estado } = req.body;
    const result = await PageService.list(tienda.id, { page, limit, estado });
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function create(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const created = await PageService.create(tienda.id, req.body, req.usuario.id);
    res.json(created);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function getById(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const page = await PageService.getById(req.params.id, tienda.id);
    res.json(page);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function createVersion(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const version = await PageService.createVersion(req.params.id, tienda.id, req.body, req.usuario.id);
    res.json(version);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function listVersions(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const versions = await PageService.listVersions(req.params.id, tienda.id);
    res.json(versions);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function publish(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const { version_id } = req.body;
    const page = await PageService.publish(req.params.id, tienda.id, version_id);
    res.json(page);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

async function rollback(req, res) {
  try {
    const tienda = await resolverTiendaPropia(req, res);
    if (!tienda) return;
    const { target_version_id } = req.body;
    const version = await PageService.rollback(req.params.id, tienda.id, target_version_id, req.usuario.id);
    res.json(version);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}

module.exports = {
  list,
  create,
  getById,
  createVersion,
  listVersions,
  publish,
  rollback
};
