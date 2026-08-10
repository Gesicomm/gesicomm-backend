const { MetodoPago, Envio } = require('../models');

const DEFAULTS = [
  { nombre: 'Efectivo contra entrega', comision_porcentaje: 0, es_anticipado: false, custodia_cobro: 'courier', orden: 1 },
  { nombre: 'Transferencia bancaria', comision_porcentaje: 0, es_anticipado: true, custodia_cobro: 'negocio', orden: 2 },
  { nombre: 'POS / Tarjeta', comision_porcentaje: 2.2, es_anticipado: true, custodia_cobro: 'negocio', orden: 3 },
  { nombre: 'Crédito', comision_porcentaje: 5, es_anticipado: true, custodia_cobro: 'negocio', orden: 4 },
];

exports.listMetodosPago = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    let metodos = await MetodoPago.findAll({ where: { usuario_id }, order: [['orden', 'ASC'], ['id', 'ASC']] });

    if (metodos.length === 0) {
      await MetodoPago.bulkCreate(DEFAULTS.map(d => ({ ...d, usuario_id })));
      metodos = await MetodoPago.findAll({ where: { usuario_id }, order: [['orden', 'ASC'], ['id', 'ASC']] });
    }

    res.json(metodos);
  } catch (error) {
    console.error('Error listing metodos de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.createMetodoPago = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nombre, comision_porcentaje, es_anticipado, custodia_cobro, activo, orden } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del método de pago es obligatorio' });
    }
    if (custodia_cobro !== undefined && !['negocio', 'courier'].includes(custodia_cobro)) {
      return res.status(400).json({ error: 'custodia_cobro inválido. Valores permitidos: negocio, courier.' });
    }

    const metodo = await MetodoPago.create({
      usuario_id,
      nombre: nombre.trim(),
      comision_porcentaje: comision_porcentaje || 0,
      es_anticipado: !!es_anticipado,
      custodia_cobro: custodia_cobro || 'negocio',
      activo: activo === undefined ? true : !!activo,
      orden: orden || 0,
    });

    res.status(201).json(metodo);
  } catch (error) {
    console.error('Error creating metodo de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.updateMetodoPago = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { nombre, comision_porcentaje, es_anticipado, custodia_cobro, activo, orden } = req.body;

    const metodo = await MetodoPago.findOne({ where: { id, usuario_id } });
    if (!metodo) return res.status(404).json({ error: 'Método de pago no encontrado' });

    if (nombre !== undefined && !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre del método de pago es obligatorio' });
    }
    if (custodia_cobro !== undefined && !['negocio', 'courier'].includes(custodia_cobro)) {
      return res.status(400).json({ error: 'custodia_cobro inválido. Valores permitidos: negocio, courier.' });
    }

    await metodo.update({
      nombre: nombre !== undefined ? nombre.trim() : metodo.nombre,
      comision_porcentaje: comision_porcentaje !== undefined ? comision_porcentaje : metodo.comision_porcentaje,
      es_anticipado: es_anticipado !== undefined ? !!es_anticipado : metodo.es_anticipado,
      custodia_cobro: custodia_cobro !== undefined ? custodia_cobro : metodo.custodia_cobro,
      activo: activo !== undefined ? !!activo : metodo.activo,
      orden: orden !== undefined ? orden : metodo.orden,
    });

    res.json(metodo);
  } catch (error) {
    console.error('Error updating metodo de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.deleteMetodoPago = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;

    const metodo = await MetodoPago.findOne({ where: { id, usuario_id } });
    if (!metodo) return res.status(404).json({ error: 'Método de pago no encontrado' });

    const envioCount = await Envio.count({ where: { metodo_pago_id: id } });
    if (envioCount > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: hay ${envioCount} pedido(s) que usan este método de pago. Desactívalo en su lugar.`
      });
    }

    await metodo.destroy();
    res.json({ success: true, message: 'Método de pago eliminado correctamente' });
  } catch (error) {
    console.error('Error deleting metodo de pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
