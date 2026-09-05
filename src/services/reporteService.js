const { Op, fn, col, literal } = require('sequelize');
const { Envio, EnvioItem, EnvioItemComponente, Producto, Oferta, Usuario } = require('../models');
const { resolverRangoFechas } = require('../utils/rangoFechas');

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

    // Conteo por canal de venta. Sale de envio_items.origen_venta — un
    // snapshot escrito al vender — y no de un JOIN contra ofertas_producto:
    // esa oferta puede editarse, cambiar de estrategia o darse de baja
    // después, y entonces las ventas históricas se reclasificaban solas.
    //
    // Además separa importe de precio normal e importe realmente cobrado:
    // la diferencia es el descuento que costaron los order bumps, que es lo
    // que hace falta para saber si el bump conviene o no.
    const sequelize = Envio.sequelize;
    const itemsCount = await sequelize.query(`
      SELECT
        ei.origen_venta,
        COUNT(ei.id)                                          AS lineas,
        COALESCE(SUM(ei.cantidad), 0)                         AS unidades,
        COALESCE(SUM(ei.subtotal), 0)                         AS importe_cobrado,
        COALESCE(SUM(COALESCE(ei.precio_normal, ei.precio_unitario) * ei.cantidad), 0) AS importe_normal
      FROM envio_items ei
      INNER JOIN envios e ON ei.envio_id = e.id
      WHERE e.estado = 'Entregado'
        AND e.usuario_id = :usuario_id
      GROUP BY ei.origen_venta
    `, {
      replacements: { usuario_id },
      type: sequelize.QueryTypes.SELECT
    });

    const porOrigen = {};
    let importeOrderBump = 0;
    let descuentoOrderBump = 0;

    (itemsCount || []).filter(Boolean).forEach(row => {
      const origen = row.origen_venta || 'normal';
      const unidades = parseInt(row.unidades, 10) || 0;
      const cobrado = parseInt(row.importe_cobrado, 10) || 0;
      const normal = parseInt(row.importe_normal, 10) || 0;
      porOrigen[origen] = {
        lineas: parseInt(row.lineas, 10) || 0,
        unidades,
        importe_cobrado: cobrado,
        importe_normal: normal,
        descuento_concedido: normal - cobrado,
      };
      if (origen === 'order_bump' || origen === 'combo') {
        importeOrderBump += cobrado;
        descuentoOrderBump += normal - cobrado;
      }
    });

    return {
      ventas_totales: totalVentas,
      pedidos: totalPedidos,
      ticket_promedio: ticketPromedio,
      order_bumps: porOrigen.order_bump?.unidades || 0,
      upsells: porOrigen.upsell?.unidades || 0,
      // "bundles" = combos vendidos dentro del checkout.
      bundles: porOrigen.combo?.unidades || 0,
      ventas_normales: porOrigen.normal?.unidades || 0,
      // Cuánto facturaron las ofertas de checkout y cuánto costó el
      // descuento promocional con el que se consiguió esa facturación.
      importe_incremental: importeOrderBump,
      descuento_incremental: descuentoOrderBump,
      por_origen: porOrigen,
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

  static async obtenerReporteComisiones(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    const { buscador, confirmador, courierId, courier_id } = filtros;
    const finalCourierId = courierId || courier_id;
    const { desde, hasta } = resolverRangoFechas(filtros);

    const whereEnvio = { 
      usuario_id: usuario_id,
      estado: 'Entregado'
    };
    
    if (desde && hasta) {
      whereEnvio.fecha = { [Op.between]: [desde, hasta] };
    }

    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.like]: `%${buscador}%` } },
        { id: { [Op.like]: `%${buscador}%` } },
        { telefono: { [Op.like]: `%${buscador}%` } }
      ];
    }
    
    if (confirmador && confirmador !== 'TODOS') whereEnvio.confirmador = confirmador;
    if (finalCourierId && finalCourierId !== 'TODOS') whereEnvio.courier_id = finalCourierId;

    const { count, rows } = await Envio.findAndCountAll({
      where: whereEnvio,
      attributes: ['id', 'fecha', 'hora', 'confirmador', 'metodo_pago', 'comision_pct_aplicada', 'monto', 'estado'],
      limit: limite,
      offset: offset,
      order: [['id', 'DESC']]
    });

    const dataTransformada = rows.map(r => {
      const e = r.toJSON();
      const pct = Number(e.comision_pct_aplicada) || 0;
      const costo_comision = Math.round(e.monto * (pct / 100));
      return {
        ...e,
        costo_comision,
        precio_neto: e.monto - costo_comision
      };
    });

    const kpisRaw = await Envio.findAll({
      where: whereEnvio,
      attributes: ['monto', 'comision_pct_aplicada']
    });
    
    let totalFacturado = 0;
    let totalComisiones = 0;
    
    kpisRaw.forEach(e => {
      const monto = Number(e.monto) || 0;
      const comision = Number(e.comision_pct_aplicada) || 0;
      totalFacturado += monto;
      totalComisiones += Math.round(monto * (comision / 100));
    });

    return {
      total: count,
      paginas: Math.ceil(count / limite),
      actual: pagina,
      data: dataTransformada,
      kpis: {
        total_facturado: totalFacturado,
        total_comisiones: totalComisiones,
        total_neto: totalFacturado - totalComisiones
      }
    };
  }

  static async obtenerReporteFacturacion(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    const { buscador, confirmador, courierId, courier_id } = filtros;
    const finalCourierId = courierId || courier_id;
    const { desde, hasta } = resolverRangoFechas(filtros);

    const whereEnvio = { 
      usuario_id: usuario_id,
      quiere_factura: true,
      estado: 'Entregado'
    };
    
    if (desde && hasta) {
      whereEnvio.fecha = { [Op.between]: [desde, hasta] };
    }

    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.like]: `%${buscador}%` } },
        { id: { [Op.like]: `%${buscador}%` } },
        { telefono: { [Op.like]: `%${buscador}%` } },
        { ruc: { [Op.like]: `%${buscador}%` } },
        { razon_social: { [Op.like]: `%${buscador}%` } }
      ];
    }
    
    if (confirmador && confirmador !== 'TODOS') whereEnvio.confirmador = confirmador;
    if (finalCourierId && finalCourierId !== 'TODOS') whereEnvio.courier_id = finalCourierId;

    const { count, rows } = await Envio.findAndCountAll({
      where: whereEnvio,
      attributes: ['id', 'fecha', 'confirmador', 'ruc', 'razon_social', 'monto', 'estado'],
      limit: limite,
      offset: offset,
      order: [['id', 'DESC']]
    });

    const dataTransformada = rows.map(r => {
      const e = r.toJSON();
      const iva = Math.round(e.monto * 0.10); 
      return {
        ...e,
        iva
      };
    });

    const kpisRaw = await Envio.findAll({
      where: whereEnvio,
      attributes: ['monto']
    });
    
    let totalSujeto = 0;
    let totalIva = 0;
    
    kpisRaw.forEach(e => {
      const monto = Number(e.monto) || 0;
      totalSujeto += monto;
      totalIva += Math.round(monto * 0.10);
    });

    return {
      total: count,
      paginas: Math.ceil(count / limite),
      actual: pagina,
      data: dataTransformada,
      kpis: {
        total_sujeto_iva: totalSujeto,
        total_iva: totalIva
      }
    };
  }

  static async obtenerReporteProductos(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    const { buscador, confirmador, courierId, courier_id } = filtros;
    const finalCourierId = courierId || courier_id;
    const { desde, hasta } = resolverRangoFechas(filtros);

    const whereEnvio = { usuario_id };
    
    if (desde && hasta) {
      whereEnvio.fecha = { [Op.between]: [desde, hasta] };
    }

    if (confirmador && confirmador !== 'TODOS') whereEnvio.confirmador = confirmador;
    if (finalCourierId && finalCourierId !== 'TODOS') whereEnvio.courier_id = finalCourierId;

    const includeArray = [
      {
        model: Envio,
        where: whereEnvio,
        attributes: ['estado']
      },
      {
        model: Producto,
        attributes: ['precio_costo', 'precio_base']
      },
      {
        // Costo REAL del comerciante, congelado al confirmarse el pedido.
        // Sin esto el reporte caía al catálogo y mostraba el costo del ADMIN.
        model: EnvioItemComponente,
        as: 'componentes_vendidos',
        attributes: ['cantidad', 'costo_unitario'],
        required: false
      }
    ];

    if (buscador) {
      includeArray[0].where[Op.or] = [
        { cliente: { [Op.like]: `%${buscador}%` } },
        { id: { [Op.like]: `%${buscador}%` } }
      ];
    }

    const items = await EnvioItem.findAll({
      include: includeArray
    });

    const mapa = {};
    items.forEach(item => {
      const p_id = item.producto_id || ('SIN_ID_' + item.nombre_producto);
      if (!mapa[p_id]) {
        mapa[p_id] = {
          id: p_id,
          nombre: item.nombre_producto,
          vendidos: 0,
          ingresos: 0,
          costo_total: 0,
          devoluciones: 0,
          cancelados: 0,
          total_procesados: 0,
          // Los unitarios se calculan al final sobre lo que REALMENTE pasó
          // (ver el map de abajo). El precio del catálogo queda solo como
          // respaldo para un producto del que todavía no se entregó nada.
          precio_costo_unitario: 0,
          precio_venta_unitario: 0,
          _costo_catalogo: item.Producto ? (Number(item.Producto.precio_base) || 0) : 0,
          _ultimo_precio_venta: 0
        };
      }
      
      const st = (item.Envio.estado || '').toLowerCase();
      const cant = Number(item.cantidad) || 0;
      
      mapa[p_id].total_procesados += cant;
      
      // Último precio al que se vendió de verdad — respaldo cuando todavía no
      // hay ninguna unidad entregada de ese producto.
      const precioUnit = Number(item.precio_unitario) || 0;
      if (precioUnit > 0) mapa[p_id]._ultimo_precio_venta = precioUnit;

      if (st === 'entregado') {
        mapa[p_id].vendidos += cant;
        mapa[p_id].ingresos += Number(item.subtotal) || 0;

        // Costo del COMERCIANTE, no del admin. Se prefiere el snapshot que
        // dejó la confirmación del pedido (EnvioItemComponente.costo_unitario):
        // ya contempla el multiplicador de una oferta y el costo vigente
        // cuando se vendió. Sin snapshot (pedido viejo) se usa `precio_base`,
        // el precio de lista al que el comerciante le compra al admin.
        //
        // `precio_costo` es lo que le costó AL ADMIN y el comerciante nunca lo
        // paga: usarlo acá inflaba el margen. Misma regla que costoDeItem() en
        // pedidosAnalyticsService y costoParaComerciante() en envioController
        // — si cambia una, tienen que cambiar las tres.
        const comps = item.componentes_vendidos || [];
        if (comps.length > 0) {
          mapa[p_id].costo_total += comps.reduce(
            (acc, c) => acc + (Number(c.costo_unitario) || 0) * (c.cantidad || 0), 0);
        } else {
          const costoUnitario = item.Producto ? (Number(item.Producto.precio_base) || 0) : 0;
          mapa[p_id].costo_total += costoUnitario * cant;
        }
      } else if (st === 'rechazado' || st === 'devuelto') {
        mapa[p_id].devoluciones += cant;
      } else if (st === 'cancelado') {
        mapa[p_id].cancelados += cant;
      }
    });

    // Unitarios derivados de lo que pasó, para que la fila cierre sola:
    // costo unitario x unidades entregadas = costo total, e igual con la venta.
    let arrayData = Object.values(mapa).map(p => {
      const fila = {
        ...p,
        precio_costo_unitario: p.vendidos > 0 ? Math.round(p.costo_total / p.vendidos) : p._costo_catalogo,
        precio_venta_unitario: p.vendidos > 0 ? Math.round(p.ingresos / p.vendidos) : p._ultimo_precio_venta,
      };
      delete fila._costo_catalogo;
      delete fila._ultimo_precio_venta;
      return fila;
    });

    // Filtrar adicionales si hubo un buscador por nombre de producto (que no entra en Envio)
    if (buscador) {
      const b = buscador.toLowerCase();
      arrayData = arrayData.filter(p => p.nombre.toLowerCase().includes(b));
    }

    // Ordenar por ingresos DESC
    arrayData.sort((a, b) => b.ingresos - a.ingresos);

    const totalCount = arrayData.length;
    const paginated = arrayData.slice(offset, offset + limite);

    // Calcular KPIs globales
    const totalUnidades = arrayData.reduce((acc, curr) => acc + curr.vendidos, 0);
    const totalIngresos = arrayData.reduce((acc, curr) => acc + curr.ingresos, 0);
    const topProducto = arrayData[0] && arrayData[0].vendidos > 0 ? arrayData[0].nombre : 'Ninguno';

    return {
      total: totalCount,
      paginas: Math.ceil(totalCount / limite),
      actual: pagina,
      data: paginated,
      kpis: {
        total_unidades: totalUnidades,
        total_ingresos: totalIngresos,
        producto_estrella: topProducto
      }
    };
  }

  static async obtenerReporteConfirmadores(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    const { buscador, confirmador, courierId, courier_id } = filtros;
    const finalCourierId = courierId || courier_id;
    const { desde, hasta } = resolverRangoFechas(filtros);

    const whereEnvio = { usuario_id };
    
    if (desde && hasta) {
      whereEnvio.fecha = { [Op.between]: [desde, hasta] };
    }

    if (finalCourierId && finalCourierId !== 'TODOS') whereEnvio.courier_id = finalCourierId;
    if (confirmador && confirmador !== 'TODOS') whereEnvio.confirmador = confirmador;

    const envios = await Envio.findAll({
      where: whereEnvio,
      attributes: ['confirmador', 'estado', 'monto']
    });

    const mapa = {};
    envios.forEach(e => {
      const p_id = e.confirmador || 'Sin Asignar';
      if (!mapa[p_id]) {
        mapa[p_id] = {
          nombre: p_id,
          procesados: 0,
          entregados: 0,
          rechazados: 0,
          ingresos: 0
        };
      }
      
      const st = (e.estado || '').toLowerCase();
      mapa[p_id].procesados += 1;
      
      if (st === 'entregado') {
        mapa[p_id].entregados += 1;
        mapa[p_id].ingresos += Number(e.monto) || 0;
      } else if (st === 'rechazado' || st === 'devuelto' || st === 'cancelado') {
        mapa[p_id].rechazados += 1;
      }
    });

    let arrayData = Object.values(mapa);
    
    if (buscador) {
      const b = buscador.toLowerCase();
      arrayData = arrayData.filter(c => c.nombre.toLowerCase().includes(b));
    }

    arrayData.sort((a, b) => b.ingresos - a.ingresos);
    
    const totalCount = arrayData.length;
    const paginated = arrayData.slice(offset, offset + limite);

    let topConfirmador = 'Ninguno';
    let totalIngresos = 0;
    let sumTasa = 0;
    let confirmadoresValidos = 0;

    arrayData.forEach(c => {
      totalIngresos += c.ingresos;
      if (c.procesados > 0) {
        sumTasa += (c.entregados / c.procesados) * 100;
        confirmadoresValidos++;
      }
    });

    if (arrayData.length > 0 && arrayData[0].entregados > 0) {
      topConfirmador = arrayData[0].nombre;
    }

    const tasaCierrePromedio = confirmadoresValidos > 0 ? (sumTasa / confirmadoresValidos) : 0;

    return {
      total: totalCount,
      paginas: Math.ceil(totalCount / limite),
      actual: pagina,
      data: paginated,
      kpis: {
        top_confirmador: topConfirmador,
        total_ingresos: totalIngresos,
        tasa_cierre_promedio: tasaCierrePromedio
      }
    };
  }
}

module.exports = ReporteService;
