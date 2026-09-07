const { Courier, CourierTarifa, DeliveryZonaTarifa } = require('../models');

function normalizarTarifa(t, courierId) {
  t = t || {};
  return {
    courier_id: courierId,
    ciudad_zona: String(t.ciudad_zona || '').trim(),
    departamento: t.departamento ? String(t.departamento).trim() : null,
    tipo_pago: t.tipo_pago || 'Ambos',
    rango_min: (t.rango_min === "" || t.rango_min === undefined || t.rango_min === null) ? 0 : Number(t.rango_min),
    rango_max: (t.rango_max === "" || t.rango_max === undefined || t.rango_max === null) ? null : Number(t.rango_max),
    costo: (t.costo === "" || t.costo === undefined || t.costo === null) ? 0 : Number(t.costo),
    tiempo_entrega_hs: t.tiempo_entrega_hs ? String(t.tiempo_entrega_hs).trim() : null,
  };
}

function normalizarZonaDelivery(t, usuarioId, couriersPermitidos) {
  t = t || {};
  const courierId = (t.courier_id === "" || t.courier_id === undefined || t.courier_id === null)
    ? null
    : Number(t.courier_id);
  return {
    usuario_id: usuarioId,
    courier_id: courierId && couriersPermitidos.has(courierId) ? courierId : null,
    departamento: t.departamento ? String(t.departamento).trim() : null,
    ciudad: String(t.ciudad || t.ciudad_zona || '').trim(),
    tipo_pago: t.tipo_pago || 'Ambos',
    rango_min: (t.rango_min === "" || t.rango_min === undefined || t.rango_min === null) ? 0 : Number(t.rango_min),
    rango_max: (t.rango_max === "" || t.rango_max === undefined || t.rango_max === null) ? null : Number(t.rango_max),
    costo: (t.costo === "" || t.costo === undefined || t.costo === null) ? 0 : Number(t.costo),
    tiempo_entrega_hs: t.tiempo_entrega_hs ? String(t.tiempo_entrega_hs).trim() : null,
    activo: t.activo !== false,
  };
}

exports.listCouriers = async (req, res) => {
  try {
    const usuario_id = req.usuario.id; // Asumiendo autenticación por token en req.user
    const couriers = await Courier.findAll({
      where: { usuario_id },
      include: [{ model: CourierTarifa, as: 'tarifas' }]
    });
    res.json(couriers);
  } catch (error) {
    console.error('Error listing couriers:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.createCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { nombre, telefono, vehiculo, activo, tarifas } = req.body;

    const courier = await Courier.create({
      usuario_id,
      nombre,
      telefono,
      vehiculo,
      activo
    });

    if (tarifas && tarifas.length > 0) {
      const tarifasWithId = tarifas
        .map(t => normalizarTarifa(t, courier.id))
        .filter(t => t.ciudad_zona);
      await CourierTarifa.bulkCreate(tarifasWithId);
    }

    const createdCourier = await Courier.findByPk(courier.id, {
      include: [{ model: CourierTarifa, as: 'tarifas' }]
    });

    res.status(201).json(createdCourier);
  } catch (error) {
    console.error('Error creating courier:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.updateCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { nombre, telefono, vehiculo, activo, tarifas } = req.body;

    const courier = await Courier.findOne({ where: { id, usuario_id } });
    if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

    await courier.update({ nombre, telefono, vehiculo, activo });

    if (tarifas) {
      // Eliminar tarifas viejas
      await CourierTarifa.destroy({ where: { courier_id: courier.id } });
      // Crear las nuevas
      if (tarifas.length > 0) {
        const tarifasWithId = tarifas
          .map(t => normalizarTarifa(t, courier.id))
          .filter(t => t.ciudad_zona);
        await CourierTarifa.bulkCreate(tarifasWithId);
      }
    }

    const updatedCourier = await Courier.findByPk(courier.id, {
      include: [{ model: CourierTarifa, as: 'tarifas' }]
    });

    res.json(updatedCourier);
  } catch (error) {
    console.error('Error updating courier:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.deleteCourier = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;

    const courier = await Courier.findOne({ where: { id, usuario_id } });
    if (!courier) return res.status(404).json({ error: 'Courier no encontrado' });

    await courier.destroy();
    res.json({ success: true, message: 'Courier eliminado correctamente' });
  } catch (error) {
    console.error('Error deleting courier:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.listZonasDelivery = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const zonas = await DeliveryZonaTarifa.findAll({
      where: { usuario_id },
      include: [{ model: Courier, as: 'courier', attributes: ['id', 'nombre', 'activo'], required: false }],
      order: [['departamento', 'ASC'], ['ciudad', 'ASC'], ['rango_min', 'ASC']],
    });
    res.json(zonas);
  } catch (error) {
    console.error('Error listing delivery zones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.replaceZonasDelivery = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const zonas = Array.isArray(req.body?.zonas) ? req.body.zonas : [];
    const couriers = await Courier.findAll({ where: { usuario_id }, attributes: ['id'] });
    const couriersPermitidos = new Set(couriers.map(c => Number(c.id)));
    const normalizadas = zonas
      .map(z => normalizarZonaDelivery(z, usuario_id, couriersPermitidos))
      .filter(z => z.ciudad);

    await DeliveryZonaTarifa.destroy({ where: { usuario_id } });
    if (normalizadas.length > 0) {
      await DeliveryZonaTarifa.bulkCreate(normalizadas);
    }

    const guardadas = await DeliveryZonaTarifa.findAll({
      where: { usuario_id },
      include: [{ model: Courier, as: 'courier', attributes: ['id', 'nombre', 'activo'], required: false }],
      order: [['departamento', 'ASC'], ['ciudad', 'ASC'], ['rango_min', 'ASC']],
    });
    res.json(guardadas);
  } catch (error) {
    console.error('Error replacing delivery zones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
