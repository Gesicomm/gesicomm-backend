const { Envio, EnvioItem, EnvioItemComponente, EnvioIntentoEntrega, Courier, Producto, Oferta, OfertaComponente, MetodoPago, EnvioHistorial, Usuario, sequelize } = require('../models');
const { Op, Sequelize, Transaction } = require('sequelize');

const { getAnalyticsCompleto } = require('../services/pedidosAnalyticsService');
const { registrarHistorial } = require('../utils/historial');

/**
 * Resuelve qué producto(s) y cuántas unidades físicas hay que descontar del
 * stock para UN EnvioItem: si tiene oferta_id, la receta sale de los
 * componentes de esa oferta (multiplicados por la cantidad del ítem); si
 * no, es el caso simple de siempre (1 producto × cantidad).
 */
async function resolverReceta(item, t) {
  const cantidadItem = parseInt(item.cantidad) || 1;
  if (item.oferta_id) {
    const oferta = await Oferta.findByPk(item.oferta_id, {
      include: [{ model: OfertaComponente, as: 'componentes' }],
      transaction: t,
    });
    if (oferta && oferta.componentes && oferta.componentes.length > 0) {
      return oferta.componentes.map(c => ({ producto_id: c.producto_id, cantidad: cantidadItem * c.cantidad }));
    }
  }
  if (item.producto_id) {
    return [{ producto_id: item.producto_id, cantidad: cantidadItem }];
  }
  return [];
}

/**
 * Cuánto le cuesta ESTE producto al comerciante que lo vende.
 *
 * No es `precio_costo`: ese es lo que le costó al ADMIN comprarlo a su
 * proveedor, y el modelo lo aclara ("Solo visible para administradores,
 * nunca se expone a no-admin"). El comerciante no compra a ese precio —
 * compra al `precio_base`, que es el precio de lista que le pone el admin.
 *
 *   Admin compra a 36.000 (precio_costo)  → margen del admin
 *   Comerciante compra a 40.000 (precio_base)  → SU costo
 *   Comerciante vende al precio que quiera (PrecioUsuario)
 *
 * Usar precio_costo hacía que la rentabilidad del comerciante mostrara el
 * margen del admin como si fuera suyo: ganancia inflada en la diferencia.
 *
 * Cuando el producto es PROPIO del comerciante (lo cargó él, con su costo y
 * su precio de venta), el costo sí es `precio_costo`. Hoy ese caso no puede
 * darse — el rol 'usuario' no tiene el permiso `crear_productos`, así que
 * todo el catálogo es del admin — pero la regla queda escrita para cuando
 * se habilite, en vez de quedar como una suposición implícita.
 */
function costoParaComerciante(prod, usuario_id) {
  if (!prod) return 0;

  const esPropio = prod.creado_por != null && prod.creado_por === usuario_id;
  if (esPropio) return parseFloat(prod.precio_costo) || 0;

  // Si un producto del catálogo no tiene precio_base cargado, se cae a
  // precio_costo: preferible un costo subestimado a contarlo como 0 y
  // mostrar el producto como pura ganancia.
  return parseFloat(prod.precio_base) || parseFloat(prod.precio_costo) || 0;
}

/**
 * Descuenta stock real y deja un snapshot inmutable (EnvioItemComponente) de
 * qué se descontó — para que un pedido confirmado nunca cambie de
 * significado si después se edita/da de baja la oferta que se usó.
 *
 * Atómico dentro de la transacción del caller: cada producto involucrado se
 * bloquea (SELECT ... FOR UPDATE) antes de leer/escribir su stock, así dos
 * confirmaciones concurrentes no pisan el stock una de la otra — la segunda
 * espera a que la primera confirme y lee el valor ya actualizado.
 *
 * `usuario_id` es el dueño del pedido: hace falta para saber si el producto
 * es propio del comerciante o del catálogo del admin (ver costoParaComerciante).
 */
