const { Op } = require('sequelize');
const { sequelize, Envio, EnvioItem, MetodoPago } = require('../models');
const envioController = require('./envioController');
const { registrarHistorial } = require('../utils/historial');
const { envolverControlador } = require('../utils/asyncHandler');

const DEFAULT_METODOS = [
  { nombre: 'Efectivo contra entrega', comision_porcentaje: 0, es_anticipado: false, custodia_cobro: 'courier', orden: 1 },
  { nombre: 'Transferencia bancaria', comision_porcentaje: 0, es_anticipado: true, custodia_cobro: 'negocio', orden: 2 },
  { nombre: 'POS / Tarjeta', comision_porcentaje: 2.2, es_anticipado: true, custodia_cobro: 'negocio', orden: 3 },
  { nombre: 'Crédito', comision_porcentaje: 5, es_anticipado: true, custodia_cobro: 'negocio', orden: 4 },
];

function montoVisibleACobrar(envio) {
  if (envio.pago_anticipado) return 0;
  const monto = Number(envio.monto) || 0;
  const costoEnvio = envio.delivery_a_cargo === 'cliente' ? Number(envio.costo_envio) || 0 : 0;
  return monto + costoEnvio;
}

function serializarEnvio(envio) {
  const plain = envio.toJSON ? envio.toJSON() : envio;
  return {
    ...plain,
    monto_visible_a_cobrar: montoVisibleACobrar(plain),
    pendiente_cobro: plain.estado !== 'Entregado' && plain.estado !== 'Perdido' && !plain.pago_anticipado,
  };
}

async function buscarEnvioDelCourier(req, id, transaction = null) {
  return Envio.findOne({
    where: {
      id,
      usuario_id: req.courier.usuarioId,
      courier_id: req.courier.courierId,
    },
    include: [{ model: EnvioItem, as: 'items' }],
    transaction,
  });
}

function ejecutarUpdateEstado(reqOriginal, body) {
  return new Promise((resolve, reject) => {
    const req = {
      ...reqOriginal,
      usuario: { id: reqOriginal.courier.usuarioId },
      params: { id: reqOriginal.params.id },
      body,
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
    };

    Promise.resolve(envioController.updateEstado(req, res)).catch(reject);
  });
}

async function asegurarMetodos(usuarioId) {
  let metodos = await MetodoPago.findAll({
    where: { usuario_id: usuarioId },
    order: [['orden', 'ASC'], ['id', 'ASC']],
  });
  if (metodos.length === 0) {
    await MetodoPago.bulkCreate(DEFAULT_METODOS.map(m => ({ ...m, usuario_id: usuarioId })));
    metodos = await MetodoPago.findAll({
      where: { usuario_id: usuarioId },
      order: [['orden', 'ASC'], ['id', 'ASC']],
    });
  }
  return metodos;
}

exports.listPedidos = async (req, res) => {
  const pedidos = await Envio.findAll({
    where: {
      usuario_id: req.courier.usuarioId,
      courier_id: req.courier.courierId,
      estado: { [Op.in]: ['Despachado', 'Reprogramado', 'Entregado', 'Perdido'] },
    },
    include: [
      { model: EnvioItem, as: 'items' },
      { model: MetodoPago, required: false },
    ],
    order: [['updated_at', 'DESC'], ['id', 'DESC']],
    limit: 200,
  });

  res.json(pedidos.map(serializarEnvio));
};

exports.listMetodosPago = async (req, res) => {
  const metodos = await asegurarMetodos(req.courier.usuarioId);
  res.json(metodos.filter(m => m.activo !== false));
};

exports.marcarEntregado = async (req, res) => {
  const envio = await buscarEnvioDelCourier(req, req.params.id);
  if (!envio) return res.status(404).json({ error: 'Pedido no encontrado para este courier.' });
  if (envio.estado !== 'Despachado' && envio.estado !== 'Reprogramado') {
    return res.status(400).json({ error: 'Solo se pueden entregar pedidos despachados o reprogramados.' });
  }

  const metodoPagoId = Number(req.body?.metodo_pago_id) || null;
  if (!metodoPagoId) return res.status(400).json({ error: 'El método de pago es obligatorio.' });

  const montoCobrado = req.body?.monto_cobrado === undefined
    ? montoVisibleACobrar(envio)
    : Math.max(0, Number(req.body.monto_cobrado) || 0);
  const costoEnvio = Number(envio.costo_envio) || 0;
  const montoPedido = envio.delivery_a_cargo === 'cliente'
    ? Math.max(0, montoCobrado - costoEnvio)
    : montoCobrado;

  const resultado = await ejecutarUpdateEstado(req, {
    estado: 'Entregado',
    metodo_pago_id: metodoPagoId,
    monto: montoPedido,
    costo_envio: costoEnvio,
  });

  if (resultado.statusCode >= 400) return res.status(resultado.statusCode).json(resultado.payload);

  const observacion = String(req.body?.observacion || '').trim();
  if (observacion) {
    await registrarHistorial(envio.id, req.courier.usuarioId, `Observación courier: ${observacion}`, null, {
      actorTipo: 'courier',
      metadata: { courier_id: req.courier.courierId },
    });
  }

  return res.status(resultado.statusCode).json(serializarEnvio(resultado.payload));
};

exports.marcarReprogramado = async (req, res) => {
  const envio = await buscarEnvioDelCourier(req, req.params.id);
  if (!envio) return res.status(404).json({ error: 'Pedido no encontrado para este courier.' });
  if (envio.estado !== 'Despachado') {
    return res.status(400).json({ error: 'Solo se pueden reprogramar pedidos despachados.' });
  }

  const fecha = req.body?.fecha_reprogramada;
  if (!fecha) return res.status(400).json({ error: 'La fecha de reprogramación es obligatoria.' });

  const resultado = await ejecutarUpdateEstado(req, {
    estado: 'Reprogramado',
    fecha_reprogramada: fecha,
    motivo_reprogramacion: String(req.body?.motivo || '').trim() || 'Reportado por courier',
    costo_intento: req.body?.costo_intento === undefined ? 0 : Number(req.body.costo_intento) || 0,
  });

  if (resultado.statusCode >= 400) return res.status(resultado.statusCode).json(resultado.payload);
  return res.status(resultado.statusCode).json(serializarEnvio(resultado.payload));
};

exports.marcarNoEntregado = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const envio = await buscarEnvioDelCourier(req, req.params.id, t);
    if (!envio) {
      await t.rollback();
      return res.status(404).json({ error: 'Pedido no encontrado para este courier.' });
    }
    if (envio.estado !== 'Despachado') {
      await t.rollback();
      return res.status(400).json({ error: 'Solo se puede reportar no entregado desde Despachado.' });
    }

    const motivo = String(req.body?.motivo || '').trim();
    if (!motivo) {
      await t.rollback();
      return res.status(400).json({ error: 'El motivo es obligatorio.' });
    }

    await registrarHistorial(envio.id, req.courier.usuarioId, `No entregado por courier: ${motivo}`, t, {
      actorTipo: 'courier',
      metadata: { courier_id: req.courier.courierId },
    });
    await t.commit();
    return res.json(serializarEnvio(envio));
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

envolverControlador(module.exports);
