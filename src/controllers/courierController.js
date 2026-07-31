const { Courier, CourierTarifa } = require('../models');

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
      const tarifasWithId = tarifas.map(t => ({ ...t, courier_id: courier.id }));
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
        const tarifasWithId = tarifas.map(t => ({ ...t, courier_id: courier.id }));
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
