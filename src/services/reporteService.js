const { Op, fn, col, literal } = require('sequelize');
const { Envio, EnvioItem, EnvioItemComponente, Producto, Oferta, Usuario } = require('../models');
const { resolverRangoFechas } = require('../utils/rangoFechas');

class ReporteService {
  /**
   * Asegura el scope del tenant filtrando envíos por los usuarios que pertenecen al inquilino,
   * o si se pasa usuario_id, filtra por ese usuario directamente.
   */
  static _aplicarFiltrosGlobales(whereEnvio, filtros) {
    const { estado, metodo_pago, canal_venta_id, producto_id, fecha_desde, fecha_hasta, buscador } = filtros;
    if (fecha_desde && fecha_hasta) {
      whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };
    }
    if (estado && estado !== 'TODOS') whereEnvio.estado = estado;
    if (metodo_pago && metodo_pago !== 'TODOS') whereEnvio.metodo_pago = metodo_pago;
    if (canal_venta_id && canal_venta_id !== 'TODOS') whereEnvio.canal_venta_id = canal_venta_id;
    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.like]: `%${buscador}%` } },
        { id: { [Op.like]: `%${buscador}%` } },
        { telefono: { [Op.like]: `%${buscador}%` } }
      ];
    }
    return whereEnvio;
  }

  static async _calcularMetricasBase(usuario_id, filtros = {}) {
    const sequelize = Envio.sequelize;

    // 1. Where base (Todos los pedidos del periodo/filtros)
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      whereEnvio['$items.producto_id$'] = filtros.producto_id;
    }

    const includeQuery = (filtros.producto_id && filtros.producto_id !== 'TODOS') ? [{
      model: EnvioItem, as: 'items', attributes: []
    }] : [];

    const totalPedidos = await Envio.count({
      where: whereEnvio,
      include: includeQuery,
      distinct: true
    });

    // 2. Where Concretados (Entregados)
    let whereConcretados = { usuario_id, estado: 'Entregado' };
    whereConcretados = this._aplicarFiltrosGlobales(whereConcretados, filtros);
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      whereConcretados['$items.producto_id$'] = filtros.producto_id;
    }

    const ventasNetas = await Envio.sum('monto', { 
      where: whereConcretados,
      include: includeQuery
    }) || 0;

    const pedidosConcretados = await Envio.count({ 
      where: whereConcretados,
      include: includeQuery,
      distinct: true
    });

    const ticketPromedio = pedidosConcretados > 0 ? Math.round(ventasNetas / pedidosConcretados) : 0;

    // 3. Unidades vendidas (de concretados)
    let queryUnidades = `
      SELECT COALESCE(SUM(ei.cantidad), 0) as unidades
      FROM envio_items ei
      INNER JOIN envios e ON ei.envio_id = e.id
      WHERE e.estado = 'Entregado' AND e.usuario_id = :usuario_id
    `;
    const repUnidades = { usuario_id };
    if (filtros.fecha_desde && filtros.fecha_hasta) {
      queryUnidades += ' AND e.fecha BETWEEN :desde AND :hasta';
      repUnidades.desde = filtros.fecha_desde;
      repUnidades.hasta = filtros.fecha_hasta;
    }
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      queryUnidades += ' AND ei.producto_id = :producto_id';
      repUnidades.producto_id = filtros.producto_id;
    }
    if (filtros.estado && filtros.estado !== 'TODOS') {
      queryUnidades += ' AND e.estado = :estado';
      repUnidades.estado = filtros.estado;
    }
    if (filtros.metodo_pago && filtros.metodo_pago !== 'TODOS') {
      queryUnidades += ' AND e.metodo_pago = :metodo_pago';
      repUnidades.metodo_pago = filtros.metodo_pago;
    }
    if (filtros.canal_venta_id && filtros.canal_venta_id !== 'TODOS') {
      queryUnidades += ' AND e.canal_venta_id = :canal_venta_id';
      repUnidades.canal_venta_id = filtros.canal_venta_id;
    }
    
    const [unidadesResult] = await sequelize.query(queryUnidades, { replacements: repUnidades });
    const unidadesVendidas = parseInt(unidadesResult[0]?.unidades || 0, 10);

    // 4. Clientes únicos (de concretados)
    // sequelize count con col y distinct
    const clientesUnicos = await Envio.count({
      where: whereConcretados,
      include: includeQuery,
      col: 'telefono',
      distinct: true
    });

    // 5. Cancelados/Devueltos (sobre todos, no importa concretados)
    let whereCancelados = { usuario_id, estado: { [Op.in]: ['Cancelado', 'Devuelto', 'Rechazado'] } };
    whereCancelados = this._aplicarFiltrosGlobales(whereCancelados, filtros);
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      whereCancelados['$items.producto_id$'] = filtros.producto_id;
    }
    const canceladosDevueltos = await Envio.count({ 
      where: whereCancelados,
      include: includeQuery,
      distinct: true
    });

    let tasaCancelacion = 0;
    if (totalPedidos > 0) {
      tasaCancelacion = (canceladosDevueltos / totalPedidos) * 100;
    }

    // Desglose del total de pedidos
    let pend = 0, canc = 0, ent = 0;
    let whereDesglose = { usuario_id };
    whereDesglose = this._aplicarFiltrosGlobales(whereDesglose, filtros);
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      whereDesglose['$items.producto_id$'] = filtros.producto_id;
    }
    const desglose = await Envio.findAll({
      attributes: ['estado', [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('Envio.id'))), 'total']],
      where: whereDesglose,
      include: includeQuery,
      group: ['estado'],
      raw: true
    });
    
    desglose.forEach(d => {
      if (['Entregado'].includes(d.estado)) ent += parseInt(d.total);
      else if (['Cancelado', 'Devuelto', 'Rechazado'].includes(d.estado)) canc += parseInt(d.total);
      else pend += parseInt(d.total);
    });

    return {
      ventas_netas: ventasNetas,
      pedidos: totalPedidos,
      ticket_promedio: ticketPromedio,
      unidades_vendidas: unidadesVendidas,
      clientes: clientesUnicos,
      cancelados_devueltos: canceladosDevueltos,
      tasa_cancelacion: tasaCancelacion,
      desglose_pedidos: { entregados: ent, pendientes: pend, cancelados: canc }
    };
  }

  static async obtenerKPIs(usuario_id, filtros = {}) {
    const actual = await this._calcularMetricasBase(usuario_id, filtros);
    let anterior = null;
    let variaciones = null;

    if (filtros.fecha_desde && filtros.fecha_hasta) {
      const fDesde = new Date(filtros.fecha_desde);
      const fHasta = new Date(filtros.fecha_hasta);
      const dias = Math.floor((fHasta - fDesde) / (1000 * 60 * 60 * 24));
      
      const prevHasta = new Date(fDesde);
      prevHasta.setDate(prevHasta.getDate() - 1);
      const prevDesde = new Date(prevHasta);
      prevDesde.setDate(prevDesde.getDate() - dias);

      const fPrevDesdeStr = prevDesde.toISOString().split('T')[0];
      const fPrevHastaStr = prevHasta.toISOString().split('T')[0];

      const filtrosAnterior = { ...filtros, fecha_desde: fPrevDesdeStr, fecha_hasta: fPrevHastaStr };
      anterior = await this._calcularMetricasBase(usuario_id, filtrosAnterior);

      variaciones = {};
      const keys = ['ventas_netas', 'pedidos', 'ticket_promedio', 'unidades_vendidas', 'clientes', 'cancelados_devueltos'];
      
      keys.forEach(k => {
        const valActual = actual[k];
        const valAnterior = anterior[k];
        if (valAnterior === 0) {
          variaciones[k] = { valor: valActual, variacion: null, sin_base_comparacion: true };
        } else {
          const varPct = ((valActual - valAnterior) / valAnterior) * 100;
          variaciones[k] = { valor: valActual, variacion: varPct, sin_base_comparacion: false };
        }
      });
      
      if (anterior.pedidos === 0) {
        variaciones['tasa_cancelacion'] = { valor: actual.tasa_cancelacion, variacion: null, sin_base_comparacion: true, es_pp: true };
      } else {
        const varPp = actual.tasa_cancelacion - anterior.tasa_cancelacion;
        variaciones['tasa_cancelacion'] = { valor: actual.tasa_cancelacion, variacion: varPp, sin_base_comparacion: false, es_pp: true };
      }
    }

    return {
      actual,
      anterior,
      variaciones
    };
  }

  static async obtenerPedidos(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      whereEnvio['$items.producto_id$'] = filtros.producto_id;
    }

    const { count, rows } = await Envio.findAndCountAll({
      where: whereEnvio,
      limit: limite,
      offset: offset,
      order: [['id', 'DESC']],
      distinct: true,
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

    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.like]: `%${buscador}%` } },
        { id: { [Op.like]: `%${buscador}%` } },
        { telefono: { [Op.like]: `%${buscador}%` } }
      ];
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
      attributes: ['monto', 'comision_pct_aplicada', 'metodo_pago']
    });
    
    let totalFacturado = 0;
    let totalComisiones = 0;
    const metodos = {};
    
    kpisRaw.forEach(e => {
      const monto = Number(e.monto) || 0;
      const comision = Number(e.comision_pct_aplicada) || 0;
      const costo = Math.round(monto * (comision / 100));
      const mPago = e.metodo_pago || 'No especificado';
      
      totalFacturado += monto;
      totalComisiones += costo;
      
      if (!metodos[mPago]) metodos[mPago] = { monto: 0, comision: 0, count: 0 };
      metodos[mPago].monto += monto;
      metodos[mPago].comision += costo;
      metodos[mPago].count += 1;
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
      },
      distribucion_metodos: metodos
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
          venta_total: 0,
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
        mapa[p_id].venta_total += Number(item.subtotal) || 0;

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
      const ingresos = p.venta_total - p.costo_total;
      const fila = {
        ...p,
        ingresos,
        precio_costo_unitario: p.vendidos > 0 ? Math.round(p.costo_total / p.vendidos) : p._costo_catalogo,
        precio_venta_unitario: p.vendidos > 0 ? Math.round(p.venta_total / p.vendidos) : p._ultimo_precio_venta,
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

    // Generar Top 5 para gráficos
    const topVendidos = [...arrayData]
      .sort((a, b) => b.vendidos - a.vendidos)
      .slice(0, 5)
      .filter(p => p.vendidos > 0);

    const topDevoluciones = [...arrayData]
      .map(p => {
        const tasa = p.total_procesados > 0 ? (p.devoluciones / p.total_procesados) * 100 : 0;
        return { ...p, tasa_devolucion: tasa };
      })
      .filter(p => p.tasa_devolucion >= 15 && p.total_procesados > 5) // Omitir cosas raras como 1 de 1
      .sort((a, b) => b.tasa_devolucion - a.tasa_devolucion)
      .slice(0, 5);

    return {
      total: totalCount,
      paginas: Math.ceil(totalCount / limite),
      actual: pagina,
      data: paginated,
      kpis: {
        total_unidades: totalUnidades,
        total_ingresos: totalIngresos,
        producto_estrella: topProducto
      },
      top5: {
        vendidos: topVendidos,
        devoluciones: topDevoluciones
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
  static async obtenerEvolucionVentas(usuario_id, filtros = {}) {
    const { Op } = require('sequelize');
    const { Envio, EnvioItem } = require('../models');
    
    // Solo ventas concretadas
    let whereConcretados = { usuario_id, estado: 'Entregado' };
    whereConcretados = this._aplicarFiltrosGlobales(whereConcretados, filtros);
    
    const includeQuery = (filtros.producto_id && filtros.producto_id !== 'TODOS') ? [{
      model: EnvioItem, as: 'items', attributes: []
    }] : [];

    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      whereConcretados['$items.producto_id$'] = filtros.producto_id;
    }

    const ventasPorFecha = await Envio.findAll({
      attributes: [
        'fecha',
        [Envio.sequelize.fn('SUM', Envio.sequelize.col('monto')), 'monto_total'],
        [Envio.sequelize.fn('COUNT', Envio.sequelize.fn('DISTINCT', Envio.sequelize.col('Envio.id'))), 'cantidad_pedidos']
      ],
      where: whereConcretados,
      include: includeQuery,
      group: ['fecha'],
      order: [['fecha', 'ASC']],
      raw: true
    });

    // Total pedidos creados (independiente del estado)
    let whereTodos = { usuario_id };
    whereTodos = this._aplicarFiltrosGlobales(whereTodos, filtros);
    if (filtros.producto_id && filtros.producto_id !== 'TODOS') {
      whereTodos['$items.producto_id$'] = filtros.producto_id;
    }

    const pedidosTotalesPorFecha = await Envio.findAll({
      attributes: [
        'fecha',
        [Envio.sequelize.fn('COUNT', Envio.sequelize.fn('DISTINCT', Envio.sequelize.col('Envio.id'))), 'cantidad_pedidos_totales']
      ],
      where: whereTodos,
      include: includeQuery,
      group: ['fecha'],
      raw: true
    });

    const mapaTotales = {};
    pedidosTotalesPorFecha.forEach(r => {
      mapaTotales[r.fecha] = parseInt(r.cantidad_pedidos_totales) || 0;
    });

    return ventasPorFecha.map(r => ({
      fecha: r.fecha,
      ventas: parseInt(r.monto_total) || 0,
      pedidos_concretados: parseInt(r.cantidad_pedidos) || 0,
      pedidos_totales: mapaTotales[r.fecha] || 0
    }));
  }
}

module.exports = ReporteService;
