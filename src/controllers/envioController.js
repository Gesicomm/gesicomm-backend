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

/**
 * Endpoint paginado para la vista de tabla de pedidos.
 * Soporta: paginación, filtro por rango de fechas, múltiples estados,
 * búsqueda por cliente (nombre/teléfono), ciudad, courier, confirmador, origen.
 */
exports.listEnviosPaginados = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const {
      page = 1,
      limit = 10,
      fecha_desde,
      fecha_hasta,
      estados,          // array de strings, ej: ['Pendiente', 'Confirmado']
      cliente,          // texto libre: busca en nombre_cliente + apellido_cliente + telefono
      ciudad,
      courier_id,
      confirmador,
      origen,
    } = req.body;

    const where = { usuario_id };

    // Rango de fechas (dispatchedAt)
    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
    }

    // Multi-estado
    if (Array.isArray(estados) && estados.length > 0) {
      where.estado = { [Op.in]: estados };
    }

    // Búsqueda por texto de cliente (nombre o teléfono)
    if (cliente && cliente.trim()) {
      const term = `%${cliente.trim()}%`;
      where[Op.or] = [
        { nombre_cliente: { [Op.like]: term } },
        { apellido_cliente: { [Op.like]: term } },
        { telefono: { [Op.like]: term } },
      ];
    }

    if (ciudad && ciudad.trim()) {
      where.ciudad = { [Op.like]: `%${ciudad.trim()}%` };
    }

    if (courier_id && courier_id !== 'TODOS') {
      where.courier_id = courier_id === 'null' ? null : Number(courier_id);
    }

    if (confirmador && confirmador !== 'TODOS') {
      where.confirmador = confirmador;
    }

    if (origen && origen !== 'TODOS') {
      where.origen = origen;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const { count, rows } = await Envio.findAndCountAll({
      where,
      include: [
        { model: Courier, attributes: ['id', 'nombre'] },
        { model: EnvioItem, as: 'items', attributes: ['id', 'nombre_producto', 'cantidad', 'precio_unitario'] },
      ],
      order: [['id', 'DESC']],
      limit: limitNum,
      offset,
      distinct: true, // necesario con includes para que count sea correcto
    });

    res.json({
      data: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum),
    });
  } catch (error) {
    console.error('Error listEnviosPaginados:', error);
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
      metodo_pago_id,
      comision_pct_aplicada,
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
      quiere_factura,
      razon_social,
      ruc,
      nro_comprobante,
      items
    } = req.body;

    const hoy = fecha || new Date().toISOString().split('T')[0];
    const fullCliente = `${nombre_cliente || ''} ${apellido_cliente || ''}`.trim() || 'Cliente';

    if (quiere_factura && !(ruc && String(ruc).trim())) {
      await t.rollback();
      return res.status(400).json({ error: 'El RUC es obligatorio cuando se solicita factura' });
    }

    const nroComprobanteLimpio = nro_comprobante && String(nro_comprobante).trim() ? String(nro_comprobante).trim() : null;
    if (nroComprobanteLimpio) {
      const existente = await Envio.findOne({
        where: { usuario_id, nro_comprobante: nroComprobanteLimpio },
        transaction: t,
      });
      if (existente) {
        await t.rollback();
        return res.status(400).json({ error: 'Ya existe un pedido con ese número de comprobante' });
      }
    }

    const nuevoEnvio = await Envio.create(
      {
        usuario_id,
        courier_id: courier_id || null,
        cliente: fullCliente,
        fecha: hoy,
        hora: hora || new Date().toLocaleTimeString('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit' }),
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
        metodo_pago_id: metodo_pago_id || null,
        comision_pct_aplicada: comision_pct_aplicada || 0,
        observaciones,
        estado: 'Pendiente',
        dispatchedAt: hoy,
        origen: origen || 'WEB',
        quiere_factura: !!quiere_factura,
        razon_social: razon_social || null,
        ruc: ruc || null,
        nro_comprobante: nroComprobanteLimpio,
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

    // El stock ya NO se descuenta acá — se descuenta al pasar a
    // "Confirmado" (ver updateEstado), sea cual sea el origen del pedido.
    // Antes se descontaba al crear, lo que exponía el stock real a
    // cualquiera que llenara el checkout público sin intención de compra.

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
  const t = await sequelize.transaction();
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const {
      estado, courier_id, estado_comercial, estado_logistico,
      // Campos que completa el modal único de Pedido (mismo componente de
      // alta, en modo "completar") al confirmar — el checkout público no
      // los pide (ruc es opcional ahí; courier/costo de envío los define
      // el staff, nunca el visitante).
      ruc, direccion, referencia, link_maps, costo_envio, metodo_pago,
      quiere_factura, razon_social, nro_comprobante, metodo_pago_id, comision_pct_aplicada,
      ciudad, departamento, nombre_cliente, apellido_cliente, telefono,
      confirmador, origen, campaign_name, observaciones, monto,
    } = req.body;

    if (!estado && courier_id === undefined && !estado_comercial && !estado_logistico) {
      await t.rollback();
      return res.status(400).json({ error: 'Se requiere al menos estado o courier_id' });
    }

    const envio = await Envio.findOne({
      where: { id, usuario_id },
      include: [{ model: EnvioItem, as: 'items' }],
      transaction: t,
    });
    if (!envio) {
      await t.rollback();
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

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
    if (ruc !== undefined) updateData.ruc = ruc;
    if (direccion !== undefined) updateData.direccion = direccion;
    if (referencia !== undefined) updateData.referencia = referencia;
    if (link_maps !== undefined) updateData.link_maps = link_maps;
    if (costo_envio !== undefined) updateData.costo_envio = costo_envio;
    if (metodo_pago !== undefined) updateData.metodo_pago = metodo_pago;
    if (metodo_pago_id !== undefined) updateData.metodo_pago_id = metodo_pago_id;
    if (comision_pct_aplicada !== undefined) updateData.comision_pct_aplicada = comision_pct_aplicada;
    if (quiere_factura !== undefined) updateData.quiere_factura = quiere_factura;
    if (razon_social !== undefined) updateData.razon_social = razon_social;
    if (ciudad !== undefined) updateData.ciudad = ciudad;
    if (departamento !== undefined) updateData.departamento = departamento;
    if (telefono !== undefined) updateData.telefono = telefono;
    if (confirmador !== undefined) updateData.confirmador = confirmador;
    if (origen !== undefined) updateData.origen = origen;
    if (campaign_name !== undefined) updateData.campaign_name = campaign_name;
    if (observaciones !== undefined) updateData.observaciones = observaciones;
    if (monto !== undefined) updateData.monto = monto;
    if (nombre_cliente !== undefined || apellido_cliente !== undefined) {
      updateData.nombre_cliente = nombre_cliente !== undefined ? nombre_cliente : envio.nombre_cliente;
      updateData.apellido_cliente = apellido_cliente !== undefined ? apellido_cliente : envio.apellido_cliente;
      updateData.cliente = `${updateData.nombre_cliente || ''} ${updateData.apellido_cliente || ''}`.trim() || 'Cliente';
    }

    if (updateData.quiere_factura && !((updateData.ruc ?? envio.ruc) && String(updateData.ruc ?? envio.ruc).trim())) {
      await t.rollback();
      return res.status(400).json({ error: 'El RUC es obligatorio cuando se solicita factura' });
    }

    if (nro_comprobante !== undefined) {
      const nroComprobanteLimpio = nro_comprobante && String(nro_comprobante).trim() ? String(nro_comprobante).trim() : null;
      if (nroComprobanteLimpio) {
        const existente = await Envio.findOne({
          where: { usuario_id, nro_comprobante: nroComprobanteLimpio, id: { [Op.ne]: envio.id } },
          transaction: t,
        });
        if (existente) {
          await t.rollback();
          return res.status(400).json({ error: 'Ya existe un pedido con ese número de comprobante' });
        }
      }
      updateData.nro_comprobante = nroComprobanteLimpio;
    }

    // Descuento de stock movido acá desde createEnvio: recién se compromete
    // stock real cuando el pedido pasa a "Confirmado" — antes (Pendiente)
    // puede venir de un checkout público sin ninguna verificación.
    // stock_descontado evita descontar dos veces si el pedido pasa por
    // Confirmado más de una vez (se mueve para atrás y de nuevo adelante).
    if (estado === 'Confirmado' && !envio.stock_descontado) {
      for (const item of envio.items || []) {
        if (item.producto_id) {
          const cantVendida = parseInt(item.cantidad) || 1;
          const prod = await Producto.findByPk(item.producto_id, { transaction: t });
          if (prod) {
            const stockActual = parseInt(prod.cantidad_disponible) || 0;
            const nuevoStock = Math.max(0, stockActual - cantVendida);
            const actualizacionProd = { cantidad_disponible: nuevoStock };
            if (nuevoStock === 0 && prod.estado_venta === 'en_venta') {
              actualizacionProd.estado_venta = 'fuera_de_stock';
            }
            await prod.update(actualizacionProd, { transaction: t });
          }
        }
      }
      updateData.stock_descontado = true;
    }

    await envio.update(updateData, { transaction: t });
    await t.commit();

    const result = await Envio.findByPk(envio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' }
      ]
    });

    res.json(result);
  } catch (error) {
    if (!t.finished) await t.rollback();
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

