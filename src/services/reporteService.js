const { Op, fn, col, literal } = require('sequelize');
const { Envio, EnvioItem, EnvioItemComponente, Producto, Oferta, Usuario, ProductoVariante, MetodoPago, Courier } = require('../models');
const { ESTADOS_ANALITICA } = require('../utils/analyticsConstants');
const { resolverRangoFechas } = require('../utils/rangoFechas');

class ReporteService {
  /**
   * Asegura el scope del tenant filtrando envíos por los usuarios que pertenecen al inquilino,
   * o si se pasa usuario_id, filtra por ese usuario directamente.
   */
  static _aplicarFiltrosGlobales(whereEnvio, filtros) {
    const { estado, metodo_pago, canal_venta_id, ciudad, fecha_desde, fecha_hasta, buscador } = filtros;
    if (fecha_desde && fecha_hasta) {
      whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };
    }
    if (estado && estado !== 'TODOS') whereEnvio.estado = estado;
    if (metodo_pago && metodo_pago !== 'TODOS') whereEnvio.metodo_pago = metodo_pago;
    if (canal_venta_id && canal_venta_id !== 'TODOS') whereEnvio.canal_venta_id = canal_venta_id;
    if (ciudad) whereEnvio.ciudad = { [Op.iLike]: `%${ciudad}%` };
    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.iLike]: `%${buscador}%` } },
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.id'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.numero_pedido'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        { telefono: { [Op.iLike]: `%${buscador}%` } }
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
    let whereConcretados = { usuario_id, estado: ESTADOS_ANALITICA.EXITOSOS };
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
    let whereCancelados = { usuario_id, estado: ESTADOS_ANALITICA.FALLIDOS };
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
      if (ESTADOS_ANALITICA.EXITOSOS.includes(d.estado)) ent += parseInt(d.total);
      else if (ESTADOS_ANALITICA.FALLIDOS.includes(d.estado)) canc += parseInt(d.total);
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
      estado: ESTADOS_ANALITICA.EXITOSOS,
      usuario_id: usuario_id 
    };
    
    if (fecha_desde && fecha_hasta) {
      whereEnvio.fecha = { [Op.between]: [fecha_desde, fecha_hasta] };
    }

    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.iLike]: `%${buscador}%` } },
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.id'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.numero_pedido'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        { telefono: { [Op.iLike]: `%${buscador}%` } }
      ];
    }

    const { count, rows } = await EnvioItem.findAndCountAll({
      limit: limite,
      offset: offset,
      include: [
        {
          model: Envio,
          where: whereEnvio,
          attributes: ['id', 'numero_pedido', 'cliente', 'fecha', 'hora', 'monto', 'metodo_pago', 'quiere_factura']
        },
        {
          model: Oferta,
          attributes: ['id', 'estrategia', 'tipo_contenido', 'codigo', 'nombre']
        },
        {
          model: Producto,
          attributes: ['id', 'nombre', 'sku']
        },
        {
          model: ProductoVariante,
          as: 'Variante',
          attributes: ['id', 'nombre', 'sku_variante']
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
      estado: ESTADOS_ANALITICA.EXITOSOS
    };
    
    if (desde && hasta) {
      whereEnvio.fecha = { [Op.between]: [desde, hasta] };
    }

    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.iLike]: `%${buscador}%` } },
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.id'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.numero_pedido'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        { telefono: { [Op.iLike]: `%${buscador}%` } }
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
      estado: ESTADOS_ANALITICA.EXITOSOS
    };
    
    if (desde && hasta) {
      whereEnvio.fecha = { [Op.between]: [desde, hasta] };
    }

    if (buscador) {
      whereEnvio[Op.or] = [
        { cliente: { [Op.iLike]: `%${buscador}%` } },
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.id'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        Envio.sequelize.where(Envio.sequelize.cast(Envio.sequelize.col('Envio.numero_pedido'), 'varchar'), { [Op.like]: `%${buscador}%` }),
        { telefono: { [Op.iLike]: `%${buscador}%` } },
        { ruc: { [Op.iLike]: `%${buscador}%` } },
        { razon_social: { [Op.iLike]: `%${buscador}%` } }
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
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);

    const includeArray = [
      {
        model: Envio,
        where: whereEnvio,
        attributes: ['id', 'estado']
      },
      {
        model: Producto,
        attributes: ['id', 'nombre', 'sku']
      },
      {
        model: ProductoVariante,
        as: 'Variante',
        attributes: ['id', 'nombre', 'sku_variante']
      }
    ];

    const items = await EnvioItem.findAll({ include: includeArray });

    const mapa = {};
    const sumatoriaVentasNetas = { total: 0 };
    const pedidosPorProducto = {};

    items.forEach(item => {
      const p_id = item.producto_id || ('SIN_ID_' + item.nombre_producto);
      const v_id = item.variante_id || 'SIN_VAR';
      
      if (!mapa[p_id]) {
        mapa[p_id] = {
          id: p_id,
          nombre: item.Producto?.nombre || item.nombre_producto,
          sku: item.Producto?.sku || '-',
          unidades_vendidas: 0,
          ventas_netas: 0,
          pedidos_unicos: 0,
          variantes: {}
        };
        pedidosPorProducto[p_id] = new Set();
      }

      const pObj = mapa[p_id];
      if (!pObj.variantes[v_id]) {
        pObj.variantes[v_id] = {
          id: v_id,
          nombre: item.Variante?.nombre || 'Única / Base',
          sku: item.Variante?.sku_variante || '-',
          unidades_vendidas: 0,
          ventas_netas: 0,
          pedidos_unicos: 0
        };
      }
      
      const vObj = pObj.variantes[v_id];
      const st = (item.Envio.estado || '');
      const cant = Number(item.cantidad) || 0;
      const subt = Number(item.subtotal) || 0;
      
      if (ESTADOS_ANALITICA.EXITOSOS.includes(st)) {
        pObj.unidades_vendidas += cant;
        pObj.ventas_netas += subt;
        vObj.unidades_vendidas += cant;
        vObj.ventas_netas += subt;
        
        sumatoriaVentasNetas.total += subt;

        pedidosPorProducto[p_id].add(item.Envio.id);
        vObj._pedidos = vObj._pedidos || new Set();
        vObj._pedidos.add(item.Envio.id);
      }
    });

    let arrayData = Object.values(mapa).map(p => {
      p.pedidos_unicos = pedidosPorProducto[p.id].size;
      p.precio_promedio = p.unidades_vendidas > 0 ? Math.round(p.ventas_netas / p.unidades_vendidas) : 0;
      p.participacion = sumatoriaVentasNetas.total > 0 ? (p.ventas_netas / sumatoriaVentasNetas.total) * 100 : 0;
      
      p.variantes = Object.values(p.variantes).map(v => {
        v.pedidos_unicos = (v._pedidos || new Set()).size;
        v.precio_promedio = v.unidades_vendidas > 0 ? Math.round(v.ventas_netas / v.unidades_vendidas) : 0;
        v.participacion = sumatoriaVentasNetas.total > 0 ? (v.ventas_netas / sumatoriaVentasNetas.total) * 100 : 0;
        delete v._pedidos;
        return v;
      }).sort((a, b) => b.ventas_netas - a.ventas_netas);

      return p;
    });

    if (filtros.buscador) {
      const b = filtros.buscador.toLowerCase();
      arrayData = arrayData.filter(p => p.nombre.toLowerCase().includes(b) || p.sku.toLowerCase().includes(b));
    }

    arrayData.sort((a, b) => b.ventas_netas - a.ventas_netas);

    const totalCount = arrayData.length;
    const paginated = arrayData.slice(offset, offset + limite);

    const totalUnidades = arrayData.reduce((acc, curr) => acc + curr.unidades_vendidas, 0);
    const totalVentasNetas = arrayData.reduce((acc, curr) => acc + curr.ventas_netas, 0);

    return {
      total: totalCount,
      paginas: Math.ceil(totalCount / limite) || 1,
      actual: pagina,
      data: paginated,
      kpis: {
        unidades_vendidas: totalUnidades,
        ventas_netas: totalVentasNetas,
        producto_estrella: arrayData[0] && arrayData[0].unidades_vendidas > 0 ? arrayData[0].nombre : 'Ninguno'
      }
    };
  }

  static async obtenerReporteComposicion(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);
    
    const includeArray = [
      {
        model: Envio,
        where: whereEnvio,
        attributes: ['id', 'estado']
      },
      {
        model: Oferta,
        attributes: ['estrategia']
      }
    ];

    const items = await EnvioItem.findAll({ include: includeArray });

    const mapa = {
      'BASE': { id: 'BASE', nombre: 'Base (Orgánico)', unidades_vendidas: 0, ventas_netas: 0, pedidos_unicos: 0 },
      'ORDER_BUMP': { id: 'ORDER_BUMP', nombre: 'Order Bump', unidades_vendidas: 0, ventas_netas: 0, pedidos_unicos: 0 },
      'UPSELL': { id: 'UPSELL', nombre: 'Upsell', unidades_vendidas: 0, ventas_netas: 0, pedidos_unicos: 0 }
    };
    const pedidosPorRol = { 'BASE': new Set(), 'ORDER_BUMP': new Set(), 'UPSELL': new Set() };
    const pedidosTotalesSet = new Set();
    const pedidosConEstrategiaSet = new Set();

    items.forEach(item => {
      const st = (item.Envio.estado || '');
      if (!ESTADOS_ANALITICA.EXITOSOS.includes(st)) return;

      const oferta = item.Ofertum || item.Oferta;
      const rol = !oferta ? 'BASE' : (oferta.estrategia === 'order_bump' ? 'ORDER_BUMP' : (oferta.estrategia === 'upsell' ? 'UPSELL' : 'BASE'));
      
      const cant = Number(item.cantidad) || 0;
      const subt = Number(item.subtotal) || 0;

      mapa[rol].unidades_vendidas += cant;
      mapa[rol].ventas_netas += subt;
      pedidosPorRol[rol].add(item.Envio.id);
      
      pedidosTotalesSet.add(item.Envio.id);
      if (rol === 'ORDER_BUMP' || rol === 'UPSELL') {
        pedidosConEstrategiaSet.add(item.Envio.id);
      }
    });

    const totalVentasNetas = Object.values(mapa).reduce((sum, r) => sum + r.ventas_netas, 0);

    const arrayData = Object.values(mapa).map(r => {
      r.pedidos_unicos = pedidosPorRol[r.id].size;
      r.participacion = totalVentasNetas > 0 ? (r.ventas_netas / totalVentasNetas) * 100 : 0;
      r.precio_promedio = r.unidades_vendidas > 0 ? Math.round(r.ventas_netas / r.unidades_vendidas) : 0;
      return r;
    }).sort((a, b) => b.ventas_netas - a.ventas_netas);

    const pedidosExitosos = pedidosTotalesSet.size;
    const rendimientoCarrito = pedidosExitosos > 0 ? (pedidosConEstrategiaSet.size / pedidosExitosos) * 100 : 0;

    return {
      data: arrayData,
      kpis: {
        rendimiento_carrito: rendimientoCarrito,
        ventas_estrategicas: mapa['ORDER_BUMP'].ventas_netas + mapa['UPSELL'].ventas_netas,
        ventas_netas: totalVentasNetas
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
    let whereConcretados = { usuario_id, estado: ESTADOS_ANALITICA.EXITOSOS };
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
  // --- FASE 3: Deep-Dives ---

  static getClienteKeySql() {
    return `
      CASE 
        WHEN "Envio"."telefono" IS NOT NULL AND TRIM("Envio"."telefono") != '' 
        THEN 'TEL:' || REGEXP_REPLACE("Envio"."telefono", '[^0-9]', '', 'g')
        ELSE 'PEDIDO:' || "Envio"."id"::text
      END
    `;
  }

  static async obtenerReporteClientes(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);

    const clienteKeyLiteral = literal(this.getClienteKeySql());

    // 1. Actividad del período
    const enviosPeriodo = await Envio.findAll({
      where: whereEnvio,
      attributes: [
        [clienteKeyLiteral, 'cliente_key'],
        'estado'
      ],
      raw: true
    });

    const clientesConPedido = new Set();
    const clientesCompradores = new Set();
    const mapNombres = {};

    enviosPeriodo.forEach(e => {
      clientesConPedido.add(e.cliente_key);
      if (ESTADOS_ANALITICA.EXITOSOS.includes(e.estado)) {
        clientesCompradores.add(e.cliente_key);
      }
    });

    if (clientesCompradores.size === 0) {
      return {
        total: 0, paginas: 1, actual: pagina, data: [],
        kpis: {
          clientes_con_pedido: clientesConPedido.size,
          clientes_compradores: 0,
          tasa_conversion_pedido: 0,
          clientes_recurrentes: 0
        }
      };
    }

    // Nombres recientes de los compradores del periodo
    const enviosNombres = await Envio.findAll({
      where: { ...whereEnvio, estado: ESTADOS_ANALITICA.EXITOSOS },
      attributes: [[clienteKeyLiteral, 'cliente_key'], 'cliente', 'telefono'],
      raw: true,
      order: [['fecha', 'DESC']]
    });
    enviosNombres.forEach(e => {
      if (!mapNombres[e.cliente_key]) {
        mapNombres[e.cliente_key] = { nombre: e.cliente, telefono: e.telefono };
      }
    });

    // 2. Historial hasta fecha_hasta de esos clientes
    let whereHistorial = { usuario_id, estado: ESTADOS_ANALITICA.EXITOSOS };
    if (filtros.fecha_hasta) {
      whereHistorial.fecha = { [Op.lte]: filtros.fecha_hasta };
    }

    // Traemos todo el historial de exitosos para esos cliente_keys
    // Como SQL IN no es fácil con un REGEXP_REPLACE sobre miles de keys, 
    // calculamos los totales por cliente_key en la BD y luego filtramos en JS.
    const historicosAgrupados = await Envio.findAll({
      where: whereHistorial,
      attributes: [
        [clienteKeyLiteral, 'cliente_key'],
        [fn('COUNT', col('id')), 'pedidos_exitosos'],
        [fn('SUM', col('monto')), 'total_comprado'],
        [fn('MAX', col('fecha')), 'ultima_compra']
      ],
      group: [clienteKeyLiteral],
      raw: true
    });

    let clientes_recurrentes = 0;
    const arrayData = [];

    historicosAgrupados.forEach(h => {
      if (clientesCompradores.has(h.cliente_key)) {
        const pedExit = parseInt(h.pedidos_exitosos) || 0;
        const totComp = parseInt(h.total_comprado) || 0;
        if (pedExit >= 2) clientes_recurrentes++;
        
        arrayData.push({
          cliente_key: h.cliente_key,
          nombre: mapNombres[h.cliente_key]?.nombre || 'Desconocido',
          telefono: mapNombres[h.cliente_key]?.telefono || '-',
          pedidos_exitosos: pedExit,
          total_comprado: totComp,
          ticket_promedio: pedExit > 0 ? Math.round(totComp / pedExit) : 0,
          ultima_compra: h.ultima_compra
        });
      }
    });

    arrayData.sort((a, b) => b.total_comprado - a.total_comprado);
    const paginated = arrayData.slice(offset, offset + limite);

    return {
      total: arrayData.length,
      paginas: Math.ceil(arrayData.length / limite) || 1,
      actual: pagina,
      data: paginated,
      kpis: {
        clientes_con_pedido: clientesConPedido.size,
        clientes_compradores: clientesCompradores.size,
        tasa_conversion_pedido: clientesConPedido.size > 0 ? (clientesCompradores.size / clientesConPedido.size) * 100 : 0,
        clientes_recurrentes
      }
    };
  }

  static async obtenerReporteMetodosPago(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);

    const includeArray = [
      {
        model: MetodoPago,
        attributes: ['id', 'nombre'],
        required: false
      }
    ];

    const envios = await Envio.findAll({
      where: whereEnvio,
      include: includeArray,
      attributes: ['id', 'estado', 'monto', 'metodo_pago_id']
    });

    const mapa = {};
    let totalPedidos = 0;
    let totalExitosos = 0;
    let totalFallidos = 0;
    let totalAbiertos = 0;
    let totalVentasNetas = 0;

    envios.forEach(e => {
      const isExitoso = ESTADOS_ANALITICA.EXITOSOS.includes(e.estado);
      const isFallido = ESTADOS_ANALITICA.FALLIDOS.includes(e.estado);
      const isAbierto = !isExitoso && !isFallido;

      const metodoKey = e.metodo_pago_id ? `M_${e.metodo_pago_id}` : 'SIN_METODO';
      const metodoNombre = e.MetodoPago ? e.MetodoPago.nombre : (e.metodo_pago_id ? 'Método Desconocido' : 'Sin método informado');

      if (!mapa[metodoKey]) {
        mapa[metodoKey] = {
          id: metodoKey,
          nombre: metodoNombre,
          pedidos_totales: 0,
          pedidos_exitosos: 0,
          pedidos_fallidos: 0,
          pedidos_abiertos: 0,
          pedidos_cerrados: 0,
          ventas_netas: 0
        };
      }

      totalPedidos++;
      mapa[metodoKey].pedidos_totales++;

      if (isExitoso) {
        mapa[metodoKey].pedidos_exitosos++;
        mapa[metodoKey].pedidos_cerrados++;
        mapa[metodoKey].ventas_netas += e.monto;
        totalExitosos++;
        totalVentasNetas += e.monto;
      } else if (isFallido) {
        mapa[metodoKey].pedidos_fallidos++;
        mapa[metodoKey].pedidos_cerrados++;
        totalFallidos++;
      } else {
        mapa[metodoKey].pedidos_abiertos++;
        totalAbiertos++;
      }
    });

    const arrayData = Object.values(mapa).map(m => {
      m.tasa_exito = m.pedidos_cerrados > 0 ? (m.pedidos_exitosos / m.pedidos_cerrados) * 100 : null;
      m.tasa_fallo = m.pedidos_cerrados > 0 ? (m.pedidos_fallidos / m.pedidos_cerrados) * 100 : null;
      m.participacion = totalVentasNetas > 0 ? (m.ventas_netas / totalVentasNetas) * 100 : 0;
      m.ticket_promedio = m.pedidos_exitosos > 0 ? Math.round(m.ventas_netas / m.pedidos_exitosos) : 0;
      return m;
    }).sort((a, b) => b.ventas_netas - a.ventas_netas);

    return {
      total: arrayData.length,
      paginas: Math.ceil(arrayData.length / limite) || 1,
      actual: pagina,
      data: arrayData.slice(offset, offset + limite),
      kpis: {
        total_pedidos: totalPedidos,
        total_exitosos: totalExitosos,
        total_fallidos: totalFallidos,
        total_abiertos: totalAbiertos,
        pedidos_cerrados: totalExitosos + totalFallidos,
        total_ventas_netas: totalVentasNetas
      }
    };
  }

  static async obtenerReporteFallos(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);

    const envios = await Envio.findAll({
      where: whereEnvio,
      attributes: ['id', 'estado', 'monto', 'costo_envio']
    });

    let pedidosTotales = envios.length;
    let pedidosCerrados = 0;
    let pedidosFallidos = 0;
    let ventaPotencial = 0;
    let costoOperativoAsociado = 0;

    const mapaMotivos = {};

    envios.forEach(e => {
      const isExitoso = ESTADOS_ANALITICA.EXITOSOS.includes(e.estado);
      const isFallido = ESTADOS_ANALITICA.FALLIDOS.includes(e.estado);

      if (isExitoso || isFallido) pedidosCerrados++;

      if (isFallido) {
        pedidosFallidos++;
        ventaPotencial += e.monto; // Venta potencial no realizada canónica (monto final del pedido)
        costoOperativoAsociado += (Number(e.costo_envio) || 0);

        // Como no tenemos tabla de motivos aun, agruparemos por Estado como fallback/primer paso
        const motivo = e.estado || 'Desconocido';
        if (!mapaMotivos[motivo]) {
          mapaMotivos[motivo] = {
            motivo: motivo,
            pedidos: 0,
            venta_potencial: 0,
            costo_operativo: 0
          };
        }
        mapaMotivos[motivo].pedidos++;
        mapaMotivos[motivo].venta_potencial += e.monto;
        mapaMotivos[motivo].costo_operativo += (Number(e.costo_envio) || 0);
      }
    });

    const arrayData = Object.values(mapaMotivos).map(m => {
      m.participacion = pedidosFallidos > 0 ? (m.pedidos / pedidosFallidos) * 100 : 0;
      return m;
    }).sort((a, b) => b.pedidos - a.pedidos);

    return {
      total: arrayData.length,
      paginas: Math.ceil(arrayData.length / limite) || 1,
      actual: pagina,
      data: arrayData.slice(offset, offset + limite),
      kpis: {
        pedidos_fallidos: pedidosFallidos,
        tasa_fallo: pedidosCerrados > 0 ? (pedidosFallidos / pedidosCerrados) * 100 : 0,
        venta_potencial_no_realizada: ventaPotencial,
        costo_operativo_asociado: costoOperativoAsociado
      }
    };
  }


  // --- FASE 4: Deep-Dives (Geografía, Logística, Cross-Selling) ---

  static async obtenerReporteGeografia(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);

    const envios = await Envio.findAll({
      where: whereEnvio,
      attributes: ['id', 'estado', 'monto', 'ciudad', 'departamento']
    });

    const mapa = {};
    let ventasNetasGlobales = 0;

    envios.forEach(e => {
      const isExitoso = ESTADOS_ANALITICA.EXITOSOS.includes(e.estado);
      const isFallido = ESTADOS_ANALITICA.FALLIDOS.includes(e.estado);
      if (!isExitoso && !isFallido) return; // solo cerrados para las tasas

      // Normalizar ubicación
      const ciudad = (e.ciudad && e.ciudad.trim()) ? e.ciudad.trim() : null;
      const departamento = (e.departamento && e.departamento.trim()) ? e.departamento.trim() : null;
      
      // Clave compuesta: si no hay ciudad, agrupar como "Sin ubicación"
      const geoKey = ciudad
        ? `${departamento || 'Sin departamento'}|${ciudad}`
        : 'SIN_UBICACION|Sin ubicación';
      
      if (!mapa[geoKey]) {
        mapa[geoKey] = {
          departamento: departamento || (ciudad ? 'Sin departamento' : null),
          ciudad: ciudad || 'Sin ubicación',
          pedidos_exitosos: 0,
          pedidos_fallidos: 0,
          pedidos_cerrados: 0,
          ventas_netas: 0
        };
      }

      mapa[geoKey].pedidos_cerrados++;
      if (isExitoso) {
        mapa[geoKey].pedidos_exitosos++;
        mapa[geoKey].ventas_netas += Number(e.monto) || 0;
        ventasNetasGlobales += Number(e.monto) || 0;
      } else {
        mapa[geoKey].pedidos_fallidos++;
      }
    });

    // Calcular métricas derivadas
    let arrayData = Object.values(mapa).map(g => {
      g.tasa_fallo = g.pedidos_cerrados > 0 ? (g.pedidos_fallidos / g.pedidos_cerrados) * 100 : null;
      g.ticket_promedio = g.pedidos_exitosos > 0 ? Math.round(g.ventas_netas / g.pedidos_exitosos) : 0;
      g.participacion_ventas = ventasNetasGlobales > 0 ? (g.ventas_netas / ventasNetasGlobales) * 100 : 0;

      // Semáforo basado en muestra mínima + tasa de fallo
      // ⚪ < 10 cerrados → sin datos suficientes
      // 🟢 < 15% fallo
      // 🟡 15-30%
      // 🔴 > 30%
      if (g.pedidos_cerrados < 10) {
        g.semaforo = 'sin_datos';
      } else if (g.tasa_fallo < 15) {
        g.semaforo = 'bajo';
      } else if (g.tasa_fallo <= 30) {
        g.semaforo = 'medio';
      } else {
        g.semaforo = 'alto';
      }

      return g;
    });

    arrayData.sort((a, b) => b.ventas_netas - a.ventas_netas);

    return {
      total: arrayData.length,
      paginas: Math.ceil(arrayData.length / limite) || 1,
      actual: pagina,
      data: arrayData.slice(offset, offset + limite),
      kpis: {
        ventas_netas_globales: ventasNetasGlobales,
        ciudades_activas: arrayData.filter(g => g.pedidos_exitosos > 0 && g.ciudad !== 'Sin ubicación').length,
        ciudad_top: arrayData.find(g => g.ciudad !== 'Sin ubicación')?.ciudad || '-'
      }
    };
  }

  static async obtenerReporteLogistica(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);

    const envios = await Envio.findAll({
      where: whereEnvio,
      attributes: ['id', 'estado', 'courier_id', 'costo_envio'],
      include: [{
        model: Courier,
        attributes: ['id', 'nombre'],
        required: false
      }]
    });

    const mapa = {};
    let totalEntregados = 0;

    envios.forEach(e => {
      const isEntregado = e.estado === 'Entregado';
      const isDevuelto = ['Devuelto', 'Rechazado'].includes(e.estado);
      const isEnTransito = ['Pendiente', 'Confirmado', 'Empacado', 'En tránsito'].includes(e.estado);
      const isCancelado = e.estado === 'Cancelado'; // cancelado antes de asignarse a courier

      const courierKey = e.courier_id ? `C_${e.courier_id}` : 'SIN_COURIER';
      const courierNombre = e.Courier ? e.Courier.nombre : (e.courier_id ? 'Courier Desconocido' : 'Sin courier asignado');

      if (!mapa[courierKey]) {
        mapa[courierKey] = {
          id: courierKey,
          nombre: courierNombre,
          pedidos_asignados: 0,
          pedidos_entregados: 0,
          pedidos_devueltos: 0,
          pedidos_en_transito: 0,
          pedidos_logisticos_cerrados: 0, // entregados + devueltos
          costo_total_envio: 0,
          tasa_entrega: null,
          costo_promedio_envio: 0,
          costo_por_entrega_exitosa: null
        };
      }

      const r = mapa[courierKey];

      // Solo contamos pedidos que realmente le fueron asignados
      if (!isCancelado) r.pedidos_asignados++;

      if (isEntregado) {
        r.pedidos_entregados++;
        r.pedidos_logisticos_cerrados++;
        r.costo_total_envio += Number(e.costo_envio) || 0;
        totalEntregados++;
      } else if (isDevuelto) {
        r.pedidos_devueltos++;
        r.pedidos_logisticos_cerrados++;
        r.costo_total_envio += Number(e.costo_envio) || 0;
      } else if (isEnTransito) {
        r.pedidos_en_transito++;
      }
    });

    const arrayData = Object.values(mapa).map(r => {
      // Tasa de entrega solo sobre cerrados logísticos (entregado + devuelto)
      r.tasa_entrega = r.pedidos_logisticos_cerrados > 0
        ? (r.pedidos_entregados / r.pedidos_logisticos_cerrados) * 100
        : null;

      // Costo promedio sobre todos los que tuvieron movimiento (entregados + devueltos)
      const pedidosConCosto = r.pedidos_entregados + r.pedidos_devueltos;
      r.costo_promedio_envio = pedidosConCosto > 0 ? Math.round(r.costo_total_envio / pedidosConCosto) : 0;

      // Costo por entrega exitosa: métrica de eficiencia económica
      r.costo_por_entrega_exitosa = r.pedidos_entregados > 0
        ? Math.round(r.costo_total_envio / r.pedidos_entregados)
        : null;

      return r;
    }).sort((a, b) => b.pedidos_entregados - a.pedidos_entregados);

    return {
      total: arrayData.length,
      paginas: Math.ceil(arrayData.length / limite) || 1,
      actual: pagina,
      data: arrayData.slice(offset, offset + limite),
      kpis: {
        total_entregados: totalEntregados,
        couriers_activos: arrayData.filter(c => c.pedidos_asignados > 0 && c.id !== 'SIN_COURIER').length
      }
    };
  }

  static async obtenerReporteCrossSelling(usuario_id, pagina = 1, limite = 50, filtros = {}) {
    const offset = (pagina - 1) * limite;
    let whereEnvio = { usuario_id };
    whereEnvio = this._aplicarFiltrosGlobales(whereEnvio, filtros);

    // 1. Traer todos los items de pedidos EXITOSOS
    //    (DISTINCT producto_id por pedido para evitar inflar pares por cantidades)
    const items = await EnvioItem.findAll({
      include: [{
        model: Envio,
        where: whereEnvio,
        attributes: ['id', 'estado', 'monto'],
        required: true
      }, {
        model: Producto,
        attributes: ['id', 'nombre'],
        required: false
      }],
      attributes: ['envio_id', 'producto_id', 'nombre_producto', 'subtotal'],
      where: { producto_id: { [Op.ne]: null } }
    });

    // 2. Agrupar: mapa envio_id → Set de producto_ids (únicos por pedido)
    const pedidoProductos = {};     // envio_id → { prodId → { nombre, subtotal } }
    const pedidosExitosos = new Set();
    const productoPedidos = {};     // prodId → Set de envio_ids (para calcular totales por producto)
    const productoNombres = {};

    items.forEach(item => {
      const envio = item.Envio;
      if (!ESTADOS_ANALITICA.EXITOSOS.includes(envio.estado)) return;

      const envioId = item.envio_id;
      const prodId = item.producto_id;
      const nombre = item.Producto?.nombre || item.nombre_producto || `Producto ${prodId}`;
      
      pedidosExitosos.add(envioId);
      
      if (!pedidoProductos[envioId]) pedidoProductos[envioId] = {};
      if (!pedidoProductos[envioId][prodId]) {
        pedidoProductos[envioId][prodId] = { nombre, monto: Number(envio.monto) || 0 };
      }
      
      if (!productoPedidos[prodId]) productoPedidos[prodId] = new Set();
      productoPedidos[prodId].add(envioId);
      productoNombres[prodId] = nombre;
    });

    // 3. Generar pares canónicos: a.id < b.id (evita A+B y B+A)
    const pares = {};

    Object.entries(pedidoProductos).forEach(([envioId, productos]) => {
      const prodIds = Object.keys(productos).map(Number).sort((a, b) => a - b);
      const monto = Object.values(productos)[0]?.monto || 0;

      for (let i = 0; i < prodIds.length; i++) {
        for (let j = i + 1; j < prodIds.length; j++) {
          const idA = prodIds[i];
          const idB = prodIds[j];
          const parKey = `${idA}|${idB}`;

          if (!pares[parKey]) {
            pares[parKey] = {
              producto_a_id: idA,
              producto_a: productoNombres[idA] || `Producto ${idA}`,
              producto_b_id: idB,
              producto_b: productoNombres[idB] || `Producto ${idB}`,
              pedidos_juntos: 0,
              ventas_pedidos_combinados: 0
            };
          }

          pares[parKey].pedidos_juntos++;
          pares[parKey].ventas_pedidos_combinados += monto;
        }
      }
    });

    // 4. Calcular tasas de combinación: A→B y B→A
    //    tasa_a_con_b = pedidos_juntos / total_pedidos_de_A
    const arrayData = Object.values(pares).map(par => {
      const pedidosA = productoPedidos[par.producto_a_id]?.size || 0;
      const pedidosB = productoPedidos[par.producto_b_id]?.size || 0;

      // Validación de invariante: pedidos_juntos <= min(pedidos_A, pedidos_B)
      const pedidosJuntos = Math.min(par.pedidos_juntos, Math.min(pedidosA, pedidosB));

      const tasa_a_con_b = pedidosA > 0 ? (pedidosJuntos / pedidosA) * 100 : 0;
      const tasa_b_con_a = pedidosB > 0 ? (pedidosJuntos / pedidosB) * 100 : 0;

      // LIFT: P(A∩B) / (P(A) * P(B))
      // Arquitectura preparada — no se muestra en el frontend de Fase 4
      const totalPedidos = pedidosExitosos.size;
      const pA = pedidosA / totalPedidos;
      const pB = pedidosB / totalPedidos;
      const pAB = pedidosJuntos / totalPedidos;
      const lift = (pA > 0 && pB > 0) ? pAB / (pA * pB) : null;

      return {
        producto_a_id: par.producto_a_id,
        producto_a: par.producto_a,
        producto_b_id: par.producto_b_id,
        producto_b: par.producto_b,
        pedidos_juntos: pedidosJuntos,
        pedidos_producto_a: pedidosA,
        pedidos_producto_b: pedidosB,
        tasa_a_con_b: Math.round(tasa_a_con_b * 10) / 10,
        tasa_b_con_a: Math.round(tasa_b_con_a * 10) / 10,
        ventas_pedidos_combinados: par.ventas_pedidos_combinados,
        lift // preparado para futuras vistas de recomendaciones
      };
    });

    arrayData.sort((a, b) => b.pedidos_juntos - a.pedidos_juntos);

    return {
      total: arrayData.length,
      paginas: Math.ceil(arrayData.length / limite) || 1,
      actual: pagina,
      data: arrayData.slice(offset, offset + limite),
      kpis: {
        pares_detectados: arrayData.length,
        pedidos_exitosos_analizados: pedidosExitosos.size,
        par_top: arrayData[0]
          ? `${arrayData[0].producto_a} + ${arrayData[0].producto_b}`
          : 'Sin datos'
      }
    };
  }

}

module.exports = ReporteService;