async function descontarStockYSnapshot(items, t, usuario_id) {
  const recetaPorItem = new Map();
  const totalPorProducto = new Map();

  for (const item of items) {
    const receta = await resolverReceta(item, t);
    recetaPorItem.set(item.id, receta);
    for (const { producto_id, cantidad } of receta) {
      totalPorProducto.set(producto_id, (totalPorProducto.get(producto_id) || 0) + cantidad);
    }
  }

  const productosPorId = new Map();
  for (const [producto_id, cantidadTotal] of totalPorProducto) {
    const prod = await Producto.findByPk(producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (!prod) continue;
    productosPorId.set(producto_id, prod);

    const stockActual = parseInt(prod.cantidad_disponible) || 0;
    const nuevoStock = Math.max(0, stockActual - cantidadTotal);
    const nuevaReservada = (parseInt(prod.cantidad_reservada) || 0) + cantidadTotal;

    // De dónde sale físicamente: primero el mostrador, y recién cuando se
    // agota, el depósito. Se vende el TOTAL (tener la caja guardada no
    // frena una venta), pero el desglose tiene que seguir reflejando dónde
    // está la mercadería — si no, después de unas ventas deja de servir
    // para decidir cuándo reponer.
    const salonActual = parseInt(prod.stock_salon) || 0;
    const depositoActual = parseInt(prod.stock_deposito) || 0;
    const desdeSalon = Math.min(salonActual, cantidadTotal);
    const desdeDeposito = Math.min(depositoActual, cantidadTotal - desdeSalon);

    const actualizacion = {
      cantidad_disponible: nuevoStock,
      cantidad_reservada: nuevaReservada,
      stock_salon: salonActual - desdeSalon,
      stock_deposito: depositoActual - desdeDeposito,
    };
    if (nuevoStock === 0 && prod.estado_venta === 'en_venta') {
      actualizacion.estado_venta = 'fuera_de_stock';
    }
    await prod.update(actualizacion, { transaction: t });
  }

  for (const item of items) {
    const receta = recetaPorItem.get(item.id) || [];
    for (const { producto_id, cantidad } of receta) {
      const prod = productosPorId.get(producto_id);
      await EnvioItemComponente.create({
        envio_item_id: item.id,
        producto_id,
        cantidad,
        costo_unitario: costoParaComerciante(prod, usuario_id),
      }, { transaction: t });
    }
  }
}

/** Trae todos los EnvioItemComponente (snapshot de receta) de un conjunto de EnvioItem. */
async function obtenerComponentesDeItems(items, t) {
  const itemIds = items.map(i => i.id);
  if (itemIds.length === 0) return [];
  return EnvioItemComponente.findAll({ where: { envio_item_id: { [Op.in]: itemIds } }, transaction: t });
}

/**
 * Despachado: mueve stock reservado → tránsito para cada producto físico
 * involucrado en el pedido (según la receta ya snapshotteada). Idempotente
 * vía envio.stock_despachado (chequeado por el caller antes de invocar).
 */
async function moverAReservadoATransito(items, t) {
  const componentes = await obtenerComponentesDeItems(items, t);
  const totalPorProducto = new Map();
  for (const c of componentes) {
    totalPorProducto.set(c.producto_id, (totalPorProducto.get(c.producto_id) || 0) + c.cantidad);
  }
  for (const [producto_id, cantidad] of totalPorProducto) {
    const prod = await Producto.findByPk(producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (!prod) continue;
    const reservada = Math.max(0, (parseInt(prod.cantidad_reservada) || 0) - cantidad);
    const transito = (parseInt(prod.cantidad_transito) || 0) + cantidad;
    await prod.update({ cantidad_reservada: reservada, cantidad_transito: transito }, { transaction: t });
  }
}

/**
 * Entregado: la mercadería llegó al cliente, así que deja de estar "en
 * camino" — sale de cantidad_transito y no vuelve a ningún bucket (de
 * cantidad_disponible ya se había descontado al confirmar).
 *
 * Sin este paso, `cantidad_transito` solo crecía: cada pedido entregado
 * dejaba sus unidades trabadas ahí para siempre, y el contador terminaba
 * mostrando mercadería en camino que hacía rato estaba entregada.
 *
 * No lleva flag de idempotencia propio como los otros movimientos porque no
 * le hace falta: "Entregado" es un estado terminal (TRANSICIONES_VALIDAS lo
 * deja sin destinos), así que updateEstado no puede volver a entrar acá.
 * Solo se descuenta si el pedido pasó por Despachado — si nunca se despachó,
 * sus unidades jamás entraron a tránsito y restarlas rompería el contador.
 */
async function consumirTransito(envio, items, t) {
  if (!envio.stock_despachado) return;

  const componentes = await obtenerComponentesDeItems(items, t);
  const totalPorProducto = new Map();
  for (const c of componentes) {
    totalPorProducto.set(c.producto_id, (totalPorProducto.get(c.producto_id) || 0) + c.cantidad);
  }
  for (const [producto_id, cantidad] of totalPorProducto) {
    const prod = await Producto.findByPk(producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (!prod) continue;
    const transito = Math.max(0, (parseInt(prod.cantidad_transito) || 0) - cantidad);
    await prod.update({ cantidad_transito: transito }, { transaction: t });
  }
}

/**
 * Cancelado: libera el stock comprometido por el pedido, sin importar en
 * qué bucket esté (reservado si nunca se despachó, tránsito si sí) — vuelve
 * a cantidad_disponible. Idempotente vía envio.stock_liberado (chequeado
 * por el caller: solo debe invocarse si stock_descontado && !stock_liberado).
 */
async function liberarStock(envio, items, t) {
  const componentes = await obtenerComponentesDeItems(items, t);
  const totalPorProducto = new Map();
  for (const c of componentes) {
    totalPorProducto.set(c.producto_id, (totalPorProducto.get(c.producto_id) || 0) + c.cantidad);
  }
  const campoOrigen = envio.stock_despachado ? 'cantidad_transito' : 'cantidad_reservada';
  for (const [producto_id, cantidad] of totalPorProducto) {
    const prod = await Producto.findByPk(producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (!prod) continue;
    const origenActual = Math.max(0, (parseInt(prod[campoOrigen]) || 0) - cantidad);
    const disponible = (parseInt(prod.cantidad_disponible) || 0) + cantidad;
    // Vuelve al SALÓN: la mercadería que se recupera de un pedido cancelado
    // regresa al mostrador, no al depósito. Es también lo prudente para el
    // aviso de reposición — deja el salón surtido en vez de pedir reponer
    // algo que ya está a mano.
    const actualizacion = {
      cantidad_disponible: disponible,
      [campoOrigen]: origenActual,
      stock_salon: (parseInt(prod.stock_salon) || 0) + cantidad,
    };
    if (disponible > 0 && prod.estado_venta === 'fuera_de_stock') {
      actualizacion.estado_venta = 'en_venta';
    }
    await prod.update(actualizacion, { transaction: t });
  }
}

/**
 * Devolución por producto/cantidad (Devuelto). `itemsPayload`:
 * [{ envio_item_componente_id, cantidad, condicion: 'vendible'|'dañado' }]
 * Vendible: sale de tránsito y vuelve a disponible. Dañado: sale de
 * tránsito y no regresa al inventario vendible. Nunca confía en el total
 * enviado por frontend — recalcula el remanente disponible para devolver
 * por componente (cantidad − ya gestionado) en cada llamada, así que dos
 * llamadas con la misma cantidad total nunca superan `cantidad`.
 */
async function registrarDevolucionComponentes(envio, itemsPayload, t) {
  for (const { envio_item_componente_id, cantidad, condicion } of itemsPayload) {
    const cant = parseInt(cantidad) || 0;
    if (cant <= 0) throw new Error('La cantidad a devolver debe ser mayor a 0');
    if (!['vendible', 'dañado'].includes(condicion)) {
      throw new Error('Condición inválida: debe ser "vendible" o "dañado"');
    }

    const componente = await EnvioItemComponente.findByPk(envio_item_componente_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (!componente) throw new Error(`Componente ${envio_item_componente_id} no encontrado`);

    const item = await EnvioItem.findOne({ where: { id: componente.envio_item_id, envio_id: envio.id }, transaction: t });
    if (!item) throw new Error(`El componente ${envio_item_componente_id} no pertenece a este pedido`);

    const yaGestionado = componente.cantidad_devuelta_vendible + componente.cantidad_devuelta_danada + componente.cantidad_perdida;
    const disponibleParaDevolver = componente.cantidad - yaGestionado;
    if (cant > disponibleParaDevolver) {
      throw new Error(`Cantidad a devolver (${cant}) supera la cantidad disponible (${disponibleParaDevolver}) del componente ${envio_item_componente_id}`);
    }

    const prod = await Producto.findByPk(componente.producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (prod) {
      const transito = Math.max(0, (parseInt(prod.cantidad_transito) || 0) - cant);
      const actualizacion = { cantidad_transito: transito };
      if (condicion === 'vendible') {
        const disponible = (parseInt(prod.cantidad_disponible) || 0) + cant;
        actualizacion.cantidad_disponible = disponible;
        // Una devolución en buen estado vuelve al mostrador (mismo criterio
        // que liberarStock). La dañada no suma a ningún lado: no es vendible.
        actualizacion.stock_salon = (parseInt(prod.stock_salon) || 0) + cant;
        if (disponible > 0 && prod.estado_venta === 'fuera_de_stock') actualizacion.estado_venta = 'en_venta';
      }
      await prod.update(actualizacion, { transaction: t });
    }

    if (condicion === 'vendible') {
      await componente.update({ cantidad_devuelta_vendible: componente.cantidad_devuelta_vendible + cant }, { transaction: t });
    } else {
      await componente.update({ cantidad_devuelta_danada: componente.cantidad_devuelta_danada + cant }, { transaction: t });
    }
  }
}

/**
 * Pérdida por producto/cantidad (Perdido). `itemsPayload`:
 * [{ envio_item_componente_id, cantidad }]
 * Sale de tránsito permanentemente (no vuelve a disponible). Recalcula el
 * cargo total del pedido desde cero sobre TODOS sus componentes (no solo
 * los de esta llamada) para nunca restar costo_envio más de una vez, y lo
 * guarda como snapshot en Envio.cargo_perdida_courier — el backend nunca
 * confía en un importe calculado por el frontend.
 */
async function registrarPerdidaComponentes(envio, itemsPayload, t) {
  for (const { envio_item_componente_id, cantidad } of itemsPayload) {
    const cant = parseInt(cantidad) || 0;
    if (cant <= 0) throw new Error('La cantidad perdida debe ser mayor a 0');

    const componente = await EnvioItemComponente.findByPk(envio_item_componente_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (!componente) throw new Error(`Componente ${envio_item_componente_id} no encontrado`);

    const item = await EnvioItem.findOne({ where: { id: componente.envio_item_id, envio_id: envio.id }, transaction: t });
    if (!item) throw new Error(`El componente ${envio_item_componente_id} no pertenece a este pedido`);

    const yaGestionado = componente.cantidad_devuelta_vendible + componente.cantidad_devuelta_danada + componente.cantidad_perdida;
    const disponibleParaPerder = componente.cantidad - yaGestionado;
    if (cant > disponibleParaPerder) {
      throw new Error(`Cantidad perdida (${cant}) supera la cantidad disponible (${disponibleParaPerder}) del componente ${envio_item_componente_id}`);
    }

    const prod = await Producto.findByPk(componente.producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
    if (prod) {
      const transito = Math.max(0, (parseInt(prod.cantidad_transito) || 0) - cant);
      await prod.update({ cantidad_transito: transito }, { transaction: t });
    }

    await componente.update({ cantidad_perdida: componente.cantidad_perdida + cant }, { transaction: t });
  }

  const items = await EnvioItem.findAll({ where: { envio_id: envio.id }, transaction: t });
  const itemIds = items.map(i => i.id);
  const todosLosComponentes = itemIds.length
    ? await EnvioItemComponente.findAll({ where: { envio_item_id: { [Op.in]: itemIds } }, transaction: t })
    : [];

  let valorTotalPerdido = 0;
  for (const item of items) {
    const componentesDelItem = todosLosComponentes.filter(c => c.envio_item_id === item.id);
    const cantidadFisicaTotal = componentesDelItem.reduce((acc, c) => acc + c.cantidad, 0);
    if (cantidadFisicaTotal === 0) continue;
    const precioUnitarioVenta = (parseFloat(item.subtotal) || 0) / cantidadFisicaTotal;
    const cantidadPerdidaDelItem = componentesDelItem.reduce((acc, c) => acc + c.cantidad_perdida, 0);
    valorTotalPerdido += precioUnitarioVenta * cantidadPerdidaDelItem;
  }

  const cargo = Math.round(valorTotalPerdido - (parseInt(envio.costo_envio) || 0));
  await envio.update({ cargo_perdida_courier: cargo }, { transaction: t });
  return cargo;
}


/** Día de hoy en zona horaria de Paraguay (YYYY-MM-DD). */
function hoyPy() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
}

/**
 * Registra UN viaje del courier y devuelve cuánto se había gastado en viajes
 * anteriores de ese pedido.
 *
 * `Envio.costo_envio` guarda el TOTAL (es lo que leen el dashboard y la
 * rendición, y por eso no hubo que tocar ninguno de los dos); esta tabla
 * guarda el desglose. Ver src/models/EnvioIntentoEntrega.js.
 */
async function viajesPrevios(envio_id, t) {
  const previos = await EnvioIntentoEntrega.findAll({
    where: { envio_id },
    attributes: ['costo'],
    transaction: t,
  });
  return {
    cantidad: previos.length,
    acumulado: previos.reduce((acc, i) => acc + (Number(i.costo) || 0), 0),
  };
}

/**
 * Deja registrado UN viaje. El costo se calcula ANTES de llamar acá y se pasa
 * ya resuelto, para que la fila guarde exactamente el mismo importe que se
 * suma a `Envio.costo_envio`: si las dos cuentas se hicieran por separado, el
 * desglose podría no dar el total y no habría forma de saber cuál miente.
 */
async function registrarViaje(envio, { numero, resultado, costo, motivo = null, fecha_reprogramada = null }, t) {
  await EnvioIntentoEntrega.create({
    envio_id: envio.id,
    courier_id: envio.courier_id || null,
    numero,
    resultado,
    // Cero es válido y significativo: hay viajes que el courier no cobra.
    costo: Math.max(0, Number(costo) || 0),
    motivo,
    fecha_reprogramada,
    fecha: hoyPy(),
  }, { transaction: t });
}

exports.listEnvios = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    // La regla del proyecto: endpoints con filtros dinámicos son POST y leen de req.body
    const { fecha_desde, fecha_hasta, estado, confirmador, courier_id, origen } = req.body;

    const where = { usuario_id };
    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
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
      canal_venta_id,
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

    // Búsqueda flexible e insensible a mayúsculas/minúsculas de cliente (nombre, teléfono, ruc, dirección o ID)
    if (cliente && cliente.trim()) {
      const term = `%${cliente.trim()}%`;
      const cleanNum = cliente.replace(/#/g, '').trim();
      const numericId = parseInt(cleanNum, 10);

      const orList = [
        { nombre_cliente: { [Op.iLike]: term } },
        { apellido_cliente: { [Op.iLike]: term } },
        { cliente: { [Op.iLike]: term } },
        { telefono: { [Op.iLike]: term } },
        { ruc: { [Op.iLike]: term } },
        { direccion: { [Op.iLike]: term } },
        Sequelize.where(
          Sequelize.fn('concat', Sequelize.fn('COALESCE', Sequelize.col('nombre_cliente'), ''), ' ', Sequelize.fn('COALESCE', Sequelize.col('apellido_cliente'), '')),
          { [Op.iLike]: term }
        ),
      ];

      if (!isNaN(numericId) && numericId > 0 && String(numericId) === cleanNum) {
        orList.push({ id: numericId });
      }

      where[Op.or] = orList;
    }

    if (ciudad && ciudad.trim()) {
      where.ciudad = { [Op.iLike]: `%${ciudad.trim()}%` };
    }

    if (courier_id && courier_id !== 'TODOS') {
      where.courier_id = courier_id === 'null' ? null : Number(courier_id);
    }

    if (confirmador && confirmador !== 'TODOS' && confirmador.trim()) {
      where.confirmador = { [Op.iLike]: `%${confirmador.trim()}%` };
    }

    if (origen && origen !== 'TODOS') {
      where.origen = origen;
    }
    if (canal_venta_id && canal_venta_id !== 'TODOS') {
      where.canal_venta_id = canal_venta_id;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    const { count, rows } = await Envio.findAndCountAll({
      where,
      include: [
        { model: Courier, attributes: ['id', 'nombre'] },
        {
          model: EnvioItem, as: 'items', attributes: ['id', 'producto_id', 'nombre_producto', 'cantidad', 'precio_unitario', 'subtotal', 'oferta_nombre'],
          include: [{
            model: EnvioItemComponente, as: 'componentes_vendidos',
            attributes: ['id', 'producto_id', 'cantidad', 'cantidad_devuelta_vendible', 'cantidad_devuelta_danada', 'cantidad_perdida'],
          }],
        },
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
      canal_venta_id,
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

    // Ítems vendidos con una oferta (pack/combo/order bump/upsell) guardan un
    // snapshot de código/nombre de la oferta en el propio ítem — la receta de
    // stock recién se resuelve y snapshotea en EnvioItemComponente al
    // confirmar (ver descontarStockYSnapshot). Oferta se aísla por
    // inquilino_id (tenantId), no por usuario_id — son conceptos de tenant
    // distintos en este proyecto (ver Producto/Oferta vs Envio/Courier).
    const ofertaIds = [...new Set((items || []).map(it => it.oferta_id).filter(Boolean))];
    const ofertasPorId = ofertaIds.length > 0
      ? new Map((await Oferta.findAll({ where: { id: ofertaIds, inquilino_id: req.usuario.tenantId }, transaction: t })).map(o => [o.id, o]))
      : new Map();

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
        // Pedido manual (esta pantalla la usa el staff autenticado, nunca
        // el checkout público — ver landing.service.js/crearCheckout para
        // ese flujo aparte): ya fue confirmado por definición, no pasa por
        // "Pendiente" (ver plan Gestión de Pedidos, sección 5).
        estado: 'Confirmado',
        dispatchedAt: hoy,
        origen: origen || 'WEB',
        canal_venta_id: canal_venta_id || null,
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
        items: items && items.length > 0 ? items.map(item => {
          const oferta = item.oferta_id ? ofertasPorId.get(Number(item.oferta_id)) : null;
          return {
            producto_id: item.producto_id || null,
            oferta_id: oferta ? oferta.id : null,
            oferta_codigo: oferta ? oferta.codigo : null,
            oferta_nombre: oferta ? oferta.nombre : null,
            nombre_producto: item.nombre_producto || 'Producto sin nombre',
            cantidad: item.cantidad || 1,
            precio_unitario: item.precio_unitario || 0,
            subtotal: (item.cantidad || 1) * (item.precio_unitario || 0)
          };
        }) : []
      },
      {
        include: [{ model: EnvioItem, as: 'items' }],
        transaction: t
      }
    );

    // El pedido manual nace en "Confirmado" (ver arriba), así que reserva
    // stock real desde la creación — mismo mecanismo que usa updateEstado
    // al confirmar un pedido que sí pasó por "Pendiente" (checkout público,
    // ver landing.service.js/crearCheckout).
    await descontarStockYSnapshot(nuevoEnvio.items || [], t, usuario_id);
    await nuevoEnvio.update({ stock_descontado: true }, { transaction: t });
    await registrarHistorial(nuevoEnvio.id, usuario_id, 'Pedido creado manualmente (Confirmado)', t);

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

// Catálogo autoritativo de estado operativo — ver plan Gestión de Pedidos
// sección 3. "Rendido"/"En camino"/"En Tránsito"/"Reagendado" ya no son
// valores válidos (ver migrar-gestion-pedidos.js para la conversión de
// filas legacy). El estado financiero (pendiente_liquidacion/liquidado)
// vive aparte, en Envio.estado_financiero, y nunca lo toca esta función.
const ESTADOS_OPERATIVOS = ['Pendiente', 'Confirmado', 'Preparado', 'Despachado', 'Reprogramado', 'Entregado', 'Cancelado', 'Devuelto', 'Perdido'];

// Transiciones permitidas desde cada estado actual. "Devuelto" y "Perdido"
// deliberadamente NO aparecen como destino acá: se gestionan por
// producto/cantidad vía POST /:id/devolucion y POST /:id/perdida (abajo),
// que validan su propia transición y aplican su propio movimiento de stock.
const TRANSICIONES_VALIDAS = {
  Pendiente: ['Confirmado', 'Cancelado'],
  Confirmado: ['Preparado', 'Cancelado'],
  Preparado: ['Despachado', 'Cancelado'],
  Despachado: ['Entregado', 'Reprogramado'],
  Reprogramado: ['Despachado', 'Entregado', 'Cancelado', 'Reprogramado'],
  Entregado: [],
  Cancelado: [],
  Devuelto: [],
  Perdido: [],
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
      confirmador, origen, canal_venta_id, campaign_name, observaciones, monto,
      // Obligatorio para pasar a Reprogramado — ver TRANSICIONES_VALIDAS.
      fecha_reprogramada, motivo_reprogramacion,
      // Lo que cuesta el viaje en falso que se acaba de hacer. Se acumula en
      // costo_envio. Puede ser 0 (el courier no lo cobra) — por eso se
      // compara contra undefined y no por falsy.
      costo_intento,
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

    if (estado !== undefined && estado !== envio.estado) {
      if (estado === 'Devuelto' || estado === 'Perdido') {
        await t.rollback();
        return res.status(400).json({
          error: `Para pasar a "${estado}" hay que usar POST /api/envios/${envio.id}/${estado === 'Devuelto' ? 'devolucion' : 'perdida'}, indicando el detalle por producto.`,
        });
      }
      if (!ESTADOS_OPERATIVOS.includes(estado)) {
        await t.rollback();
        return res.status(400).json({ error: `Estado inválido: "${estado}".` });
      }
      const destinosValidos = TRANSICIONES_VALIDAS[envio.estado] || [];
      if (!destinosValidos.includes(estado)) {
        await t.rollback();
        return res.status(400).json({ error: `No se puede pasar de "${envio.estado}" a "${estado}".` });
      }

      if (estado === 'Reprogramado') {
        if (!fecha_reprogramada) {
          await t.rollback();
          return res.status(400).json({ error: 'fecha_reprogramada es obligatoria para reprogramar el pedido' });
        }
        updateData.fecha_reprogramada = fecha_reprogramada;
        updateData.motivo_reprogramacion = motivo_reprogramacion || null;

        // El viaje en falso ya se hizo y ya se paga: se suma al costo del
        // pedido en vez de perderse. Antes de esto el courier podía ir tres
        // veces y el sistema registraba un solo envío, dejando el costo real
        // fuera del margen y fuera de la rendición.
        const costoViaje = costo_intento !== undefined ? Math.max(0, Number(costo_intento) || 0) : 0;
        const { cantidad, acumulado } = await viajesPrevios(envio.id, t);
        await registrarViaje(envio, {
          numero: cantidad + 1,
          resultado: 'reprogramado',
          costo: costoViaje,
          motivo: motivo_reprogramacion || null,
          fecha_reprogramada,
        }, t);
        updateData.costo_envio = acumulado + costoViaje;
        if (costoViaje > 0) {
          await registrarHistorial(envio.id, usuario_id, `Viaje en falso: Gs ${costoViaje.toLocaleString('es-PY')}`, t);
        }
      }

      if (estado === 'Entregado') {
        const metodoFinal = metodo_pago_id !== undefined ? metodo_pago_id : envio.metodo_pago_id;
        const montoFinal = monto !== undefined ? monto : envio.monto;
        const costoFinal = costo_envio !== undefined ? costo_envio : envio.costo_envio;
        if (!metodoFinal || montoFinal === undefined || montoFinal === null || costoFinal === undefined || costoFinal === null) {
          await t.rollback();
          return res.status(400).json({ error: 'metodo_pago_id, monto y costo_envio son obligatorios para marcar el pedido como Entregado' });
        }
        updateData.metodo_pago_id = metodoFinal;
        updateData.monto = montoFinal;

        // `costo_envio` que llega es el costo de ESTE viaje, el que entregó.
        // Se le suma lo que ya costaron los viajes en falso anteriores, que
        // vive en la tabla de intentos. Sin pedidos reprogramados el
        // acumulado es 0 y el total queda igual que siempre.
        //
        // Ojo con el fallback: si no viene costo_envio y YA hubo intentos,
        // `envio.costo_envio` es el acumulado — volver a sumarlo lo
        // duplicaría, así que en ese caso el viaje final cuenta como 0.
        const { cantidad, acumulado } = await viajesPrevios(envio.id, t);
        const costoViajeFinal = costo_envio !== undefined
          ? Math.max(0, Number(costoFinal) || 0)
          : (acumulado > 0 ? 0 : Math.max(0, Number(costoFinal) || 0));
        await registrarViaje(envio, {
          numero: cantidad + 1,
          resultado: 'entregado',
          costo: costoViajeFinal,
        }, t);
        updateData.costo_envio = acumulado + costoViajeFinal;
      }

      // Movimientos de stock por transición — cada uno protegido por su
      // propio flag de idempotencia (ver Producto/Envio) y bloqueo de fila
      // dentro de la transacción (Transaction.LOCK.UPDATE, en los helpers).
      if (estado === 'Confirmado' && !envio.stock_descontado) {
        await descontarStockYSnapshot(envio.items || [], t, envio.usuario_id);
        updateData.stock_descontado = true;
      }
      if (estado === 'Despachado' && !envio.stock_despachado) {
        await moverAReservadoATransito(envio.items || [], t);
        updateData.stock_despachado = true;
      }
      if (estado === 'Entregado') {
        await consumirTransito(envio, envio.items || [], t);
      }
      if (estado === 'Cancelado' && envio.stock_descontado && !envio.stock_liberado) {
        await liberarStock(envio, envio.items || [], t);
        updateData.stock_liberado = true;
      }

      updateData.estado = estado;
      // Sync legacy para pantallas que todavía puedan leer estado_logistico
      // directamente — el catálogo autoritativo es Envio.estado (ver arriba).
      updateData.estado_logistico = estado;

      await registrarHistorial(envio.id, usuario_id, `${envio.estado} → ${estado}`, t);
      if (estado === 'Reprogramado') {
        await registrarHistorial(envio.id, usuario_id, `Reprogramado para ${fecha_reprogramada}${motivo_reprogramacion ? ' — ' + motivo_reprogramacion : ''}`, t);
      }
      if (estado === 'Entregado' && updateData.metodo_pago_id) {
        const metodoUsado = await MetodoPago.findByPk(updateData.metodo_pago_id, { transaction: t });
        if (metodoUsado) await registrarHistorial(envio.id, usuario_id, `Método de pago: ${metodoUsado.nombre}`, t);
      }
    }

    if (estado_comercial !== undefined) updateData.estado_comercial = estado_comercial;
    if (estado_logistico !== undefined && updateData.estado_logistico === undefined) updateData.estado_logistico = estado_logistico;
    if (courier_id !== undefined) updateData.courier_id = courier_id;
    if (ruc !== undefined) updateData.ruc = ruc;
    if (direccion !== undefined) updateData.direccion = direccion;
    if (referencia !== undefined) updateData.referencia = referencia;
    if (link_maps !== undefined) updateData.link_maps = link_maps;
    // OJO: este pase genérico NO puede pisar lo que ya calculó el bloque de
    // transición. Al entregar, ese bloque suma los viajes en falso previos al
    // costo del viaje final; si acá se volviera a asignar el valor crudo del
    // request, esos viajes desaparecerían del pedido (bug real: un pedido con
    // dos viajes de 25.000 quedaba con costo_envio 25.000).
    if (costo_envio !== undefined && updateData.costo_envio === undefined) updateData.costo_envio = costo_envio;
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
    if (canal_venta_id !== undefined) updateData.canal_venta_id = canal_venta_id || null;
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
 * POST /api/envios/:id/devolucion — Devuelto, gestionado por producto y
 * cantidad. Body: { items: [{ envio_item_componente_id, cantidad, condicion }] }
 * Solo válido desde Despachado o Reprogramado (el producto tiene que estar
 * en tránsito para poder devolverse). Una devolución parcial NO obliga a
 * que el pedido completo pase a "Devuelto" — eso lo decide el caller
 * (frontend) pasando o no `marcar_estado: true`; si se pasa, acá se valida
 * y aplica esa transición dentro de la misma operación atómica.
 */
exports.registrarDevolucion = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { items, marcar_estado } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Se requiere al menos un ítem a devolver' });
    }

    const envio = await Envio.findOne({ where: { id, usuario_id }, transaction: t });
    if (!envio) {
      await t.rollback();
      return res.status(404).json({ error: 'Envío no encontrado' });
    }
    if (!['Despachado', 'Reprogramado'].includes(envio.estado)) {
      await t.rollback();
      return res.status(400).json({ error: `No se puede registrar una devolución desde el estado "${envio.estado}".` });
    }

    await registrarDevolucionComponentes(envio, items, t);
    await registrarHistorial(envio.id, usuario_id, `Devolución registrada: ${items.length} producto(s)`, t);

    const updateData = {};
    if (marcar_estado) {
      updateData.estado = 'Devuelto';
      updateData.estado_logistico = 'Devuelto';
      await registrarHistorial(envio.id, usuario_id, `${envio.estado} → Devuelto`, t);
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
    console.error('Error registrando devolución:', error);
    res.status(400).json({ error: error.message || 'Error al registrar la devolución' });
  }
};

/**
 * POST /api/envios/:id/perdida — Perdido, gestionado por producto y
 * cantidad. Body: { items: [{ envio_item_componente_id, cantidad }] }
 * Solo válido desde Despachado o Reprogramado. Recalcula y persiste el
 * cargo al courier (registrarPerdidaComponentes) — nunca confía en un
 * importe enviado por el frontend. Igual que en devolución, `marcar_estado`
 * decide si esta pérdida además cierra el pedido completo como "Perdido".
 */
exports.registrarPerdida = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { items, marcar_estado } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Se requiere al menos un ítem perdido' });
    }

    const envio = await Envio.findOne({ where: { id, usuario_id }, transaction: t });
    if (!envio) {
      await t.rollback();
      return res.status(404).json({ error: 'Envío no encontrado' });
    }
    if (!['Despachado', 'Reprogramado'].includes(envio.estado)) {
      await t.rollback();
      return res.status(400).json({ error: `No se puede registrar una pérdida desde el estado "${envio.estado}".` });
    }

    const cargo = await registrarPerdidaComponentes(envio, items, t);
    await registrarHistorial(envio.id, usuario_id, `Pérdida registrada: ${items.length} producto(s), cargo Gs. ${cargo.toLocaleString('es-PY')}`, t);

    const updateData = {};
    if (marcar_estado) {
      updateData.estado = 'Perdido';
      updateData.estado_logistico = 'Perdido';
      await registrarHistorial(envio.id, usuario_id, `${envio.estado} → Perdido`, t);
    }
    await envio.update(updateData, { transaction: t });
    await t.commit();

    const result = await Envio.findByPk(envio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' }
      ]
    });
    res.json({ ...result.toJSON(), cargo_perdida_courier: cargo });
  } catch (error) {
    if (!t.finished) await t.rollback();
    console.error('Error registrando pérdida:', error);
    res.status(400).json({ error: error.message || 'Error al registrar la pérdida' });
  }
};

/**
 * POST /api/envios/conteo-por-estado — cuenta pedidos agrupados por
 * `estado`, respetando los mismos filtros que listEnviosPaginados (para que
 * los contadores de las pestañas de la bandeja reflejen los filtros
 * activos). Una sola consulta GROUP BY en vez de una por pestaña.
 */
exports.conteoPorEstado = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { fecha_desde, fecha_hasta, cliente, ciudad, courier_id, confirmador, origen, producto, metodo_pago_id } = req.body;

    const where = { usuario_id };
    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
    }
    if (cliente && cliente.trim()) {
      const term = `%${cliente.trim()}%`;
      where[Op.or] = [
        { nombre_cliente: { [Op.iLike]: term } },
        { apellido_cliente: { [Op.iLike]: term } },
        { cliente: { [Op.iLike]: term } },
        { telefono: { [Op.iLike]: term } },
      ];
    }
    if (ciudad && ciudad.trim()) where.ciudad = { [Op.iLike]: `%${ciudad.trim()}%` };
    if (courier_id && courier_id !== 'TODOS') where.courier_id = courier_id === 'null' ? null : Number(courier_id);
    if (confirmador && confirmador !== 'TODOS' && confirmador.trim()) where.confirmador = { [Op.iLike]: `%${confirmador.trim()}%` };
    if (origen && origen !== 'TODOS') where.origen = origen;
    if (metodo_pago_id && metodo_pago_id !== 'TODOS') where.metodo_pago_id = Number(metodo_pago_id);

    const include = [];
    if (producto && producto !== 'TODOS') {
      include.push({
        model: EnvioItem,
        as: 'items',
        attributes: [],
        where: { producto_id: Number(producto) },
        required: true,
      });
    }

    const filas = await Envio.findAll({
      where,
      include,
      attributes: ['estado', [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('Envio.id'))), 'cantidad']],
      group: ['estado'],
      raw: true,
    });

    const conteos = {};
    for (const e of ESTADOS_OPERATIVOS) conteos[e] = 0;
    for (const fila of filas) {
      conteos[fila.estado] = parseInt(fila.cantidad, 10) || 0;
    }

    res.json(conteos);
  } catch (error) {
    console.error('Error obteniendo conteo por estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * POST /api/envios/resumen-entregados — resumen financiero minimalista de
 * la pestaña "Entregados" (ver plan sección 22). Respeta los mismos
 * filtros que listEnviosPaginados/conteoPorEstado. "Dinero en poder del
 * courier" vs. "Cobrado directamente por la tienda" se decide por
 * MetodoPago.custodia_cobro, igual que en el motor de rendición — nunca por
 * comparación de texto contra el nombre del método.
 */
exports.resumenEntregados = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { fecha_desde, fecha_hasta, cliente, ciudad, courier_id, confirmador, origen, producto, metodo_pago_id } = req.body;

    const where = { usuario_id, estado: 'Entregado' };
    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
    }
    if (cliente && cliente.trim()) {
      const term = `%${cliente.trim()}%`;
      where[Op.or] = [
        { nombre_cliente: { [Op.iLike]: term } },
        { apellido_cliente: { [Op.iLike]: term } },
        { cliente: { [Op.iLike]: term } },
        { telefono: { [Op.iLike]: term } },
      ];
    }
    if (ciudad && ciudad.trim()) where.ciudad = { [Op.iLike]: `%${ciudad.trim()}%` };
    if (courier_id && courier_id !== 'TODOS') where.courier_id = courier_id === 'null' ? null : Number(courier_id);
    if (confirmador && confirmador !== 'TODOS' && confirmador.trim()) where.confirmador = { [Op.iLike]: `%${confirmador.trim()}%` };
    if (origen && origen !== 'TODOS') where.origen = origen;
    if (metodo_pago_id && metodo_pago_id !== 'TODOS') where.metodo_pago_id = Number(metodo_pago_id);

    const include = [{ model: MetodoPago, attributes: ['id', 'nombre', 'custodia_cobro'] }];
    if (producto && producto !== 'TODOS') {
      include.push({
        model: EnvioItem, as: 'items', attributes: [],
        where: { producto_id: Number(producto) }, required: true,
      });
    }

    const envios = await Envio.findAll({
      where, include,
      attributes: ['id', 'monto', 'costo_envio', 'estado_financiero'],
    });

    let cantidad = 0, montoTotal = 0, dineroCourier = 0, cobradoDirecto = 0, costoTotalCourier = 0, pendientesRendicion = 0;
    const desglosePorMetodo = new Map();

    for (const e of envios) {
      cantidad += 1;
      const monto = Number(e.monto) || 0;
      const costoEnvio = Number(e.costo_envio) || 0;
      montoTotal += monto;
      costoTotalCourier += costoEnvio;

      const custodia = e.MetodoPago ? e.MetodoPago.custodia_cobro : 'negocio';
      if (custodia === 'courier') dineroCourier += monto; else cobradoDirecto += monto;
      if (e.estado_financiero === 'pendiente_liquidacion') pendientesRendicion += 1;

      const nombreMetodo = e.MetodoPago ? e.MetodoPago.nombre : 'Sin método';
      desglosePorMetodo.set(nombreMetodo, (desglosePorMetodo.get(nombreMetodo) || 0) + monto);
    }

    res.json({
      entregado: { cantidad, monto_total: montoTotal },
      dinero_courier: dineroCourier,
      cobrado_directo: cobradoDirecto,
      costo_total_courier: costoTotalCourier,
      saldo_liquidacion: dineroCourier - costoTotalCourier,
      pendientes_rendicion: pendientesRendicion,
      desglose_metodo_pago: Array.from(desglosePorMetodo.entries()).map(([metodo_pago, monto]) => ({ metodo_pago, monto })),
    });
  } catch (error) {
    console.error('Error obteniendo resumen de entregados:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * POST /api/envios/dashboard-general — pestaña "Dashboard" del módulo
 * Gestión de Pedidos (ver plan sección 23). Tres bloques compactos, no es
 * un dashboard general de la empresa: trabajo pendiente, resultado
 * operativo, desempeño de courier. Filtra por courier/fecha/producto.
 */
exports.dashboardGeneralPedidos = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { fecha_desde, fecha_hasta, courier_id, producto } = req.body;

    const where = { usuario_id };
    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
    }
    if (courier_id && courier_id !== 'TODOS') where.courier_id = courier_id === 'null' ? null : Number(courier_id);

    const include = [{ model: Courier, attributes: ['id', 'nombre'] }];
    if (producto && producto !== 'TODOS') {
      include.push({
        model: EnvioItem, as: 'items', attributes: [],
        where: { producto_id: Number(producto) }, required: true,
      });
    }

    const envios = await Envio.findAll({
      where, include,
      attributes: ['id', 'estado', 'estado_financiero', 'fecha_reprogramada', 'courier_id'],
    });

    const hoy = new Date().toISOString().slice(0, 10);

    // ── Bloque 1 — Trabajo pendiente ──
    const trabajoPendiente = {
      pendientes_confirmar: 0,
      confirmados_preparar: 0,
      preparados_despachar: 0,
      despachados_sin_resultado: 0,
      reprogramados_hoy: 0,
      reprogramados_vencidos: 0,
      entregados_pendientes_rendicion: 0,
    };

    // ── Bloque 2 — Resultado operativo ──
    const resultadoOperativo = { ingresados: 0, confirmados: 0, entregados: 0, cancelados: 0, devueltos: 0, perdidos: 0 };

    // ── Bloque 3 — Desempeño de courier ──
    const CONFIRMADO_EN_ADELANTE = ['Confirmado', 'Preparado', 'Despachado', 'Reprogramado', 'Entregado', 'Devuelto', 'Perdido'];
    const courierMap = new Map(); // courier_id -> { nombre, despachados, entregados, devueltos, perdidos }

    for (const e of envios) {
      resultadoOperativo.ingresados += 1;
      if (CONFIRMADO_EN_ADELANTE.includes(e.estado)) resultadoOperativo.confirmados += 1;
      if (e.estado === 'Entregado') resultadoOperativo.entregados += 1;
      if (e.estado === 'Cancelado') resultadoOperativo.cancelados += 1;
      if (e.estado === 'Devuelto') resultadoOperativo.devueltos += 1;
      if (e.estado === 'Perdido') resultadoOperativo.perdidos += 1;

      if (e.estado === 'Pendiente') trabajoPendiente.pendientes_confirmar += 1;
      if (e.estado === 'Confirmado') trabajoPendiente.confirmados_preparar += 1;
      if (e.estado === 'Preparado') trabajoPendiente.preparados_despachar += 1;
      if (e.estado === 'Despachado') trabajoPendiente.despachados_sin_resultado += 1;
      if (e.estado === 'Reprogramado') {
        if (e.fecha_reprogramada === hoy) trabajoPendiente.reprogramados_hoy += 1;
        else if (e.fecha_reprogramada && e.fecha_reprogramada < hoy) trabajoPendiente.reprogramados_vencidos += 1;
      }
      if (e.estado === 'Entregado' && e.estado_financiero === 'pendiente_liquidacion') {
        trabajoPendiente.entregados_pendientes_rendicion += 1;
      }

      // Desempeño de courier: solo pedidos que efectivamente salieron a
      // reparto (Despachado y en adelante) — un pedido Cancelado antes del
      // despacho nunca aparece acá, no hace falta filtrarlo aparte.
      if (['Despachado', 'Reprogramado', 'Entregado', 'Devuelto', 'Perdido'].includes(e.estado)) {
        const key = e.courier_id || 'sin_courier';
        if (!courierMap.has(key)) {
          courierMap.set(key, {
            courier_id: e.courier_id || null,
            courier_nombre: e.Courier ? e.Courier.nombre : 'Sin courier / propio',
            despachados: 0, entregados: 0, devueltos: 0, perdidos: 0,
          });
        }
        const c = courierMap.get(key);
        c.despachados += 1;
        if (e.estado === 'Entregado') c.entregados += 1;
        if (e.estado === 'Devuelto') c.devueltos += 1;
        if (e.estado === 'Perdido') c.perdidos += 1;
      }
    }

    const desempenoCourier = Array.from(courierMap.values()).map(c => {
      const conResultado = c.entregados + c.devueltos + c.perdidos;
      return { ...c, pct_entrega: conResultado > 0 ? Number(((c.entregados / conResultado) * 100).toFixed(1)) : 0 };
    }).sort((a, b) => b.despachados - a.despachados);

    res.json({ trabajo_pendiente: trabajoPendiente, resultado_operativo: resultadoOperativo, desempeno_courier: desempenoCourier });
  } catch (error) {
    console.error('Error obteniendo dashboard general de pedidos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * GET /api/envios/:id/historial — historial simple de movimientos de un
 * pedido (ver plan sección 24). Se consulta desde el detalle del pedido,
 * nunca ocupa espacio permanente en la bandeja.
 */
exports.obtenerHistorial = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;

    const envio = await Envio.findOne({ where: { id, usuario_id } });
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    const historial = await EnvioHistorial.findAll({
      where: { envio_id: id },
      include: [{ model: Usuario, attributes: ['id', 'nombre'] }],
      order: [['created_at', 'ASC']],
    });

    res.json(historial.map(h => ({
      id: h.id,
      detalle: h.detalle,
      usuario: h.Usuario ? h.Usuario.nombre : null,
      fecha: h.created_at,
    })));
  } catch (error) {
    console.error('Error obteniendo historial del pedido:', error);
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

    const data = await getAnalyticsCompleto(filtros, usuario_id, req.usuario.tenantId);
    res.json(data);
  } catch (error) {
    console.error('Error in getDashboardMetricas:', error);
    res.status(500).json({ error: 'Error al calcular métricas analíticas' });
  }
};

