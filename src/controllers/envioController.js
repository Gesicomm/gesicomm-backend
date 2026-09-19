const { Envio, EnvioItem, EnvioItemComponente, EnvioIntentoEntrega, Courier, Producto, ProductoVariante, Oferta, OfertaComponente, MetodoPago, EnvioHistorial, Usuario, Tienda, Deposito, Rol, SeguimientoRecordatorio, sequelize } = require('../models');
const { Op, Sequelize, Transaction } = require('sequelize');

const { getAnalyticsCompleto } = require('../services/pedidosAnalyticsService');
const { registrarHistorial } = require('../utils/historial');
const { cancelarSiEstadoTerminal } = require('../services/seguimiento/seguimientoRecordatorio.service');
const { desgloseDelivery } = require('../utils/desgloseDelivery');
const PedidoNumeracion = require('../services/pedidoNumeracion.service');
const ProductoService = require('../services/producto.service');
const {
  iniciarCheckoutAbastecimiento,
  acreditarPagoAbastecimiento,
  marcarAbastecimientoRecibido,
} = require('../services/payments/abastecimientoPago');

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
      return oferta.componentes.map(c => ({
        producto_id: c.producto_id,
        // El componente "elegible" usa la variante que el cliente eligió en
        // el checkout (persistida en EnvioItem.componente_variante_id); si
        // no eligió nada (carrito viejo, o ese componente no era elegible),
        // cae a la variante fija que haya dejado el admin al configurar la
        // oferta. Ninguno de los dos aplica → producto sin variantes, null.
        variante_id: (c.permite_elegir_variante ? item.componente_variante_id : null) || c.variante_id || null,
        cantidad: cantidadItem * c.cantidad,
      }));
    }
  }
  if (item.producto_id) {
    // Fix de fondo: antes se ignoraba item.variante_id acá y el stock
    // siempre se descontaba del Producto, nunca de la variante real que se
    // vendió — ver EnvioItem.variante_id.
    return [{ producto_id: item.producto_id, variante_id: item.variante_id || null, cantidad: cantidadItem }];
  }
  return [];
}

/**
 * Reparto salón-primero: se vende del mostrador antes que del depósito, pero
 * el total vendible siempre es la suma de ambos. Misma regla para
 * Producto.stock_salon/stock_deposito y ProductoVariante.stock_salon/
 * stock_deposito — factorizada acá para no reescribirla en las dos ramas de
 * descontarStockYSnapshot.
 */
