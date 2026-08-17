const { Op, fn, col, literal } = require('sequelize');
const { Envio, EnvioItem, Producto, Oferta, Usuario } = require('../models');

class ReporteService {
  /**
   * Asegura el scope del tenant filtrando envíos por los usuarios que pertenecen al inquilino,
   * o si se pasa usuario_id, filtra por ese usuario directamente.
   */
  static async obtenerKPIs(usuario_id, filtros = {}) {
    const { fecha_desde, fecha_hasta, buscador } = filtros;
    
    // Asumimos que los reportes de ventas se consultan por el usuario dueño de la tienda.
    const whereEnvio = { 
      estado: 'Entregado',
      usuario_id: usuario_id 
    };
    
    if (fecha_desde && fecha_hasta) {
      // Formato fecha: YYYY-MM-DD
      whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };
    }

    // Calcular KPIs
    const totalVentas = await Envio.sum('monto', { where: whereEnvio }) || 0;
    const totalPedidos = await Envio.count({ where: whereEnvio });
    const ticketPromedio = totalPedidos > 0 ? Math.round(totalVentas / totalPedidos) : 0;

    // Conteo detallado por estrategia usando raw SQL para evitar problemas de alias
    const sequelize = Envio.sequelize;
    const [itemsCount] = await sequelize.query(`
      SELECT 
        op.estrategia,
        op.tipo_contenido,
        COUNT(ei.id) AS cantidad_vendidos
      FROM envio_items ei
      INNER JOIN envios e ON ei.envio_id = e.id
        AND e.estado = 'Entregado'
        AND e.usuario_id = :usuario_id
      LEFT JOIN ofertas_producto op ON ei.oferta_id = op.id
      GROUP BY op.estrategia, op.tipo_contenido
    `, {
      replacements: { usuario_id },
      type: sequelize.QueryTypes.SELECT
    });

    let orderBumps = 0;
    let upsells = 0;
    let bundles = 0;

    (Array.isArray(itemsCount) ? itemsCount : [itemsCount]).filter(Boolean).forEach(row => {
      const cant = parseInt(row.cantidad_vendidos, 10) || 0;
      if (row.estrategia === 'order_bump') orderBumps += cant;
      if (row.estrategia === 'upsell') upsells += cant;
      if (row.tipo_contenido === 'combo') bundles += cant;
    });

    return {
      ventas_totales: totalVentas,
      pedidos: totalPedidos,
      ticket_promedio: ticketPromedio,
      order_bumps: orderBumps,
      upsells: upsells,
      bundles: bundles
    };
  }

  static async obtenerPedidos(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    const { fecha_desde, fecha_hasta, buscador } = filtros;

    const whereEnvio = { 
      estado: 'Entregado',
      usuario_id: usuario_id
    };
    
    if (fecha_desde && fecha_hasta) {
      whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };
    }

    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.like]: `%${buscador}%` } },
        { id: { [Op.like]: `%${buscador}%` } },
        { telefono: { [Op.like]: `%${buscador}%` } }
      ];
    }

    const { count, rows } = await Envio.findAndCountAll({
      where: whereEnvio,
      limit: limite,
      offset: offset,
      order: [['id', 'DESC']],
      include: [
        {
          model: EnvioItem,
          as: 'items', // Según models/index.js (Envio.hasMany(EnvioItem, { as: 'items' }))
          include: [
            {
              model: Oferta,
              attributes: ['id', 'estrategia', 'tipo_contenido', 'codigo', 'nombre']
            },
            {
              model: Producto,
              attributes: ['id', 'nombre']
            }
          ]
        }
      ]
    });

    return {
      total: count,
      paginas: Math.ceil(count / limite),
      actual: pagina,
      pedidos: rows
    };
  }

  static async obtenerItemsVendidos(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    const { fecha_desde, fecha_hasta, buscador } = filtros;

    const whereEnvio = { 
      estado: 'Entregado',
      usuario_id: usuario_id 
    };
    
    if (fecha_desde && fecha_hasta) {
      whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };
    }

    const { count, rows } = await EnvioItem.findAndCountAll({
      limit: limite,
      offset: offset,
      include: [
        {
          model: Envio,
          where: whereEnvio,
          attributes: ['id', 'cliente', 'fecha', 'hora', 'monto', 'metodo_pago', 'quiere_factura']
        },
        {
          model: Oferta,
          attributes: ['id', 'estrategia', 'tipo_contenido', 'codigo', 'nombre']
        },
        {
          model: Producto,
          attributes: ['id', 'nombre']
        }
      ],
      order: [['id', 'DESC']]
    });

    return {
      total: count,
      paginas: Math.ceil(count / limite),
      actual: pagina,
      items: rows
    };
  }
}

module.exports = ReporteService;
