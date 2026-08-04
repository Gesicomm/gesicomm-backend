const { Envio, EnvioItem, Courier, Producto, sequelize } = require('../models');
const { Op } = require('sequelize');
const { getAnalyticsCompleto } = require('../services/pedidosAnalyticsService');

exports.listEnvios = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    // La regla del proyecto: endpoints con filtros dinámicos son POST y leen de req.body
    const { fecha, estado, confirmador, courier_id, origen } = req.body;

    const where = { usuario_id };
    if (fecha) {
      where.dispatchedAt = fecha;
    }
    if (estado) {
      where.estado = estado;
    }
    if (confirmador && confirmador !== 'TODOS') {
      where.confirmador = confirmador;
    }
    if (courier_id && courier_id !== 'TODOS') {
      where.courier_id = courier_id === 'null' ? null : courier_id;
    }
    if (origen && origen !== 'TODOS') {
      where.origen = origen;
    }

    const envios = await Envio.findAll({
      where,
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items', include: [{ model: Producto, attributes: ['id', 'nombre', 'sku', 'precio_costo'] }] }
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
  const t = await sequelize.transaction();
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
      origen,
      campaign_name,
      campaign_id,
      adset,
      ad,
      utm_source,
      utm_medium,
      utm_campaign,
      estado_comercial,
      estado_logistico,
      items
    } = req.body;

    const hoy = fecha || new Date().toISOString().split('T')[0];
    const fullCliente = `${nombre_cliente || ''} ${apellido_cliente || ''}`.trim() || 'Cliente';

    const nuevoEnvio = await Envio.create(
      {
        usuario_id,
        courier_id: courier_id || null,
        cliente: fullCliente,
        fecha: hoy,
        hora: hora || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        confirmador: confirmador || null,
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
        origen: origen || 'WEB',
        campaign_name: campaign_name || null,
        campaign_id: campaign_id || null,
        adset: adset || null,
        ad: ad || null,
        utm_source: utm_source || null,
        utm_medium: utm_medium || null,
        utm_campaign: utm_campaign || null,
        estado_comercial: estado_comercial || 'Confirmado',
        estado_logistico: estado_logistico || 'Pendiente',
        items: items && items.length > 0 ? items.map(item => ({
          producto_id: item.producto_id || null,
          nombre_producto: item.nombre_producto || 'Producto sin nombre',
          cantidad: item.cantidad || 1,
          precio_unitario: item.precio_unitario || 0,
          subtotal: (item.cantidad || 1) * (item.precio_unitario || 0)
        })) : []
      },
      {
        include: [{ model: EnvioItem, as: 'items' }],
        transaction: t
      }
    );

    // Descontar el stock correspondiente de cada producto vendido en el pedido
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        if (item.producto_id) {
          const cantVendida = parseInt(item.cantidad) || 1;
          const prod = await Producto.findByPk(item.producto_id, { transaction: t });
          if (prod) {
            const stockActual = parseInt(prod.cantidad_disponible) || 0;
            const nuevoStock = Math.max(0, stockActual - cantVendida);
            const actualizacion = { cantidad_disponible: nuevoStock };
            if (nuevoStock === 0 && prod.estado_venta === 'en_venta') {
              actualizacion.estado_venta = 'fuera_de_stock';
            }
            await prod.update(actualizacion, { transaction: t });
          }
        }
      }
    }

    await t.commit();

    // Retornar envio completo con Courier e Items
    const result = await Envio.findByPk(nuevoEnvio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' }
      ]
    });

    res.status(201).json(result);
  } catch (error) {
    if (t) await t.rollback();
    console.error('Error creating envio:', error);
    res.status(500).json({ error: 'Error al crear el envío' });
  }
};

exports.updateEstado = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { estado, courier_id, estado_comercial, estado_logistico } = req.body;

    if (!estado && courier_id === undefined && !estado_comercial && !estado_logistico) {
      return res.status(400).json({ error: 'Se requiere al menos estado o courier_id' });
    }

    const envio = await Envio.findOne({ where: { id, usuario_id } });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    const updateData = {};
    if (estado !== undefined) {
      updateData.estado = estado;
      if (estado === 'Rendido') {
        updateData.fecha_rendicion = new Date().toISOString().split('T')[0];
        updateData.estado_logistico = 'Rendido';
      } else if (estado === 'Entregado') {
        updateData.estado_logistico = 'Entregado';
      } else if (estado === 'En Tránsito') {
        updateData.estado_logistico = 'En Tránsito';
      } else if (estado === 'Devuelto') {
        updateData.estado_logistico = 'Devuelto';
      }
    }
    if (estado_comercial !== undefined) updateData.estado_comercial = estado_comercial;
    if (estado_logistico !== undefined) updateData.estado_logistico = estado_logistico;
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

/**
 * Endpoint de Centro de Inteligencia Comercial & Analytics
 * POST /api/envios/metricas-dashboard
 */
exports.getDashboardMetricas = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const filtros = req.body || {};

    const data = await getAnalyticsCompleto(filtros, usuario_id);
    res.json(data);
  } catch (error) {
    console.error('Error in getDashboardMetricas:', error);
    res.status(500).json({ error: 'Error al calcular métricas analíticas' });
  }
};