function repartoSalonDeposito(salonActual, depositoActual, cantidadTotal) {
  const desdeSalon = Math.min(salonActual, cantidadTotal);
  const desdeDeposito = Math.min(depositoActual, cantidadTotal - desdeSalon);
  return { desdeSalon, desdeDeposito };
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
// Exportada al final del archivo: el webhook de PagoPar la necesita para
// confirmar un pedido pagado con el MISMO descuento de stock que usa el
// cambio de estado manual, en vez de duplicar la lógica.
async function descontarStockYSnapshot(items, t, usuario_id) {
  const recetaPorItem = new Map();
  // Agrupado por producto_id:variante_id — un mismo producto puede aparecer
  // dos veces en el mismo pedido con variantes distintas (ej. un bump de
  // "Rojo" y el ancla en "Azul"), y cada una descuenta su propio stock.
  const totalPorClave = new Map();

  for (const item of items) {
    const receta = await resolverReceta(item, t);
    recetaPorItem.set(item.id, receta);
    for (const { producto_id, variante_id, cantidad } of receta) {
      const clave = `${producto_id}:${variante_id || ''}`;
      const actual = totalPorClave.get(clave) || { producto_id, variante_id, cantidad: 0 };
      actual.cantidad += cantidad;
      totalPorClave.set(clave, actual);
    }
  }

  const productosPorId = new Map();
  const productosConDescuentoDeVariante = new Set();

  for (const { producto_id, variante_id, cantidad: cantidadTotal } of totalPorClave.values()) {
    if (variante_id) {
      const variante = await ProductoVariante.findByPk(variante_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (!variante) continue;

      const salonActual = parseInt(variante.stock_salon) || 0;
      const depositoActual = parseInt(variante.stock_deposito) || 0;
      const { desdeSalon, desdeDeposito } = repartoSalonDeposito(salonActual, depositoActual, cantidadTotal);
      const nuevoSalon = salonActual - desdeSalon;
      const nuevoDeposito = depositoActual - desdeDeposito;
      await variante.update({
        stock_salon: nuevoSalon,
        stock_deposito: nuevoDeposito,
        stock: nuevoSalon + nuevoDeposito,
      }, { transaction: t });

      // La reserva sigue viviendo a nivel Producto (no existe ese campo en
      // ProductoVariante) — se acumula igual que el camino sin variante.
      const prod = await Producto.findByPk(producto_id, { transaction: t, lock: Transaction.LOCK.UPDATE });
      if (prod) {
        productosPorId.set(producto_id, prod);
        await prod.update({
          cantidad_reservada: (parseInt(prod.cantidad_reservada) || 0) + cantidadTotal,
        }, { transaction: t });
      }
      productosConDescuentoDeVariante.add(producto_id);
      continue;
    }

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
    const { desdeSalon, desdeDeposito } = repartoSalonDeposito(salonActual, depositoActual, cantidadTotal);

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

  // Los productos que perdieron stock a nivel variante necesitan resincronizar
  // Producto.cantidad_disponible/stock_salon/stock_deposito como la suma de
  // sus variantes activas — se reusa recalcularStockPadre (misma función que
  // ya usa el admin al guardar variantes) en vez de reescribir esa regla acá.
  for (const producto_id of productosConDescuentoDeVariante) {
    const total = await ProductoService.recalcularStockPadre(producto_id, t);
    if (total === 0) {
      const prod = productosPorId.get(producto_id);
      if (prod && prod.estado_venta === 'en_venta') {
        await prod.update({ estado_venta: 'fuera_de_stock' }, { transaction: t });
      }
    }
  }

  for (const item of items) {
    const receta = recetaPorItem.get(item.id) || [];
    for (const { producto_id, variante_id, cantidad } of receta) {
      const prod = productosPorId.get(producto_id);
      await EnvioItemComponente.create({
        envio_item_id: item.id,
        producto_id,
        variante_id,
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

const ABASTECIMIENTO_ESTADOS = ['no_requiere', 'pendiente_pago', 'en_proceso', 'recibido'];

function esAdministrador(req) {
  return req.usuario?.rol === 'administrador';
}

function whereEnviosDeUsuario(req) {
  return esAdministrador(req) ? {} : { usuario_id: req.usuario.id };
}

function agregarBusquedaClienteONumero(where, cliente) {
  if (!cliente || !cliente.trim()) return;
  const texto = cliente.trim();
  const term = `%${texto}%`;
  const condiciones = [
    { nombre_cliente: { [Op.iLike]: term } },
    { apellido_cliente: { [Op.iLike]: term } },
    { cliente: { [Op.iLike]: term } },
    { telefono: { [Op.iLike]: term } },
  ];
  const idPedido = Number(texto.replace(/^#/, ''));
  if (Number.isInteger(idPedido) && idPedido > 0) {
    condiciones.push({ numero_pedido: idPedido });
  }
  where[Op.or] = condiciones;
}

function numeroFiltro(valor) {
  const numero = valor ? parseInt(String(valor).replace(/#/g, '').trim(), 10) : null;
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function aplicarFiltrosNumeroPedido(where, req, { pedido_id, envio_id } = {}) {
  const numeroPedido = numeroFiltro(pedido_id);
  if (numeroPedido) {
    where.numero_pedido = numeroPedido;
  }

  const envioId = numeroFiltro(envio_id);
  if (envioId && esAdministrador(req)) {
    where.id = envioId;
  }
}

function aplicarFiltroAbastecimiento(where, { solo_abastecimiento, abastecimiento_estado } = {}) {
  if (abastecimiento_estado && abastecimiento_estado !== 'TODOS') {
    if (!ABASTECIMIENTO_ESTADOS.includes(abastecimiento_estado)) {
      const err = new Error(`Estado de abastecimiento inválido: "${abastecimiento_estado}".`);
      err.status = 400;
      throw err;
    }
    where.abastecimiento_estado = abastecimiento_estado;
    return;
  }

  if (solo_abastecimiento) {
    where.abastecimiento_estado = { [Op.in]: ['pendiente_pago', 'en_proceso', 'recibido'] };
  }
}

function requiereBandejaAbastecimiento({ solo_abastecimiento, abastecimiento_estado } = {}) {
  return Boolean(solo_abastecimiento || (abastecimiento_estado && abastecimiento_estado !== 'TODOS'));
}

function asegurarAdminParaBandejaAbastecimiento(req, filtros = {}) {
  if (!requiereBandejaAbastecimiento(filtros) || esAdministrador(req)) return;
  const err = new Error('La bandeja de abastecimiento es exclusiva para administradores.');
  err.status = 403;
  throw err;
}

function formatGsPlano(valor) {
  const n = Math.max(0, Math.round(Number(valor) || 0));
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

function esProductoCargadoPorAdmin(prod) {
  if (!prod) return false;
  if (prod.creado_por == null) return true;
  return prod.Creador?.Rol?.nombre === 'administrador';
}

/**
 * Detecta si un pedido contiene productos del catalogo Gesicom y calcula el
 * costo que debe pagar la tienda para iniciar el abastecimiento.
 */
async function calcularAbastecimientoDesdeItems(items, usuario_id, t) {
  let costo = 0;
  let requiere = false;

  for (const item of items || []) {
    const receta = await resolverReceta(item, t);
    for (const { producto_id, cantidad } of receta) {
      const prod = await Producto.findByPk(producto_id, {
        transaction: t,
        include: [{ model: Usuario, as: 'Creador', include: [Rol] }],
      });
      if (!esProductoCargadoPorAdmin(prod)) continue;
      requiere = true;
      costo += costoParaComerciante(prod, usuario_id) * (Number(cantidad) || 0);
    }
  }

  return {
    requiere,
    costo: Math.max(0, Math.round(costo)),
    estado: requiere ? 'pendiente_pago' : 'no_requiere',
  };
}

async function aplicarAbastecimientoCalculado(envio, items, usuario_id, t) {
  const abastecimiento = await calcularAbastecimientoDesdeItems(items, usuario_id, t);
  await envio.update({
    abastecimiento_estado: abastecimiento.estado,
    abastecimiento_costo: abastecimiento.costo,
    abastecimiento_pagado_at: null,
    abastecimiento_recibido_at: null,
  }, { transaction: t });
  return abastecimiento;
}

function accionSiguientePedido(envioLike) {
  const envio = typeof envioLike.toJSON === 'function' ? envioLike.toJSON() : envioLike;
  const costo = Number(envio.abastecimiento_costo) || 0;
  const abastecimiento = envio.abastecimiento_estado || 'no_requiere';

  if (envio.estado === 'Pendiente') {
    return {
      tipo: 'confirmar',
      titulo: 'Confirmar pedido',
      descripcion: 'Validar datos, dirección y disponibilidad antes de mover stock.',
      cta: 'Completar datos',
      tono: 'warning',
      siguiente_estado: 'Confirmado',
      prioridad: 10,
    };
  }

  if (envio.estado === 'Confirmado') {
    if (abastecimiento === 'pendiente_pago') {
      return {
        tipo: 'pagar_abastecimiento',
        titulo: `Pagar ${formatGsPlano(costo)} para iniciar abastecimiento`,
        descripcion: 'Tenes 24 horas para pagar el abastecimiento. Gesicom procesa el pedido recien cuando el pago este acreditado.',
        cta: 'Pagar abastecimiento',
        tono: 'danger',
        requiere_pago: true,
        prioridad: 20,
      };
    }
    if (abastecimiento === 'en_proceso') {
      return {
        tipo: 'abastecimiento_en_proceso',
        titulo: 'Abastecimiento en proceso',
        descripcion: 'Gesicom esta preparando la mercaderia para la tienda.',
        cta: null,
        tono: 'info',
        prioridad: 30,
      };
    }
    if (abastecimiento === 'recibido') {
      return {
        tipo: 'listo_para_despacho',
        titulo: 'Listo para despacho',
        descripcion: 'La mercaderia ya llego al deposito.',
        cta: 'Preparar pedido',
        tono: 'success',
        siguiente_estado: 'Preparado',
        prioridad: 40,
      };
    }
    return {
      tipo: 'preparar',
      titulo: 'Preparar pedido',
      descripcion: 'Separar, embalar y dejar listo para enviar.',
      cta: 'Preparar',
      tono: 'info',
      siguiente_estado: 'Preparado',
      prioridad: 40,
    };
  }

  if (envio.estado === 'Preparado') {
    return {
      tipo: 'despachar',
      titulo: 'Despachar pedido',
      descripcion: 'Asignar salida con courier o entrega propia.',
      cta: 'Despachar',
      tono: 'info',
      siguiente_estado: 'Despachado',
      prioridad: 50,
    };
  }

  if (envio.estado === 'Despachado' || envio.estado === 'Reprogramado') {
    return {
      tipo: 'resultado_entrega',
      titulo: 'Gestionar resultado de entrega',
      descripcion: 'Marcar entregado, reprogramado, devuelto o perdido segun corresponda.',
      cta: 'Actualizar resultado',
      tono: 'warning',
      prioridad: 60,
    };
  }

  if (envio.estado === 'Entregado' && envio.estado_financiero === 'pendiente_liquidacion') {
    return {
      tipo: 'rendir',
      titulo: 'Rendir dinero del pedido',
      descripcion: 'Cerrar la liquidacion pendiente.',
      cta: 'Rendir',
      tono: 'success',
      prioridad: 70,
    };
  }

  return {
    tipo: 'cerrado',
    titulo: 'Sin acciones pendientes',
    descripcion: 'El pedido no requiere una accion operativa ahora.',
    cta: null,
    tono: 'neutral',
    prioridad: 999,
  };
}

function decorarEnvio(envio) {
  const plano = typeof envio.toJSON === 'function' ? envio.toJSON() : envio;
  const ultimoRecordatorio = (plano.recordatorios && plano.recordatorios.length > 0)
    ? plano.recordatorios.find(r => r.estado === 'PENDIENTE' || r.estado === 'VENCIDO') || plano.recordatorios[plano.recordatorios.length - 1]
    : null;
  const ahora = new Date();
  const estaVencido = ultimoRecordatorio && (
    ultimoRecordatorio.estado === 'VENCIDO' ||
    (ultimoRecordatorio.estado === 'PENDIENTE' && new Date(ultimoRecordatorio.ejecutar_en) <= ahora)
  );

  return {
    ...plano,
    recordatorio_id: ultimoRecordatorio?.id || null,
    recordatorio_estado: estaVencido ? 'VENCIDO' : (ultimoRecordatorio?.estado || null),
    recordatorio_ejecutar_en: ultimoRecordatorio?.ejecutar_en || null,
    recordatorio_nota: ultimoRecordatorio?.nota || null,
    recordatorio_vencido: Boolean(estaVencido),
    accion_siguiente: accionSiguientePedido(plano),
  };
}

function resumenAccionesSiguientes(envios) {
  const porTipo = new Map();
  for (const envio of envios) {
    const accion = accionSiguientePedido(envio);
    if (accion.tipo === 'cerrado') continue;
    const actual = porTipo.get(accion.tipo) || {
      ...accion,
      cantidad: 0,
      costo_total: 0,
    };
    actual.cantidad += 1;
    if (accion.tipo === 'pagar_abastecimiento') {
      actual.costo_total += Number(envio.abastecimiento_costo) || 0;
      actual.titulo = `Pagar ${formatGsPlano(actual.costo_total)} para iniciar abastecimiento`;
    }
    porTipo.set(accion.tipo, actual);
  }
  return Array.from(porTipo.values()).sort((a, b) => a.prioridad - b.prioridad);
}

exports.listEnvios = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    // La regla del proyecto: endpoints con filtros dinámicos son POST y leen de req.body
    const { fecha_desde, fecha_hasta, estado, confirmador, courier_id, origen } = req.body;

    const where = whereEnviosDeUsuario(req);
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

    res.json(envios.map(decorarEnvio));
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
      pedido_id,
      envio_id,
      fecha_desde,
      fecha_hasta,
      estados,          // array de strings, ej: ['Pendiente', 'Confirmado']
      cliente,          // texto libre: busca en nombre_cliente + apellido_cliente + telefono
      ciudad,
      courier_id,
      confirmador,
      origen,
      canal_venta_id,
      producto_busqueda,
      solo_abastecimiento,
      abastecimiento_estado,
      // --- Filtros de seguimiento WhatsApp (BE-10) ---
      etiqueta_id,             // pedidos con esa etiqueta activa
      plantilla_id,            // pedidos donde se usó esa plantilla al menos una vez
      seguimiento_responsable_id, // usuario_id del recordatorio (no confundir con "confirmador", que es texto libre)
      seguimiento_pendiente,   // true = tiene un recordatorio PENDIENTE (no vencido)
      seguimiento_vencido,     // true = tiene un recordatorio PENDIENTE cuyo ejecutar_en ya pasó
      seguimiento_fecha_desde, // rango sobre ejecutar_en del próximo recordatorio PENDIENTE
      seguimiento_fecha_hasta,
    } = req.body;

    asegurarAdminParaBandejaAbastecimiento(req, { solo_abastecimiento, abastecimiento_estado });

    const where = whereEnviosDeUsuario(req);

    // Rango de fechas (dispatchedAt)
    aplicarFiltrosNumeroPedido(where, req, { pedido_id, envio_id });

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
        orList.push({ numero_pedido: numericId });
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
    aplicarFiltroAbastecimiento(where, { solo_abastecimiento, abastecimiento_estado });
    if (producto_busqueda && producto_busqueda.trim()) {
      const term = producto_busqueda.trim().replace(/'/g, "''");
      where[Op.and] = [
        ...(where[Op.and] || []),
        Sequelize.literal(`EXISTS (
          SELECT 1
          FROM envio_items filtro_producto_item
          WHERE filtro_producto_item.envio_id = "Envio"."id"
            AND (
              filtro_producto_item.nombre_producto ILIKE '%${term}%'
              OR filtro_producto_item.oferta_nombre ILIKE '%${term}%'
            )
        )`),
      ];
    }

    // --- Filtros de seguimiento WhatsApp (BE-10) ---
    const filtrosAnd = [];
    if (etiqueta_id) {
      filtrosAnd.push(Sequelize.literal(`EXISTS (
        SELECT 1 FROM envio_etiquetas ee
        WHERE ee.envio_id = "Envio"."id" AND ee.activa = true AND ee.etiqueta_id = ${Number(etiqueta_id) || 0}
      )`));
    }
    if (plantilla_id) {
      filtrosAnd.push(Sequelize.literal(`EXISTS (
        SELECT 1 FROM seguimiento_contactos sc
        WHERE sc.envio_id = "Envio"."id" AND sc.plantilla_id = ${Number(plantilla_id) || 0}
      )`));
    }
    if (seguimiento_responsable_id) {
      filtrosAnd.push(Sequelize.literal(`EXISTS (
        SELECT 1 FROM seguimiento_recordatorios sr
        WHERE sr.envio_id = "Envio"."id" AND sr.estado = 'PENDIENTE' AND sr.usuario_id = ${Number(seguimiento_responsable_id) || 0}
      )`));
    }
    if (seguimiento_vencido) {
      filtrosAnd.push(Sequelize.literal(`EXISTS (
        SELECT 1 FROM seguimiento_recordatorios sr
        WHERE sr.envio_id = "Envio"."id" AND sr.estado IN ('PENDIENTE', 'VENCIDO') AND sr.ejecutar_en <= NOW()
      )`));
    } else if (seguimiento_pendiente) {
      filtrosAnd.push(Sequelize.literal(`EXISTS (
        SELECT 1 FROM seguimiento_recordatorios sr
        WHERE sr.envio_id = "Envio"."id" AND sr.estado = 'PENDIENTE'
      )`));
    }
    if (seguimiento_fecha_desde || seguimiento_fecha_hasta) {
      const desde = seguimiento_fecha_desde ? new Date(seguimiento_fecha_desde) : null;
      const hasta = seguimiento_fecha_hasta ? new Date(seguimiento_fecha_hasta) : null;
      const condiciones = ["sr.envio_id = \"Envio\".\"id\"", "sr.estado = 'PENDIENTE'"];
      if (desde && !isNaN(desde.getTime())) condiciones.push(`sr.ejecutar_en >= '${desde.toISOString()}'`);
      if (hasta && !isNaN(hasta.getTime())) condiciones.push(`sr.ejecutar_en <= '${hasta.toISOString()}'`);
      filtrosAnd.push(Sequelize.literal(`EXISTS (SELECT 1 FROM seguimiento_recordatorios sr WHERE ${condiciones.join(' AND ')})`));
    }
    if (filtrosAnd.length > 0) {
      where[Op.and] = [...(where[Op.and] || []), ...filtrosAnd];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;
    const order = abastecimiento_estado === 'en_proceso'
      ? [['abastecimiento_pagado_at', 'DESC'], ['id', 'DESC']]
      : abastecimiento_estado === 'recibido'
      ? [['abastecimiento_recibido_at', 'DESC'], ['id', 'DESC']]
      : [['id', 'DESC']];

    const { count, rows } = await Envio.findAndCountAll({
      where,
      include: [
        { model: Courier, attributes: ['id', 'nombre'] },
        {
          model: SeguimientoRecordatorio,
          as: 'recordatorios',
          required: false,
          attributes: ['id', 'ejecutar_en', 'estado', 'nota', 'version'],
        },
        {
          model: EnvioItem, as: 'items', attributes: ['id', 'producto_id', 'nombre_producto', 'cantidad', 'precio_unitario', 'subtotal', 'oferta_nombre'],
          include: [{
            model: EnvioItemComponente, as: 'componentes_vendidos',
            attributes: ['id', 'producto_id', 'cantidad', 'cantidad_devuelta_vendible', 'cantidad_devuelta_danada', 'cantidad_perdida'],
          }],
        },
        // Solo para la bandeja de abastecimiento: adónde el admin le manda
        // de vuelta la mercadería al usuario que la vendió (no confundir
        // con la dirección del cliente final, que ya viven como columnas
        // propias del Envio).
        ...(solo_abastecimiento || (abastecimiento_estado && abastecimiento_estado !== 'TODOS') ? [{
          model: Usuario,
          attributes: ['id', 'nombre'],
          include: [{
            model: Tienda,
            attributes: ['deposito_departamento', 'deposito_ciudad', 'deposito_direccion', 'deposito_referencia', 'deposito_telefono', 'whatsapp'],
          }],
        }] : []),
      ],
      order,
      limit: limitNum,
      offset,
      distinct: true, // necesario con includes para que count sea correcto
    });

    res.json({
      data: rows.map(decorarEnvio),
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
      delivery_a_cargo,
      pago_anticipado,
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

    const numeroPedido = await PedidoNumeracion.reservarNumeroPedido(usuario_id, t);

    const nuevoEnvio = await Envio.create(
      {
        usuario_id,
        numero_pedido: numeroPedido,
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
        // Quién paga el flete. Sin dato explícito se asume 'cliente', que es
        // la regla normal del negocio y el default de la columna.
        delivery_a_cargo: delivery_a_cargo === 'negocio' ? 'negocio' : 'cliente',
        // Si ya pagó o paga contra entrega. Sin dato explícito se asume
        // 'false' (contra entrega, el caso normal) — mismo criterio que
        // delivery_a_cargo arriba.
        pago_anticipado: pago_anticipado === true,
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
    const abastecimiento = await aplicarAbastecimientoCalculado(nuevoEnvio, nuevoEnvio.items || [], usuario_id, t);
    await descontarStockYSnapshot(nuevoEnvio.items || [], t, usuario_id);
    await nuevoEnvio.update({ stock_descontado: true }, { transaction: t });
    await registrarHistorial(nuevoEnvio.id, usuario_id, 'Pedido creado manualmente (Confirmado)', t);
    if (abastecimiento.requiere) {
      await registrarHistorial(
        nuevoEnvio.id,
        usuario_id,
        `Abastecimiento Gesicom pendiente de pago: ${formatGsPlano(abastecimiento.costo)}`,
        t
      );
    }

    await t.commit();

    // Retornar envio completo con Courier e Items
    const result = await Envio.findByPk(nuevoEnvio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' }
      ]
    });

    res.status(201).json(decorarEnvio(result));
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
// "EnSeguimiento" (RF Seguimiento WhatsApp) se intercala entre Pendiente y
// Confirmado: lo asigna automáticamente seguimientoController al registrar
// el primer contacto de WhatsApp (ver BE-07), nunca updateEstado a mano.
const ESTADOS_OPERATIVOS = ['Pendiente', 'EnSeguimiento', 'Confirmado', 'Preparado', 'Despachado', 'Reprogramado', 'Entregado', 'Cancelado', 'Devuelto', 'Perdido'];

// Transiciones permitidas desde cada estado actual. "Devuelto" y "Perdido"
// deliberadamente NO aparecen como destino acá: se gestionan por
// producto/cantidad vía POST /:id/devolucion y POST /:id/perdida (abajo),
// que validan su propia transición y aplican su propio movimiento de stock.
const TRANSICIONES_VALIDAS = {
  Pendiente: ['Confirmado', 'Cancelado', 'EnSeguimiento'],
  EnSeguimiento: ['Confirmado', 'Reprogramado', 'Cancelado'],
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
      abastecimiento_estado,
      // Campos que completa el modal único de Pedido (mismo componente de
      // alta, en modo "completar") al confirmar — el checkout público no
      // los pide (ruc es opcional ahí; courier/costo de envío los define
      // el staff, nunca el visitante).
      ruc, direccion, referencia, link_maps, costo_envio, delivery_a_cargo, pago_anticipado, metodo_pago,
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

    if (!estado && courier_id === undefined && !estado_comercial && !estado_logistico && abastecimiento_estado === undefined) {
      await t.rollback();
      return res.status(400).json({ error: 'Se requiere al menos estado o courier_id' });
    }

    const filtro = esAdministrador(req) ? { id } : { id, usuario_id };

    // Bloqueo de la fila ANTES de leerla con sus items. Sin esto, dos cambios
    // de estado simultáneos sobre el mismo pedido —un doble click en
    // "Confirmar", o dos operadores a la vez— leían ambos `stock_descontado`
    // en false y descontaban stock DOS VECES: con READ COMMITTED (el default
    // de Postgres) ninguno ve el cambio del otro hasta que commitea.
    //
    // El lock va en una consulta aparte, SIN include: un FOR UPDATE sobre el
    // lado nullable de un LEFT JOIN es un error en Postgres.
    const bloqueo = await Envio.findOne({
      where: filtro,
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!bloqueo) {
      await t.rollback();
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const envio = await Envio.findOne({
      where: filtro,
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
      if (estado === 'Preparado' && ['pendiente_pago', 'en_proceso'].includes(envio.abastecimiento_estado)) {
        await t.rollback();
        return res.status(400).json({
          error: envio.abastecimiento_estado === 'pendiente_pago'
            ? `Primero se debe pagar ${formatGsPlano(envio.abastecimiento_costo)} para iniciar el abastecimiento Gesicom.`
            : 'El pedido todavia esta en abastecimiento Gesicom. Marcalo como recibido antes de prepararlo.',
        });
      }

      // El pedido VENÍA de "Reprogramado": este cambio de estado —sea cual
      // sea el destino, incluso otro "Reprogramado"— es la resolución del
      // viaje que se acababa de hacer, así que es acá donde recién se sabe
      // cuánto costó (antes se pedía al ENTRAR a Reprogramado, pero en ese
      // momento el courier todavía no había avisado el precio). El viaje en
      // falso ya se hizo y ya se paga: se suma al costo del pedido en vez de
      // perderse. Antes de esto el courier podía ir tres veces y el sistema
      // registraba un solo envío, dejando el costo real fuera del margen y
      // fuera de la rendición.
      if (envio.estado === 'Reprogramado') {
        const costoViajeAnterior = costo_intento !== undefined ? Math.max(0, Number(costo_intento) || 0) : 0;
        const { cantidad, acumulado } = await viajesPrevios(envio.id, t);
        await registrarViaje(envio, {
          numero: cantidad + 1,
          resultado: 'reprogramado',
          costo: costoViajeAnterior,
          // Motivo y fecha de ESTE viaje ya quedaron guardados en el envío
          // cuando se entró a Reprogramado — acá solo se resuelve el costo.
          motivo: envio.motivo_reprogramacion || null,
          fecha_reprogramada: envio.fecha_reprogramada || null,
        }, t);
        updateData.costo_envio = acumulado + costoViajeAnterior;
        if (costoViajeAnterior > 0) {
          await registrarHistorial(envio.id, usuario_id, `Viaje en falso: Gs ${costoViajeAnterior.toLocaleString('es-PY')}`, t);
        }
      }

      if (estado === 'Reprogramado') {
        if (!fecha_reprogramada) {
          await t.rollback();
          return res.status(400).json({ error: 'fecha_reprogramada es obligatoria para reprogramar el pedido' });
        }
        updateData.fecha_reprogramada = fecha_reprogramada;
        updateData.motivo_reprogramacion = motivo_reprogramacion || null;
      }

      if (estado === 'Entregado') {
        const metodoFinal = metodo_pago_id !== undefined ? metodo_pago_id : envio.metodo_pago_id;
        const montoFinal = monto !== undefined ? monto : envio.monto;
        const costoFinal = costo_envio !== undefined ? costo_envio : envio.costo_envio;
        if (!metodoFinal || montoFinal === undefined || montoFinal === null || costoFinal === undefined || costoFinal === null) {
          await t.rollback();
          return res.status(400).json({ error: 'metodo_pago_id, monto y costo_envio son obligatorios para marcar el pedido como Entregado' });
        }
        // El nombre y la comisión salen del catálogo, no de lo que mande el
        // cliente: MarcarEntregadoModal solo pide `metodo_pago_id` (nunca el
        // texto ni la comisión), así que si acá se confiara en un texto/
        // comisión aparte, quedarían desincronizados con el método elegido
        // — exactamente el bug real: el pedido #385 quedó con
        // metodo_pago_id apuntando a "POS / Tarjeta" pero el texto todavía
        // decía "Efectivo contra entrega", y la comisión recién se calculó
        // (desde otro lado) días después, sobre un método que ya estaba mal
        // etiquetado. Un solo lookup, y los tres campos se escriben juntos.
        const metodoEntregado = await MetodoPago.findByPk(metodoFinal, { transaction: t });
        if (!metodoEntregado) {
          await t.rollback();
          return res.status(400).json({ error: `Método de pago inválido: "${metodoFinal}".` });
        }
        updateData.metodo_pago_id = metodoFinal;
        updateData.metodo_pago = metodoEntregado.nombre;
        updateData.comision_pct_aplicada = Number(metodoEntregado.comision_porcentaje) || 0;
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
        const abastecimiento = await aplicarAbastecimientoCalculado(envio, envio.items || [], envio.usuario_id, t);
        Object.assign(updateData, {
          abastecimiento_estado: abastecimiento.estado,
          abastecimiento_costo: abastecimiento.costo,
          abastecimiento_pagado_at: null,
          abastecimiento_recibido_at: null,
        });
        if (abastecimiento.requiere) {
          await registrarHistorial(
            envio.id,
            usuario_id,
            `Abastecimiento Gesicom pendiente de pago: ${formatGsPlano(abastecimiento.costo)}`,
            t
          );
        }
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
      if (estado === 'Entregado' && updateData.metodo_pago) {
        // Reusa el lookup de arriba: no hace falta pedirlo dos veces.
        await registrarHistorial(envio.id, usuario_id, `Método de pago: ${updateData.metodo_pago}`, t);
      }
    }

    if (estado_comercial !== undefined) updateData.estado_comercial = estado_comercial;
    if (estado_logistico !== undefined && updateData.estado_logistico === undefined) updateData.estado_logistico = estado_logistico;
    if (abastecimiento_estado !== undefined) {
      if (!esAdministrador(req)) {
        await t.rollback();
        return res.status(403).json({ error: 'Solo un administrador puede acreditar o recibir abastecimiento manualmente.' });
      }
      if (!ABASTECIMIENTO_ESTADOS.includes(abastecimiento_estado)) {
        await t.rollback();
        return res.status(400).json({ error: `Estado de abastecimiento invalido: "${abastecimiento_estado}".` });
      }
      if (envio.abastecimiento_estado === 'no_requiere' && abastecimiento_estado !== 'no_requiere') {
        await t.rollback();
        return res.status(400).json({ error: 'Este pedido no requiere abastecimiento Gesicom.' });
      }
      updateData.abastecimiento_estado = abastecimiento_estado;
      if (abastecimiento_estado === 'en_proceso' && envio.abastecimiento_estado !== 'en_proceso') {
        updateData.abastecimiento_pagado_at = new Date();
        await registrarHistorial(envio.id, usuario_id, 'Abastecimiento Gesicom pagado. En proceso.', t);
      }
      if (abastecimiento_estado === 'recibido' && envio.abastecimiento_estado !== 'recibido') {
        updateData.abastecimiento_recibido_at = new Date();
        await registrarHistorial(envio.id, usuario_id, 'Abastecimiento Gesicom recibido en deposito.', t);
      }
    }
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
    // Se puede corregir en cualquier momento del ciclo del pedido: recién al
    // cerrar la venta se sabe si al final el flete se le cobró al cliente o
    // lo terminó absorbiendo el comercio.
    if (delivery_a_cargo === 'cliente' || delivery_a_cargo === 'negocio') {
      updateData.delivery_a_cargo = delivery_a_cargo;
    }
    // Igual que delivery_a_cargo: se puede corregir en cualquier momento
    // del ciclo del pedido, y no tiene relación con metodo_pago_id.
    if (typeof pago_anticipado === 'boolean') {
      updateData.pago_anticipado = pago_anticipado;
    }
    // Mismo criterio que en la transición a Entregado: si el pedido to el
    // método de pago cambia (edición fuera de esa transición — ej. NuevoPe-
    // didoModal en modo editar), el nombre y la comisión se derivan del
    // catálogo en vez de confiar en lo que el formulario haya calculado.
    // El bloque de arriba ya cubrió el caso `estado === 'Entregado'`; este
    // es para cuando se toca metodo_pago_id SIN cambiar de estado.
    if (metodo_pago_id !== undefined && updateData.metodo_pago_id === undefined) {
      const metodoEditado = await MetodoPago.findByPk(metodo_pago_id, { transaction: t });
      if (!metodoEditado) {
        await t.rollback();
        return res.status(400).json({ error: `Método de pago inválido: "${metodo_pago_id}".` });
      }
      updateData.metodo_pago_id = metodo_pago_id;
      updateData.metodo_pago = metodoEditado.nombre;
      updateData.comision_pct_aplicada = Number(metodoEditado.comision_porcentaje) || 0;
    } else if (metodo_pago !== undefined && updateData.metodo_pago === undefined) {
      // Sin metodo_pago_id (carga legacy o texto libre): se respeta el texto
      // tal cual, como siempre.
      updateData.metodo_pago = metodo_pago;
    }
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

    if (updateData.estado) {
      cancelarSiEstadoTerminal(envio.id, updateData.estado);
    }

    const result = await Envio.findByPk(envio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' }
      ]
    });

    res.json(decorarEnvio(result));
  } catch (error) {
    if (!t.finished) await t.rollback();
    console.error('Error updating estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * Cambia el precio_unitario de UN item de un pedido ya creado — para el
 * caso real de seguimiento comercial: alguien consultó, no compró, y
 * después se le ofrece un descuento puntual para cerrar la venta. No toca
 * `Producto.precio` (el catálogo no se entera), y no está restringido por
 * estado: el precio de un pedido ya Entregado también puede corregirse.
 *
 * El monto del envío se ajusta por DELTA (nuevo_subtotal - subtotal_viejo),
 * nunca recalculando `monto` desde cero — updateEstado ya sufrió ese bug
 * (#385: recalcular como subtotales + flete pisaba pedidos donde el monto
 * no incluía el flete). El delta es correcto sea cual sea la composición
 * original del monto.
 */
exports.actualizarPrecioItem = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const usuario_id = req.usuario.id;
    const { id, itemId } = req.params;
    const { precio_unitario } = req.body;

    const nuevoPrecio = Number(precio_unitario);
    if (!Number.isFinite(nuevoPrecio) || nuevoPrecio < 0) {
      await t.rollback();
      return res.status(400).json({ error: 'precio_unitario debe ser un número mayor o igual a 0.' });
    }

    const filtro = esAdministrador(req) ? { id } : { id, usuario_id };

    // Mismo patrón de bloqueo que updateEstado: lock en consulta aparte,
    // sin include, para no golpear un FOR UPDATE contra el lado nullable
    // de un LEFT JOIN.
    const bloqueo = await Envio.findOne({ where: filtro, transaction: t, lock: Transaction.LOCK.UPDATE });
    if (!bloqueo) {
      await t.rollback();
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const item = await EnvioItem.findOne({
      where: { id: itemId, envio_id: bloqueo.id },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!item) {
      await t.rollback();
      return res.status(404).json({ error: 'Ítem del pedido no encontrado' });
    }

    const precioAnterior = Number(item.precio_unitario) || 0;
    if (precioAnterior === nuevoPrecio) {
      await t.rollback();
      const sinCambios = await Envio.findOne({
        where: { id: bloqueo.id },
        include: [{ model: EnvioItem, as: 'items' }, { model: Courier }],
      });
      return res.json(decorarEnvio(sinCambios));
    }

    const subtotalAnterior = Number(item.subtotal) || 0;
    const subtotalNuevo = nuevoPrecio * (Number(item.cantidad) || 1);

    await item.update({ precio_unitario: nuevoPrecio, subtotal: subtotalNuevo }, { transaction: t });
    await bloqueo.update({ monto: (Number(bloqueo.monto) || 0) + (subtotalNuevo - subtotalAnterior) }, { transaction: t });

    await registrarHistorial(
      bloqueo.id,
      usuario_id,
      `Precio de "${item.nombre_producto}" cambiado de ${formatGsPlano(precioAnterior)} a ${formatGsPlano(nuevoPrecio)}`,
      t,
    );

    await t.commit();

    const result = await Envio.findOne({
      where: { id: bloqueo.id },
      include: [{ model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] }, { model: EnvioItem, as: 'items' }],
    });
    res.json(decorarEnvio(result));
  } catch (error) {
    if (!t.finished) await t.rollback();
    console.error('Error actualizando precio de item:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * POST /api/envios/:id/abastecimiento/logistica — define quién prepara y
 * despacha el abastecimiento antes de confirmar el pago (RF Gestión de
 * Depósitos, sección 4-6). GESICOMM no requiere depositoId; PROPIA exige un
 * depósito activo del usuario dueño del pedido. Guarda un snapshot del
 * destino para que una edición posterior del depósito no altere el
 * histórico del pedido.
 */
exports.definirLogisticaAbastecimiento = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const { tipoLogistica, depositoId } = req.body || {};

    if (!['GESICOMM', 'PROPIA'].includes(tipoLogistica)) {
      return res.status(400).json({ error: 'tipoLogistica debe ser GESICOMM o PROPIA.' });
    }

    const envio = await Envio.findOne({
      where: esAdministrador(req) ? { id } : { id, usuario_id },
    });
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });

    if (envio.abastecimiento_estado !== 'pendiente_pago') {
      return res.status(400).json({ error: 'La logística solo puede definirse mientras el abastecimiento está pendiente de pago.' });
    }

    const datosLogistica = { tipo_logistica_abastecimiento: tipoLogistica };

    if (tipoLogistica === 'PROPIA') {
      const deposito = await Deposito.findOne({ where: { id: depositoId, usuario_id: envio.usuario_id, activo: true } });
      if (!deposito) {
        return res.status(400).json({ error: 'El depósito indicado no existe, está inactivo o no pertenece a este comercio.' });
      }
      Object.assign(datosLogistica, {
        deposito_destino_id: deposito.id,
        deposito_destino_nombre: deposito.nombre,
        destino_departamento: deposito.departamento,
        destino_ciudad: deposito.ciudad,
        destino_direccion: deposito.direccion,
        destino_referencia: deposito.referencia,
        destino_persona_contacto: deposito.persona_contacto,
        destino_telefono: deposito.telefono_contacto,
        destino_google_maps_url: deposito.google_maps_url,
      });
    } else {
      // GESICOMM resuelve su propio depósito logístico internamente; el
      // frontend nunca envía ni conoce ese ID. Todavía no existe un
      // depósito central de Gesicomm modelado en el sistema (ver sección 9
      // del RF), así que por ahora solo se registra la modalidad.
      Object.assign(datosLogistica, {
        deposito_destino_id: null,
        deposito_destino_nombre: null,
        destino_departamento: null,
        destino_ciudad: null,
        destino_direccion: null,
        destino_referencia: null,
        destino_persona_contacto: null,
        destino_telefono: null,
        destino_google_maps_url: null,
      });
    }

    await envio.update(datosLogistica);
    res.json(decorarEnvio(envio));
  } catch (error) {
    console.error('Error definiendo logistica de abastecimiento:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.iniciarPagoAbastecimiento = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { id } = req.params;
    const envio = await Envio.findOne({
      where: esAdministrador(req) ? { id } : { id, usuario_id },
      include: [{ model: EnvioItem, as: 'items' }],
    });
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });

    const checkout = await iniciarCheckoutAbastecimiento(envio);
    return res.json({ success: true, ...checkout });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('[Abastecimiento] Error iniciando pago:', error);
    return res.status(status).json({ error: error.message || 'No se pudo iniciar el pago de abastecimiento.' });
  }
};

exports.actualizarAbastecimientoManual = async (req, res) => {
  try {
    if (!esAdministrador(req)) {
      return res.status(403).json({ error: 'Solo un administrador puede acreditar o recibir abastecimiento manualmente.' });
    }

    const { id } = req.params;
    const { accion, metodo_acreditacion, nota } = req.body || {};
    const envio = await Envio.findByPk(id, { include: [{ model: EnvioItem, as: 'items' }] });
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });

    const metodo = String(metodo_acreditacion || 'manual').trim();
    const detalle = [metodo, nota].filter(Boolean).join(' - ');

    if (accion === 'acreditar_pago') {
      await acreditarPagoAbastecimiento(envio, null, {
        origen: 'acreditacion manual',
        req,
        usuarioId: req.usuario.id,
        detalle,
      });
    } else if (accion === 'recibir') {
      await marcarAbastecimientoRecibido(envio, {
        usuarioId: req.usuario.id,
        detalle: nota || null,
      });
    } else {
      return res.status(400).json({ error: 'Acción inválida. Usá acreditar_pago o recibir.' });
    }

    const result = await Envio.findByPk(envio.id, {
      include: [
        { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
        { model: EnvioItem, as: 'items' },
      ],
    });
    return res.json(decorarEnvio(result));
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('[Abastecimiento] Error en actualización manual:', error);
    return res.status(status).json({ error: error.message || 'No se pudo actualizar el abastecimiento.' });
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
    const { items, marcar_estado, costo_intento } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Se requiere al menos un ítem a devolver' });
    }

    // Bloqueo de fila: esta operacion mueve stock y dos pedidos simultaneos
    // sobre el mismo envio lo moverian dos veces (READ COMMITTED no los
    // aisla). Sin include, asi que el FOR UPDATE es directo.
    const envio = await Envio.findOne({
      where: { id, usuario_id },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
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
    // Igual que en updateEstado: si el pedido venía de "Reprogramado", este
    // es el momento en que recién se sabe cuánto costó ese viaje en falso.
    if (envio.estado === 'Reprogramado') {
      const costoViajeAnterior = costo_intento !== undefined ? Math.max(0, Number(costo_intento) || 0) : 0;
      const { cantidad, acumulado } = await viajesPrevios(envio.id, t);
      await registrarViaje(envio, {
        numero: cantidad + 1,
        resultado: 'reprogramado',
        costo: costoViajeAnterior,
        motivo: envio.motivo_reprogramacion || null,
        fecha_reprogramada: envio.fecha_reprogramada || null,
      }, t);
      updateData.costo_envio = acumulado + costoViajeAnterior;
      if (costoViajeAnterior > 0) {
        await registrarHistorial(envio.id, usuario_id, `Viaje en falso: Gs ${costoViajeAnterior.toLocaleString('es-PY')}`, t);
      }
    }
    if (marcar_estado) {
      updateData.estado = 'Devuelto';
      updateData.estado_logistico = 'Devuelto';
      await registrarHistorial(envio.id, usuario_id, `${envio.estado} → Devuelto`, t);
    }
    await envio.update(updateData, { transaction: t });
    await t.commit();

    if (updateData.estado) {
      cancelarSiEstadoTerminal(envio.id, updateData.estado);
    }

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
    const { items, marcar_estado, costo_intento } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Se requiere al menos un ítem perdido' });
    }

    // Bloqueo de fila: esta operacion mueve stock y dos pedidos simultaneos
    // sobre el mismo envio lo moverian dos veces (READ COMMITTED no los
    // aisla). Sin include, asi que el FOR UPDATE es directo.
    const envio = await Envio.findOne({
      where: { id, usuario_id },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
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
    // Igual que en updateEstado: si el pedido venía de "Reprogramado", este
    // es el momento en que recién se sabe cuánto costó ese viaje en falso.
    if (envio.estado === 'Reprogramado') {
      const costoViajeAnterior = costo_intento !== undefined ? Math.max(0, Number(costo_intento) || 0) : 0;
      const { cantidad, acumulado } = await viajesPrevios(envio.id, t);
      await registrarViaje(envio, {
        numero: cantidad + 1,
        resultado: 'reprogramado',
        costo: costoViajeAnterior,
        motivo: envio.motivo_reprogramacion || null,
        fecha_reprogramada: envio.fecha_reprogramada || null,
      }, t);
      updateData.costo_envio = acumulado + costoViajeAnterior;
      if (costoViajeAnterior > 0) {
        await registrarHistorial(envio.id, usuario_id, `Viaje en falso: Gs ${costoViajeAnterior.toLocaleString('es-PY')}`, t);
      }
    }
    if (marcar_estado) {
      updateData.estado = 'Perdido';
      updateData.estado_logistico = 'Perdido';
      await registrarHistorial(envio.id, usuario_id, `${envio.estado} → Perdido`, t);
    }
    await envio.update(updateData, { transaction: t });
    await t.commit();

    if (updateData.estado) {
      cancelarSiEstadoTerminal(envio.id, updateData.estado);
    }

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
    const { pedido_id, envio_id, fecha_desde, fecha_hasta, cliente, ciudad, courier_id, confirmador, origen, producto, producto_busqueda, metodo_pago_id, solo_abastecimiento, abastecimiento_estado } = req.body;
    asegurarAdminParaBandejaAbastecimiento(req, { solo_abastecimiento, abastecimiento_estado });

    const where = whereEnviosDeUsuario(req);
    aplicarFiltrosNumeroPedido(where, req, { pedido_id, envio_id });
    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
    }
    agregarBusquedaClienteONumero(where, cliente);
    if (ciudad && ciudad.trim()) where.ciudad = { [Op.iLike]: `%${ciudad.trim()}%` };
    if (courier_id && courier_id !== 'TODOS') where.courier_id = courier_id === 'null' ? null : Number(courier_id);
    if (confirmador && confirmador !== 'TODOS' && confirmador.trim()) where.confirmador = { [Op.iLike]: `%${confirmador.trim()}%` };
    if (origen && origen !== 'TODOS') where.origen = origen;
    if (metodo_pago_id && metodo_pago_id !== 'TODOS') where.metodo_pago_id = Number(metodo_pago_id);
    aplicarFiltroAbastecimiento(where, { solo_abastecimiento, abastecimiento_estado });
    if (producto_busqueda && producto_busqueda.trim()) {
      const term = producto_busqueda.trim().replace(/'/g, "''");
      where[Op.and] = [
        ...(where[Op.and] || []),
        Sequelize.literal(`EXISTS (
          SELECT 1
          FROM envio_items conteo_producto_item
          WHERE conteo_producto_item.envio_id = "Envio"."id"
            AND (
              conteo_producto_item.nombre_producto ILIKE '%${term}%'
              OR conteo_producto_item.oferta_nombre ILIKE '%${term}%'
            )
        )`),
      ];
    }

    const include = [];
    if (producto && producto !== 'TODOS' && !producto_busqueda) {
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

    try {
      const tenantId = req.usuario.id;
      const [vencidosFila] = await sequelize.query(`
        SELECT COUNT(DISTINCT e.id) AS cantidad
        FROM envios e
        INNER JOIN seguimiento_recordatorios sr ON sr.envio_id = e.id
        WHERE e.usuario_id = :tenantId
          AND e.estado NOT IN ('Entregado', 'Cancelado', 'Devuelto', 'Perdido')
          AND (sr.estado = 'VENCIDO' OR (sr.estado = 'PENDIENTE' AND sr.ejecutar_en <= NOW()))
      `, {
        replacements: { tenantId },
        type: Sequelize.QueryTypes.SELECT,
      });
      conteos.seguimiento_vencidos = parseInt(vencidosFila?.cantidad || 0, 10);
    } catch (errVencidos) {
      console.error('Error calculando seguimiento_vencidos en conteoPorEstado:', errVencidos);
      conteos.seguimiento_vencidos = 0;
    }

    res.json(conteos);
  } catch (error) {
    console.error('Error obteniendo conteo por estado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

exports.conteoPorAbastecimiento = async (req, res) => {
  try {
    if (!esAdministrador(req)) {
      return res.status(403).json({ error: 'La bandeja de abastecimiento es exclusiva para administradores.' });
    }

    const {
      pedido_id,
      envio_id,
      fecha_desde,
      fecha_hasta,
      cliente,
      ciudad,
      courier_id,
      confirmador,
      origen,
      producto,
      producto_busqueda,
      metodo_pago_id,
    } = req.body;

    const where = whereEnviosDeUsuario(req);
    aplicarFiltrosNumeroPedido(where, req, { pedido_id, envio_id });
    where.abastecimiento_estado = { [Op.in]: ['pendiente_pago', 'en_proceso', 'recibido'] };

    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
    }
    agregarBusquedaClienteONumero(where, cliente);
    if (ciudad && ciudad.trim()) where.ciudad = { [Op.iLike]: `%${ciudad.trim()}%` };
    if (courier_id && courier_id !== 'TODOS') where.courier_id = courier_id === 'null' ? null : Number(courier_id);
    if (confirmador && confirmador !== 'TODOS' && confirmador.trim()) where.confirmador = { [Op.iLike]: `%${confirmador.trim()}%` };
    if (origen && origen !== 'TODOS') where.origen = origen;
    if (metodo_pago_id && metodo_pago_id !== 'TODOS') where.metodo_pago_id = Number(metodo_pago_id);
    if (producto_busqueda && producto_busqueda.trim()) {
      const term = producto_busqueda.trim().replace(/'/g, "''");
      where[Op.and] = [
        ...(where[Op.and] || []),
        Sequelize.literal(`EXISTS (
          SELECT 1
          FROM envio_items conteo_abastecimiento_item
          WHERE conteo_abastecimiento_item.envio_id = "Envio"."id"
            AND (
              conteo_abastecimiento_item.nombre_producto ILIKE '%${term}%'
              OR conteo_abastecimiento_item.oferta_nombre ILIKE '%${term}%'
            )
        )`),
      ];
    }

    const include = [];
    if (producto && producto !== 'TODOS' && !producto_busqueda) {
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
      attributes: ['abastecimiento_estado', [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('Envio.id'))), 'cantidad']],
      group: ['abastecimiento_estado'],
      raw: true,
    });

    const conteos = { pendiente_pago: 0, en_proceso: 0, recibido: 0, TODOS: 0 };
    for (const fila of filas) {
      const estado = fila.abastecimiento_estado;
      const cantidad = parseInt(fila.cantidad, 10) || 0;
      if (estado in conteos) {
        conteos[estado] = cantidad;
        conteos.TODOS += cantidad;
      }
    }

    res.json(conteos);
  } catch (error) {
    const status = error.status || 500;
    console.error('Error obteniendo conteo por abastecimiento:', error);
    res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
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
    const { pedido_id, envio_id, fecha_desde, fecha_hasta, cliente, ciudad, courier_id, confirmador, origen, producto, producto_busqueda, metodo_pago_id, solo_abastecimiento, abastecimiento_estado } = req.body;
    asegurarAdminParaBandejaAbastecimiento(req, { solo_abastecimiento, abastecimiento_estado });

    const where = { ...whereEnviosDeUsuario(req), estado: 'Entregado' };
    aplicarFiltrosNumeroPedido(where, req, { pedido_id, envio_id });
    if (fecha_desde && fecha_hasta) {
      where.dispatchedAt = { [Op.between]: [fecha_desde, fecha_hasta] };
    } else if (fecha_desde) {
      where.dispatchedAt = { [Op.gte]: fecha_desde };
    } else if (fecha_hasta) {
      where.dispatchedAt = { [Op.lte]: fecha_hasta };
    }
    agregarBusquedaClienteONumero(where, cliente);
    if (ciudad && ciudad.trim()) where.ciudad = { [Op.iLike]: `%${ciudad.trim()}%` };
    if (courier_id && courier_id !== 'TODOS') where.courier_id = courier_id === 'null' ? null : Number(courier_id);
    if (confirmador && confirmador !== 'TODOS' && confirmador.trim()) where.confirmador = { [Op.iLike]: `%${confirmador.trim()}%` };
    if (origen && origen !== 'TODOS') where.origen = origen;
    if (metodo_pago_id && metodo_pago_id !== 'TODOS') where.metodo_pago_id = Number(metodo_pago_id);
    aplicarFiltroAbastecimiento(where, { solo_abastecimiento, abastecimiento_estado });
    if (producto_busqueda && producto_busqueda.trim()) {
      const term = producto_busqueda.trim().replace(/'/g, "''");
      where[Op.and] = [
        ...(where[Op.and] || []),
        Sequelize.literal(`EXISTS (
          SELECT 1
          FROM envio_items resumen_producto_item
          WHERE resumen_producto_item.envio_id = "Envio"."id"
            AND (
              resumen_producto_item.nombre_producto ILIKE '%${term}%'
              OR resumen_producto_item.oferta_nombre ILIKE '%${term}%'
            )
        )`),
      ];
    }
    const productoId = producto && producto !== 'TODOS' && !producto_busqueda ? Number(producto) : null;
    if (Number.isFinite(productoId)) {
      where[Op.and] = [
        ...(where[Op.and] || []),
        Sequelize.literal(`EXISTS (
          SELECT 1
          FROM envio_items resumen_producto_item
          WHERE resumen_producto_item.envio_id = "Envio"."id"
            AND resumen_producto_item.producto_id = ${productoId}
        )`),
      ];
    }

    const include = [
      { model: MetodoPago, attributes: ['id', 'nombre', 'custodia_cobro'] },
      {
        model: EnvioItem,
        as: 'items',
        attributes: ['id', 'producto_id', 'cantidad', 'precio_unitario', 'subtotal'],
        required: false,
      },
    ];

    const envios = await Envio.findAll({
      where, include,
      attributes: ['id', 'monto', 'costo_envio', 'estado_financiero', 'delivery_a_cargo', 'cupon_descuento'],
    });

    let cantidad = 0, montoTotal = 0, dineroCourier = 0, cobradoDirecto = 0, costoTotalCourier = 0, pendientesRendicion = 0;
    const desglosePorMetodo = new Map();

    for (const e of envios) {
      cantidad += 1;
      const monto = Number(e.monto) || 0;
      const costoEnvio = Number(e.costo_envio) || 0;
      const pendienteLiquidacion = e.estado_financiero === 'pendiente_liquidacion';
      montoTotal += monto;

      const custodia = e.MetodoPago ? e.MetodoPago.custodia_cobro : 'negocio';
      if (custodia === 'courier') {
        if (pendienteLiquidacion) {
          const dv = desgloseDelivery(e);
          dineroCourier += monto + dv.envio_fuera_del_monto;
        }
      } else {
        cobradoDirecto += monto;
      }
      if (pendienteLiquidacion) {
        pendientesRendicion += 1;
        costoTotalCourier += costoEnvio;
      }

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

    const where = whereEnviosDeUsuario(req);
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
      attributes: [
        'id', 'estado', 'estado_financiero', 'fecha_reprogramada', 'courier_id',
        'abastecimiento_estado', 'abastecimiento_costo',
      ],
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

    res.json({
      trabajo_pendiente: trabajoPendiente,
      resultado_operativo: resultadoOperativo,
      desempeno_courier: desempenoCourier,
      siguientes_acciones: resumenAccionesSiguientes(envios),
    });
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

    // Este borrado libera stock (ver mas abajo), asi que la fila se bloquea
    // antes de leerla con sus items. El lock va en una consulta aparte porque
    // un FOR UPDATE sobre el lado nullable de un LEFT JOIN falla en Postgres.
    const bloqueoBorrado = await Envio.findOne({
      where: { id, usuario_id: req.usuario.tenantId },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!bloqueoBorrado) {
      await t.rollback();
      return res.status(404).json({ error: 'Pedido no encontrado' });
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

exports.descontarStockYSnapshot = descontarStockYSnapshot;
exports.calcularAbastecimientoDesdeItems = calcularAbastecimientoDesdeItems;
