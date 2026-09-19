const { Op } = require('sequelize');
const { Deposito, Envio } = require('../models');

function normalizarPayload(body = {}) {
  return {
    nombre: String(body.nombre || '').trim(),
    departamento: body.departamento ? String(body.departamento).trim() : null,
    ciudad: String(body.ciudad || '').trim(),
    direccion: String(body.direccion || '').trim(),
    referencia: body.referencia ? String(body.referencia).trim() : null,
    persona_contacto: body.personaContacto ? String(body.personaContacto).trim() : null,
    telefono_contacto: body.telefonoContacto ? String(body.telefonoContacto).trim() : null,
    google_maps_url: body.googleMapsUrl ? String(body.googleMapsUrl).trim() : null,
  };
}

function validarCamposObligatorios(datos) {
  const faltantes = ['nombre', 'ciudad', 'direccion'].filter((campo) => !datos[campo]);
  return faltantes;
}

exports.listar = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const {
      page = 1,
      limit = 10,
      buscar,
      nombre,
      ciudad,
      departamento,
      personaContacto,
      activo,
    } = req.body || {};

    const where = { usuario_id };

    if (nombre && String(nombre).trim()) {
      where.nombre = { [Op.iLike]: `%${String(nombre).trim()}%` };
    }
    if (ciudad && String(ciudad).trim()) {
      where.ciudad = { [Op.iLike]: `%${String(ciudad).trim()}%` };
    }
    if (departamento && String(departamento).trim()) {
      where.departamento = { [Op.iLike]: `%${String(departamento).trim()}%` };
    }
    if (personaContacto && String(personaContacto).trim()) {
      where.persona_contacto = { [Op.iLike]: `%${String(personaContacto).trim()}%` };
    }
    if (typeof activo === 'boolean') {
      where.activo = activo;
    }

    if (buscar && String(buscar).trim()) {
      const term = `%${String(buscar).trim()}%`;
      where[Op.or] = [
        { nombre: { [Op.iLike]: term } },
        { direccion: { [Op.iLike]: term } },
        { referencia: { [Op.iLike]: term } },
        { persona_contacto: { [Op.iLike]: term } },
        { telefono_contacto: { [Op.iLike]: term } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const { count, rows } = await Deposito.findAndCountAll({
      where,
      order: [['nombre', 'ASC']],
      limit: limitNum,
      offset,
    });

    res.json({
      data: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
    });
  } catch (error) {
    console.error('Error listando depositos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.obtenerPorId = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const deposito = await Deposito.findOne({ where: { id, usuario_id } });
    if (!deposito) return res.status(404).json({ error: 'Depósito no encontrado' });
    res.json(deposito);
  } catch (error) {
    console.error('Error obteniendo deposito:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.crear = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const datos = normalizarPayload(req.body);

    const faltantes = validarCamposObligatorios(datos);
    if (faltantes.length > 0) {
      return res.status(400).json({ error: `Faltan campos obligatorios: ${faltantes.join(', ')}` });
    }

    const deposito = await Deposito.create({ ...datos, usuario_id, activo: true });
    res.status(201).json(deposito);
  } catch (error) {
    console.error('Error creando deposito:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.editar = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const deposito = await Deposito.findOne({ where: { id, usuario_id } });
    if (!deposito) return res.status(404).json({ error: 'Depósito no encontrado' });

    const datos = normalizarPayload({ ...deposito.toJSON(), ...req.body });
    const faltantes = validarCamposObligatorios(datos);
    if (faltantes.length > 0) {
      return res.status(400).json({ error: `Faltan campos obligatorios: ${faltantes.join(', ')}` });
    }

    await deposito.update(datos);
    res.json(deposito);
  } catch (error) {
    console.error('Error editando deposito:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.cambiarEstado = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { activo } = req.body || {};
    if (typeof activo !== 'boolean') {
      return res.status(400).json({ error: 'El campo activo es obligatorio y debe ser booleano' });
    }

    const deposito = await Deposito.findOne({ where: { id, usuario_id } });
    if (!deposito) return res.status(404).json({ error: 'Depósito no encontrado' });

    await deposito.update({ activo });
    res.json(deposito);
  } catch (error) {
    console.error('Error cambiando estado de deposito:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.eliminar = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const deposito = await Deposito.findOne({ where: { id, usuario_id } });
    if (!deposito) return res.status(404).json({ error: 'Depósito no encontrado' });

    const usosHistoricos = await Envio.count({ where: { deposito_destino_id: deposito.id } });
    if (usosHistoricos > 0) {
      await deposito.update({ activo: false });
      return res.json({ success: true, message: 'El depósito tiene abastecimientos asociados: se marcó como inactivo en lugar de eliminarse.', deposito });
    }

    await deposito.destroy();
    res.json({ success: true, message: 'Depósito eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando deposito:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