exports.deleteEnvio = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;

    if (req.usuario.rol !== 'ADMIN') {
      await t.rollback();
      return res.status(403).json({ error: 'Solo los administradores pueden eliminar pedidos' });
    }

    const envio = await Envio.findOne({
      where: { id, usuario_id: req.usuario.tenantId },
      include: [{ model: EnvioItem, as: 'items' }],
      transaction: t,
    });

    if (!envio) {
      await t.rollback();
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // Liberar stock si estaba descontado y no liberado
    if (envio.stock_descontado && !envio.stock_liberado) {
      // Usamos la misma lógica que se usa al cancelar
      await liberarStock(envio, envio.items || [], t);
    }

    // Eliminar historial
    await EnvioHistorial.destroy({ where: { envio_id: id }, transaction: t });

    // Eliminar componentes de items si existen
    const itemIds = (envio.items || []).map(i => i.id);
    if (itemIds.length > 0) {
      await EnvioItemComponente.destroy({ where: { envio_item_id: { [Op.in]: itemIds } }, transaction: t });
      await EnvioItem.destroy({ where: { envio_id: id }, transaction: t });
    }

    // Finalmente eliminar el pedido
    await envio.destroy({ transaction: t });

    await registrarHistorial(id, usuario_id, 'Pedido eliminado permanentemente', t).catch(() => {});

    await t.commit();
    res.json({ message: 'Pedido eliminado correctamente' });
  } catch (error) {
    if (!t.finished) await t.rollback();
    console.error('Error al eliminar pedido:', error);
    res.status(500).json({ error: 'Error interno al eliminar el pedido' });
  }
};

