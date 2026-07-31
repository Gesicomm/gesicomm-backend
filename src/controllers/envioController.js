const { Envio, EnvioItem, Courier, Producto } = require('../models');
const { Op } = require('sequelize');

exports.listEnvios = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    // La regla del proyecto: endpoints con filtros dinámicos son POST y leen de req.body
    const { fecha, estado } = req.body;

    const where = { usuario_id };
    if (fecha) {
      where.dispatchedAt = fecha;
    }
    if (estado) {
      where.estado = estado;
    }

    const envios = await Envio.findAll({
      where,
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items', include: [{ model: Producto, attributes: ['id', 'nombre', 'sku'] }] }
      ],
      order: [['id', 'DESC']]
    });

    res.json(envios);
  } catch (error) {
    console.error('Error listing envios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.createEnvio = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const {
      fecha,
      hora,
      confirmador,
      nombre_cliente,
      apellido_cliente,
      telefono,
      departamento,
      ciudad,
      direccion,
      referencia,
      link_maps,
      monto,
      costo_envio,
      metodo_pago,
      observaciones,
      courier_id,
      items
    } = req.body;

    const hoy = fecha || new Date().toISOString().split('T')[0];

    const nuevoEnvio = await Envio.create(
      {
        usuario_id,
        courier_id: courier_id || null,
        fecha: hoy,
        hora: hora || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        confirmador,
        nombre_cliente,
        apellido_cliente,
        telefono,
        departamento,
        ciudad,
        direccion,
        referencia,
        link_maps,
        monto: monto || 0,
        costo_envio: costo_envio || 0,
        metodo_pago: metodo_pago || 'Efectivo',
        observaciones,
        estado: 'Pendiente',
        dispatchedAt: hoy,
        items: items && items.length > 0 ? items.map(item => ({
          producto_id: item.producto_id || null,
          nombre_producto: item.nombre_producto || 'Producto sin nombre',
          cantidad: item.cantidad || 1,
          precio_unitario: item.precio_unitario || 0,
          subtotal: (item.cantidad || 1) * (item.precio_unitario || 0)
        })) : []
      },
      {
        include: [{ model: EnvioItem, as: 'items' }]
      }
    );

    // Retornar envio completo con Courier e Items
    const result = await Envio.findByPk(nuevoEnvio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' }
      ]
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating envio:', error);
    res.status(500).json({ error: 'Error al crear el envío' });
  }
};

exports.updateEstado = async (req, res) => {
  try {
    const usuario_id = req.usuario.id; // Corregido req.user -> req.usuario
    const { id } = req.params;
    const { estado, courier_id } = req.body;

    if (!estado && courier_id === undefined) {
      return res.status(400).json({ error: 'Se requiere al menos estado o courier_id' });
    }

    const envio = await Envio.findOne({ where: { id, usuario_id } });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    const updateData = {};
    if (estado !== undefined) updateData.estado = estado;
    if (courier_id !== undefined) updateData.courier_id = courier_id;

    await envio.update(updateData);

    const result = await Envio.findByPk(envio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' }
      ]
    });

    res.json(result);
  } catch (error) {
    console.error('Error updating estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
