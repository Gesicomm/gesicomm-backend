const { Op } = require('sequelize');
const { Deposito, Envio } = require('../models');
const DepositoCourierService = require('../services/depositoCourier.service');
const { envolverControlador } = require('../utils/asyncHandler');

function valorTexto(body, ...campos) {
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(body, campo)) {
      const valor = body[campo];
      return valor ? String(valor).trim() : null;
    }
  }
  return null;
}

function normalizarPayload(body = {}) {
  const tipoPedido = String(body.tipo_ubicacion || body.tipoUbicacion || 'DEPOSITO').trim().toUpperCase();
  const tipo_ubicacion = ['SALON', 'DEPOSITO', 'FULFILLMENT'].includes(tipoPedido) ? tipoPedido : 'DEPOSITO';
  return {
    nombre: String(body.nombre || '').trim(),
    departamento: valorTexto(body, 'departamento'),
    ciudad: String(body.ciudad || '').trim(),
    direccion: String(body.direccion || '').trim(),
    referencia: valorTexto(body, 'referencia'),
    persona_contacto: valorTexto(body, 'personaContacto', 'persona_contacto'),
    telefono_contacto: valorTexto(body, 'telefonoContacto', 'telefono_contacto'),
    google_maps_url: valorTexto(body, 'googleMapsUrl', 'google_maps_url'),
    tipo_ubicacion,
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
      tipo_ubicacion,
      activo,
    } = req.body || {};

    const where = { usuario_id };
    if (req.usuario.tiendaId) where.tienda_id = req.usuario.tiendaId;

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
    if (tipo_ubicacion && String(tipo_ubicacion).trim()) {
      where.tipo_ubicacion = String(tipo_ubicacion).trim().toUpperCase();
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
    const where = { id, usuario_id };
    if (req.usuario.tiendaId) where.tienda_id = req.usuario.tiendaId;
    const deposito = await Deposito.findOne({ where });
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

    const deposito = await Deposito.create({ ...datos, usuario_id, tienda_id: req.usuario.tiendaId || null, activo: true });
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
    const where = { id, usuario_id };
    if (req.usuario.tiendaId) where.tienda_id = req.usuario.tiendaId;
    const deposito = await Deposito.findOne({ where });
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

    const whereActivo = { id, usuario_id };
    if (req.usuario.tiendaId) whereActivo.tienda_id = req.usuario.tiendaId;
    const deposito = await Deposito.findOne({ where: whereActivo });
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
    const where = { id, usuario_id };
    if (req.usuario.tiendaId) where.tienda_id = req.usuario.tiendaId;
    const deposito = await Deposito.findOne({ where });
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

/**
 * GET /api/depositos/:id/couriers — couriers que este comercio puede vincular
 * al depósito (los suyos + los de Gesicomm), marcando cuáles están
 * habilitados y cuánta cobertura tiene cada uno.
 */
exports.listarCouriers = async (req, res) => {
  try {
    const resultado = await DepositoCourierService.listarPorDeposito(req.params.id, req.usuario.id, req.usuario.tiendaId);
    res.json(resultado);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Error listando couriers del deposito:', error);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
};

/** PUT /api/depositos/:id/couriers — reemplaza los couriers habilitados. */
exports.reemplazarCouriers = async (req, res) => {
  try {
    const courierIds = Array.isArray(req.body?.courierIds) ? req.body.courierIds : [];
    const resultado = await DepositoCourierService.reemplazar(req.params.id, req.usuario.id, courierIds, req.usuario.tiendaId);
    res.json(resultado);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Error reemplazando couriers del deposito:', error);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
  }
};

// Todo lo que estos handlers no atrapen termina en el middleware de errores
// de server.js (500 + log) en vez de tumbar el proceso. Ver src/utils/asyncHandler.js.
envolverControlador(module.exports);
