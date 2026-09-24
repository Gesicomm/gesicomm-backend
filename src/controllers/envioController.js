const { Envio, EnvioItem, EnvioItemComponente, EnvioIntentoEntrega, Courier, ProveedorLogistico, Producto, ProductoVariante, Oferta, OfertaComponente, MetodoPago, EnvioHistorial, Usuario, Tienda, Deposito, Rol, SeguimientoRecordatorio, InventarioUbicacion, sequelize } = require('../models');
const { Op, Sequelize, Transaction } = require('sequelize');

const { getAnalyticsCompleto } = require('../services/pedidosAnalyticsService');
const { registrarHistorial } = require('../utils/historial');
const { cancelarSiEstadoTerminal } = require('../services/seguimiento/seguimientoRecordatorio.service');
const { desgloseDelivery } = require('../utils/desgloseDelivery');
const { envolverControlador } = require('../utils/asyncHandler');
const PedidoNumeracion = require('../services/pedidoNumeracion.service');
const ProductoService = require('../services/producto.service');
const path = require('path');
const multer = require('multer');
const AbastecimientoFlujo = require('../services/abastecimiento/abastecimientoFlujo.service');
const TarifaDelivery = require('../services/tarifaDelivery.service');
const ProveedorLogisticoService = require('../services/proveedorLogistico.service');

const UPLOADS_TMP_ABASTECIMIENTO = path.join(process.cwd(), 'tmp', 'uploads');
const MAX_COMPROBANTE_ABASTECIMIENTO_BYTES = 5 * 1024 * 1024; // 5MB

const uploadComprobanteAbastecimiento = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_TMP_ABASTECIMIENTO),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: MAX_COMPROBANTE_ABASTECIMIENTO_BYTES },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!permitidos.includes(file.mimetype)) {
      return cb(new Error('Solo se permiten imágenes (JPG, PNG, WebP) o PDF.'));
    }
    cb(null, true);
  },
});

function subirComprobanteAbastecimientoMulter(req, res, next) {
  uploadComprobanteAbastecimiento.single('comprobante')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'El comprobante supera el máximo permitido de 5MB.' });
    }
    return res.status(400).json({ error: err.message || 'Error al subir el comprobante.' });
  });
}

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
/**
 * Reserva stock desde un Centro de Fulfillment de Gesicomm para una venta,
 * ANTES de tocar stock_salon/stock_deposito. Es una reserva puramente
 * informativa/de ruteo: nunca cambia Producto.cantidad_disponible ni
 * stock_deposito (esos siguen siendo, sin excepcion, la unica fuente de
 * verdad de cuanto hay para vender en todo el resto del sistema — catalogo,
 * landing, dashboard, alertas de stock bajo). Lo unico que decide es de
 * donde sale FISICAMENTE lo vendido, para poder avisarle a Gesicomm que
 * tiene que prepararlo (ver EnvioItemComponente.origen_centro_id).
 *
 * Si InventarioUbicacion queda desincronizada de stock_deposito con el
 * tiempo, el peor caso es que un pedido no se rutee a la cola de Gesicomm
 * cuando deberia (se prepara como si fuera stock propio) — nunca se vende
 * de mas ni de menos, porque el total vendible nunca depende de esta tabla.
 */
async function reservarDesdeUbicacionTracked(producto_id, variante_id, cantidadNecesaria, t, permiteGesicomm) {
  if (cantidadNecesaria <= 0) return null;

  // Un deposito propio trackeado (llego por Abastecimiento a "mi deposito")
  // siempre es candidato: es informacion propia del comercio, no depende de
  // como reparte sus entregas. Un Centro Gesicomm solo es candidato si la
  // tienda eligio modalidad GESICOMM — sus couriers propios no tienen forma
  // de retirar de ahi.
  const depositoWhere = permiteGesicomm ? {} : { alcance: { [Op.ne]: 'GESICOMM' } };

  const ubicacion = await InventarioUbicacion.findOne({
    where: {
      producto_id,
      variante_id: variante_id || null,
      cantidad_disponible: { [Op.gt]: 0 },
    },
    include: [{ model: Deposito, as: 'Deposito', where: depositoWhere, attributes: ['alcance'] }],
    order: [['cantidad_disponible', 'DESC']],
    transaction: t,
    lock: Transaction.LOCK.UPDATE,
  });
  if (!ubicacion) return null;

  const cantidad = Math.min(ubicacion.cantidad_disponible, cantidadNecesaria);
  if (cantidad <= 0) return null;

  await ubicacion.update({
    cantidad_disponible: ubicacion.cantidad_disponible - cantidad,
    cantidad_reservada: ubicacion.cantidad_reservada + cantidad,
  }, { transaction: t });

  return { centro_id: ubicacion.deposito_id, cantidad };
}

/**
 * Resuelve, antes de reservar nada, de que ubicacion fisica sale cada linea
 * del pedido — solo para las que tienen stock trackeado en
 * InventarioUbicacion (llegado por Ingreso o Abastecimiento). Lo que no
 * esta trackeado (producto propio cargado directo, sin pasar por ningun
 * flujo de abastecimiento) se trata como stock generico, compatible con
 * cualquier origen: no bloquea, porque hoy no hay forma de saber en cual de
 * los depositos propios del comercio esta.
 *
 * Si dos lineas resuelven a ubicaciones especificas DISTINTAS, el pedido no
 * se puede despachar en un solo paquete: se rechaza con 409
 * PEDIDO_REQUIERE_SPLIT antes de tocar stock.
 */
async function resolverPlanFulfillment(items, t) {
  const totalPorClave = new Map();
  for (const item of items || []) {
    const receta = await resolverReceta(item, t);
    for (const { producto_id, variante_id, cantidad } of receta) {
      const clave = `${producto_id}:${variante_id || ''}`;
      const actual = totalPorClave.get(clave) || { producto_id, variante_id, cantidad: 0 };
      actual.cantidad += cantidad;
      totalPorClave.set(clave, actual);
    }
  }

  let hayGenerico = false;
  const especificos = new Map(); // deposito_id -> alcance
  for (const { producto_id, variante_id } of totalPorClave.values()) {
    const ubicacion = await InventarioUbicacion.findOne({
      where: { producto_id, variante_id: variante_id || null, cantidad_disponible: { [Op.gt]: 0 } },
      include: [{ model: Deposito, as: 'Deposito', attributes: ['alcance'] }],
      order: [['cantidad_disponible', 'DESC']],
      transaction: t,
    });
    if (ubicacion) {
      especificos.set(ubicacion.deposito_id, ubicacion.Deposito?.alcance);
    } else {
      hayGenerico = true;
    }
  }

  const distintos = especificos.size;
  const incluyeGesicomm = [...especificos.values()].includes('GESICOMM');
  const requiereSplit = distintos > 1 || (distintos === 1 && incluyeGesicomm && hayGenerico);

  if (requiereSplit) {
    const err = new Error('Este pedido mezcla productos que están en depósitos distintos: hay que separarlo en dos envíos.');
    err.status = 409;
    err.code = 'PEDIDO_REQUIERE_SPLIT';
    throw err;
  }
}

async function descontarStockYSnapshot(items, t, usuario_id) {
  await resolverPlanFulfillment(items, t);

  // Si la tienda eligio despachar con logistica PROPIA, no tiene sentido
  // reservar de un Centro Gesicomm aunque tenga stock ahi: sus couriers
  // salen de SU deposito, no tienen forma de retirar del centro de
  // Gesicomm. Reservar igual dejaria la venta atada a un lugar que nadie
  // va a ir a buscar.
  const tienda = await Tienda.findOne({ where: { usuario_id }, transaction: t });
  const permiteGesicomm = tienda?.modalidad_fulfillment === 'GESICOMM';

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
  const origenGesicommPorClave = new Map();

  for (const { producto_id, variante_id, cantidad: cantidadTotal } of totalPorClave.values()) {
    const clave = `${producto_id}:${variante_id || ''}`;
    const origenGesicomm = await reservarDesdeUbicacionTracked(producto_id, variante_id, cantidadTotal, t, permiteGesicomm);
    if (origenGesicomm) origenGesicommPorClave.set(clave, origenGesicomm);

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
    if (!prod) {
      const err = new Error(`Producto #${producto_id} no encontrado.`);
      err.status = 404;
      throw err;
    }
    productosPorId.set(producto_id, prod);

    const stockActual = parseInt(prod.cantidad_disponible) || 0;
    if (stockActual < cantidadTotal) {
      const err = new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${stockActual}, solicitado: ${cantidadTotal}.`);
      err.status = 400;
      throw err;
    }
    const nuevoStock = stockActual - cantidadTotal;
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
      const clave = `${producto_id}:${variante_id || ''}`;
      const origenGesicomm = origenGesicommPorClave.get(clave);
      let origen_centro_id = null;
      let cantidad_desde_centro = null;
      if (origenGesicomm && origenGesicomm.cantidad > 0) {
        const tomado = Math.min(origenGesicomm.cantidad, cantidad);
        origen_centro_id = origenGesicomm.centro_id;
        cantidad_desde_centro = tomado;
        origenGesicomm.cantidad -= tomado;
      }
      await EnvioItemComponente.create({
        envio_item_id: item.id,
        producto_id,
        variante_id,
        cantidad,
        costo_unitario: costoParaComerciante(prod, usuario_id),
        origen_centro_id,
        cantidad_desde_centro,
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

  // Lo reservado en un Centro Gesicomm ya salio fisicamente de su deposito
  // al llegar a este punto (Gesicomm lo preparo y lo despacho): se libera
  // la reserva sin volver a cantidad_disponible, porque ya no esta ahi.
  for (const c of componentes) {
    if (!c.origen_centro_id || !c.cantidad_desde_centro) continue;
    const ubicacion = await InventarioUbicacion.findOne({
      where: { producto_id: c.producto_id, variante_id: c.variante_id || null, deposito_id: c.origen_centro_id },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!ubicacion) continue;
    await ubicacion.update({
      cantidad_reservada: Math.max(0, ubicacion.cantidad_reservada - c.cantidad_desde_centro),
    }, { transaction: t });
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

  // Espejo de reservarDesdeUbicacionTracked: solo se devuelve si el pedido nunca se
  // despacho. Si ya se despacho, moverAReservadoATransito ya libero esa
  // reserva (la mercaderia ya habia salido del centro Gesicomm), asi que
  // sumarla de nuevo la duplicaria.
  if (!envio.stock_despachado) {
    for (const c of componentes) {
      if (!c.origen_centro_id || !c.cantidad_desde_centro) continue;
      const ubicacion = await InventarioUbicacion.findOne({
        where: { producto_id: c.producto_id, variante_id: c.variante_id || null, deposito_id: c.origen_centro_id },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!ubicacion) continue;
      await ubicacion.update({
        cantidad_disponible: ubicacion.cantidad_disponible + c.cantidad_desde_centro,
        cantidad_reservada: Math.max(0, ubicacion.cantidad_reservada - c.cantidad_desde_centro),
      }, { transaction: t });
    }
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

    // Que parte de ESTA devolucion corresponde a stock que salio de un
    // Centro Gesicomm: mismo criterio "Gesicomm primero" que uso la venta
    // al reservar (reservarDesdeUbicacionTracked), aplicado ahora en sentido
    // inverso sobre lo que ya se gestiono de este componente. Sin esto,
    // InventarioUbicacion nunca recuperaba una devolucion vendible — el
    // stock quedaba contado como reservado/afuera para siempre.
    const origenTotal = componente.origen_centro_id ? (componente.cantidad_desde_centro || 0) : 0;
    const yaConsumidoDeGesicomm = Math.min(yaGestionado, origenTotal);
    const restanteDeGesicomm = origenTotal - yaConsumidoDeGesicomm;
    const cantDesdeGesicomm = Math.min(restanteDeGesicomm, cant);

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

    // Espejo en InventarioUbicacion: si esta devolucion (o parte de ella)
    // salio originalmente de un centro Gesicomm y vuelve vendible, esas
    // unidades quedan otra vez disponibles ahi — nunca en "reservada", que
    // ya se libero al despachar (moverAReservadoATransito).
    if (condicion === 'vendible' && cantDesdeGesicomm > 0) {
      const ubicacion = await InventarioUbicacion.findOne({
        where: {
          producto_id: componente.producto_id,
          variante_id: componente.variante_id || null,
          deposito_id: componente.origen_centro_id,
        },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (ubicacion) {
        await ubicacion.update({
          cantidad_disponible: ubicacion.cantidad_disponible + cantDesdeGesicomm,
        }, { transaction: t });
      }
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

const { ESTADOS_FINALES: ABASTECIMIENTO_ESTADOS_FINALES } = require('../services/abastecimiento/estadoMachine');

const ABASTECIMIENTO_ESTADOS = [
  'no_requiere',
  'pendiente_pago',
  'pago_enviado',
  'pago_rechazado',
  'pago_validado',
  'proveedor_contactado',
  'enviado_por_proveedor',
  'en_transito_a_gesicomm',
  'recibido_en_gesicomm',
  'preparando_envio_a_deposito_cliente',
  'despachado_a_deposito_cliente',
  'en_transito_a_deposito_cliente',
  'recibido_en_deposito_cliente',
  'disponible_en_gesicomm',
];

/**
 * Agrupaciones para las pestañas de la bandeja de abastecimiento del admin.
 * "pago_enviado" queda separado de "en_seguimiento" porque requiere una
 * acción urgente distinta (validar/rechazar) en vez de simplemente avanzar.
 */
const ABASTECIMIENTO_GRUPOS = {
  pendiente_pago: ['pendiente_pago', 'pago_rechazado'],
  pago_enviado: ['pago_enviado'],
  en_seguimiento: [
    'pago_validado', 'proveedor_contactado', 'enviado_por_proveedor',
    'en_transito_a_gesicomm', 'recibido_en_gesicomm', 'preparando_envio_a_deposito_cliente',
    'despachado_a_deposito_cliente', 'en_transito_a_deposito_cliente',
  ],
  recibido: ['recibido_en_deposito_cliente', 'disponible_en_gesicomm'],
  // Todo lo que ya arrancó el pago (comprobante enviado en adelante), para
  // la pestaña "En seguimiento de abastecimiento" que ve la propia tienda
  // dentro de su tablero general de pedidos (no solo en la bandeja del
  // admin). Incluye también los estados finales: mientras el pedido siga
  // en `estado` Confirmado (sin pasar a Preparado a mano), sigue siendo
  // relevante mostrarlo acá.
  pagado: [
    'pago_enviado', 'pago_validado', 'proveedor_contactado', 'enviado_por_proveedor',
    'en_transito_a_gesicomm', 'recibido_en_gesicomm', 'preparando_envio_a_deposito_cliente',
    'despachado_a_deposito_cliente', 'en_transito_a_deposito_cliente',
    'recibido_en_deposito_cliente', 'disponible_en_gesicomm',
  ],
};

/**
 * Texto de la acción "Avanzar" que ve el admin en cada estado operativo
 * intermedio (punto 12 del RF de seguimiento de abastecimiento). El backend
 * resuelve el siguiente estado real (ver estadoMachine.resolverSiguienteEstadoUnico);
 * esto es solo lo que se muestra en el botón.
 */
const ACCIONES_ABASTECIMIENTO_AVANZAR = {
  pago_validado: { cta: 'Contactar proveedor', descripcion: 'Pago validado. Iniciá la gestión con el proveedor.' },
  proveedor_contactado: { cta: 'Marcar enviado por proveedor', descripcion: 'Proveedor contactado. Marcá cuando despache la mercadería.' },
  enviado_por_proveedor: { cta: 'Marcar en tránsito a Gesicomm', descripcion: 'El proveedor ya despachó. Marcá cuando esté viajando hacia Gesicomm.' },
  en_transito_a_gesicomm: { cta: 'Marcar recibido en Gesicomm', descripcion: 'En tránsito hacia Gesicomm. Marcá cuando llegue.' },
  // recibido_en_gesicomm se resuelve distinto según tipo_logistica_abastecimiento (ver más abajo).
  preparando_envio_a_deposito_cliente: { cta: 'Marcar despachado', descripcion: 'Gesicomm está preparando el envío al depósito del comercio.' },
  despachado_a_deposito_cliente: { cta: 'Marcar en tránsito', descripcion: 'Despachado hacia el depósito del comercio.' },
};

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

function aplicarFiltroAbastecimiento(where, { solo_abastecimiento, abastecimiento_estado, abastecimiento_estado_exacto } = {}) {
  if (abastecimiento_estado_exacto && abastecimiento_estado_exacto !== 'TODOS') {
    if (!ABASTECIMIENTO_ESTADOS.includes(abastecimiento_estado_exacto)) {
      const err = new Error(`Estado de abastecimiento inválido: "${abastecimiento_estado_exacto}".`);
      err.status = 400;
      throw err;
    }
    where.abastecimiento_estado = abastecimiento_estado_exacto;
    return;
  }

  if (abastecimiento_estado && abastecimiento_estado !== 'TODOS') {
    const grupo = ABASTECIMIENTO_GRUPOS[abastecimiento_estado];
    if (grupo) {
      where.abastecimiento_estado = { [Op.in]: grupo };
      return;
    }
    if (!ABASTECIMIENTO_ESTADOS.includes(abastecimiento_estado)) {
      const err = new Error(`Estado de abastecimiento inválido: "${abastecimiento_estado}".`);
      err.status = 400;
      throw err;
    }
    where.abastecimiento_estado = abastecimiento_estado;
    return;
  }

  if (solo_abastecimiento) {
    where.abastecimiento_estado = { [Op.in]: Object.values(ABASTECIMIENTO_GRUPOS).flat() };
  }
}

// Filtrar por abastecimiento_estado/solo_abastecimiento ya no es exclusivo
// de admin: whereEnviosDeUsuario() sigue acotando a sus propios pedidos, así
// que una tienda puede ver su propia pestaña "En seguimiento de
// abastecimiento" sin exponer datos de otros comercios.

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
    for (const { producto_id, variante_id, cantidad } of receta) {
      const prod = await Producto.findByPk(producto_id, {
        transaction: t,
        include: [{ model: Usuario, as: 'Creador', include: [Rol] }],
      });
      if (!esProductoCargadoPorAdmin(prod)) continue;

      // Si ya hay stock de este producto acreditado en InventarioUbicacion
      // (llegó por un Ingreso propio o una SolicitudAbastecimiento ya
      // pagada, en cualquier centro Gesicomm o depósito propio), esa
      // porción no genera una obligación NUEVA de abastecimiento — ya se
      // pagó cuando se trajo. Solo lo que excede ese disponible es nuevo.
      const disponibleAcreditado = (await InventarioUbicacion.sum('cantidad_disponible', {
        where: { producto_id, variante_id: variante_id || null },
        transaction: t,
      })) || 0;
      const cantidadNueva = Math.max(0, (Number(cantidad) || 0) - disponibleAcreditado);
      if (cantidadNueva <= 0) continue;

      requiere = true;
      costo += costoParaComerciante(prod, usuario_id) * cantidadNueva;
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
        descripcion: 'Transferí el monto a la cuenta de Gesicom y subí el comprobante. Gesicom procesa el pedido recién cuando el pago esté validado.',
        cta: 'Pagar abastecimiento',
        tono: 'danger',
        requiere_pago: true,
        prioridad: 20,
      };
    }
    if (abastecimiento === 'pago_enviado') {
      return {
        tipo: 'pago_enviado',
        titulo: 'Comprobante subido, validando pago',
        descripcion: 'El comercio envió el comprobante de transferencia. Un administrador debe validarlo o rechazarlo.',
        cta: 'Validar pago',
        tono: 'warning',
        prioridad: 25,
      };
    }
    if (abastecimiento === 'pago_rechazado') {
      return {
        tipo: 'pago_rechazado',
        titulo: 'Comprobante rechazado',
        descripcion: envio.abastecimiento_pago_rechazo_motivo || 'El administrador rechazó el comprobante. Subí uno nuevo para reintentar.',
        cta: 'Reemplazar comprobante',
        tono: 'danger',
        prioridad: 22,
      };
    }
    if (abastecimiento === 'recibido_en_gesicomm') {
      const esPropia = envio.tipo_logistica_abastecimiento === 'PROPIA';
      return {
        tipo: 'abastecimiento_avanzar',
        titulo: 'En seguimiento abastecimiento',
        descripcion: 'La mercadería llegó a Gesicomm.',
        cta: esPropia ? 'Iniciar preparación para envío' : 'Marcar disponible en Gesicomm',
        tono: 'info',
        prioridad: 30,
      };
    }
    if (ACCIONES_ABASTECIMIENTO_AVANZAR[abastecimiento]) {
      return {
        tipo: 'abastecimiento_avanzar',
        titulo: 'En seguimiento abastecimiento',
        descripcion: ACCIONES_ABASTECIMIENTO_AVANZAR[abastecimiento].descripcion,
        cta: ACCIONES_ABASTECIMIENTO_AVANZAR[abastecimiento].cta,
        tono: 'info',
        prioridad: 30,
      };
    }
    if (abastecimiento === 'en_transito_a_deposito_cliente') {
      return {
        tipo: 'confirmar_recepcion_deposito',
        titulo: 'En tránsito hacia tu depósito',
        descripcion: 'Cuando recibas la mercadería, confirmá la recepción.',
        cta: 'Confirmar recepción',
        tono: 'info',
        prioridad: 35,
      };
    }
    if (abastecimiento === 'recibido_en_deposito_cliente' || abastecimiento === 'disponible_en_gesicomm') {
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
      abastecimiento_estado_exacto,
      // --- Filtros de seguimiento WhatsApp (BE-10) ---
      etiqueta_id,             // pedidos con esa etiqueta activa
      plantilla_id,            // pedidos donde se usó esa plantilla al menos una vez
      seguimiento_responsable_id, // usuario_id del recordatorio (no confundir con "confirmador", que es texto libre)
      seguimiento_pendiente,   // true = tiene un recordatorio PENDIENTE (no vencido)
      seguimiento_vencido,     // true = tiene un recordatorio PENDIENTE cuyo ejecutar_en ya pasó
      seguimiento_fecha_desde, // rango sobre ejecutar_en del próximo recordatorio PENDIENTE
      seguimiento_fecha_hasta,
    } = req.body;


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
    aplicarFiltroAbastecimiento(where, { solo_abastecimiento, abastecimiento_estado, abastecimiento_estado_exacto });
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
    const order = abastecimiento_estado === 'en_seguimiento'
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
      costo_fulfillment,
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
        costo_fulfillment: costo_fulfillment || 0,
        // Quién paga el flete. Sin dato explícito se asume 'cliente', que es
        // la regla normal del negocio y el default de la columna.
        delivery_a_cargo: delivery_a_cargo === 'negocio' ? 'negocio' : 'cliente',
        // Si ya pagó o paga contra entrega. Sin dato explícito se asume
        // 'false' (contra entrega, el caso normal) — mismo criterio que
        // delivery_a_cargo arriba.
        pago_anticipado: pago_anticipado === true,
        metodo_pago: metodo_pago || null,
        metodo_pago_id: metodo_pago_id || null,
        comision_pct_aplicada: comision_pct_aplicada || 0,
        observaciones,
        // Pedido manual: si se pasa estado explícito (ej. "Pendiente"), se respeta;
        // por defecto nace en "Confirmado" (ver plan Gestión de Pedidos, sección 5).
        estado: req.body.estado || 'Confirmado',
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

    // Si nace en "Confirmado", reserva stock real desde la creación.
    if (nuevoEnvio.estado === 'Confirmado') {
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
    } else {
      await registrarHistorial(nuevoEnvio.id, usuario_id, `Pedido creado manualmente (${nuevoEnvio.estado})`, t);
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
    res.status(error.status || 500).json({ error: error.message || 'Error al crear el envío' });
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
    const usuario_id = req.usuario?.id || req.usuario?.tenantId || 0;
    const { id } = req.params;
    const {
      estado, courier_id, proveedor_logistico_id, estado_comercial, estado_logistico,
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

    if (!estado && courier_id === undefined && proveedor_logistico_id === undefined && !estado_comercial && !estado_logistico) {
      await t.rollback();
      return res.status(400).json({ error: 'Se requiere al menos estado o courier_id' });
    }

    const idNum = parseInt(id, 10) || 0;
    const filtro = esAdministrador(req) ? { id: idNum } : { id: idNum, usuario_id };

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
      if (estado === 'Preparado' && !ABASTECIMIENTO_ESTADOS_FINALES.includes(envio.abastecimiento_estado)) {
        await t.rollback();
        const mensajesBloqueo = {
          pendiente_pago: `Primero se debe pagar ${formatGsPlano(envio.abastecimiento_costo)} para iniciar el abastecimiento Gesicom.`,
          pago_rechazado: 'El comprobante de pago del abastecimiento fue rechazado. Subí uno nuevo antes de preparar el pedido.',
          en_transito_a_deposito_cliente: 'La mercadería está viajando a tu depósito. Confirmá la recepción antes de preparar el pedido.',
        };
        return res.status(400).json({
          error: mensajesBloqueo[envio.abastecimiento_estado]
            || 'El pedido todavía está en seguimiento de abastecimiento Gesicom. Esperá a que quede recibido antes de prepararlo.',
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
    // El estado de abastecimiento ya NO se pasa por acá: solo se mueve a
    // través de la máquina de estados en services/abastecimiento (ver
    // envioRoutes.js /abastecimiento/*), que valida actor + transición en
    // vez de aceptar cualquier valor que mande el cliente.
    if (courier_id !== undefined) updateData.courier_id = courier_id;
    if (proveedor_logistico_id !== undefined) updateData.proveedor_logistico_id = proveedor_logistico_id;
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
    // El método de pago real se define al marcar Entregado. Antes de eso
    // solo corresponde `pago_anticipado` para saber si cobra al recibir o ya
    // viene pago.
    const puedeEditarMetodoPago = envio.estado === 'Entregado' || estado === 'Entregado';
    if (!puedeEditarMetodoPago && (metodo_pago_id !== undefined || metodo_pago !== undefined)) {
      await t.rollback();
      return res.status(400).json({ error: 'El método de pago se define recién al marcar el pedido como Entregado.' });
    }

    // Mismo criterio que en la transición a Entregado: si el método de pago
    // cambia en una edición de un pedido ya entregado, el nombre y la comisión
    // se derivan del catálogo en vez de confiar en el formulario.
    if (puedeEditarMetodoPago && metodo_pago_id !== undefined && updateData.metodo_pago_id === undefined) {
      const metodoEditado = await MetodoPago.findByPk(metodo_pago_id, { transaction: t });
      if (!metodoEditado) {
        await t.rollback();
        return res.status(400).json({ error: `Método de pago inválido: "${metodo_pago_id}".` });
      }
      updateData.metodo_pago_id = metodo_pago_id;
      updateData.metodo_pago = metodoEditado.nombre;
      updateData.comision_pct_aplicada = Number(metodoEditado.comision_porcentaje) || 0;
    } else if (puedeEditarMetodoPago && metodo_pago !== undefined && updateData.metodo_pago === undefined) {
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
    const status = error.status || 500;
    const message = error.message || 'Error interno del servidor';
    res.status(status).json({ error: message, message, ...(error.code ? { code: error.code } : {}) });
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
exports.cotizarLogisticaAbastecimiento = async (req, res) => {
  try {
    const usuario_id = req.usuario.id;
    const { tipoLogistica, depositoId, cantidad } = req.body || {};

    if (tipoLogistica === 'GESICOMM') {
      return res.json({ costo: 0, tiempo: null, proveedor: 'Red Gesicomm', cubierto: true });
    }

    if (tipoLogistica === 'PROPIA') {
      if (!depositoId) return res.status(400).json({ error: 'Falta enviar depositoId.' });
      const deposito = await Deposito.findOne({ where: { id: depositoId, usuario_id: usuario_id, activo: true } });
      if (!deposito) {
        return res.status(400).json({ error: 'El depósito indicado no existe o está inactivo.' });
      }

      const centros = await ProveedorLogisticoService.centrosActivos();
      if (!centros || centros.length === 0) {
        return res.json({ cubierto: false, mensaje: 'Gesicomm aún no tiene centros activos.' });
      }

      const cantidadPedida = Math.max(1, Number(cantidad) || 1);
      const opciones = await TarifaDelivery.resolverOpcionesDeRed(
        { centroIds: centros.map((c) => c.id) },
        { paymentMethod: 'efectivo', items: [{ cantidad: cantidadPedida }] }
      );

      // Deposito no tiene ciudad_id/departamento_id: la resolucion de destino
      // usa coincidencia exacta por texto, igual que el resto del sistema.
      const mejor = TarifaDelivery.buscarOpcion(opciones, deposito.ciudad, deposito.departamento);

      if (!mejor) {
        return res.json({ 
          cubierto: false, 
          mensaje: 'Actualmente Gesicomm no posee cobertura logística para este depósito.' 
        });
      }

      return res.json({
        cubierto: true,
        costo: Number(mejor.costo),
        tiempo: (mejor.tiempo_entrega_min_hs && mejor.tiempo_entrega_max_hs) 
          ? `${mejor.tiempo_entrega_min_hs}–${mejor.tiempo_entrega_max_hs} h` 
          : 'A coordinar',
        proveedor: mejor.proveedor_nombre || 'Proveedor Gesicomm'
      });
    }

    return res.status(400).json({ error: 'tipoLogistica inválido.' });
  } catch (err) {
    console.error('Error al cotizar abastecimiento:', err);
    res.status(500).json({ error: 'Error al cotizar la logística de abastecimiento.' });
  }
};

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

async function envioParaAbastecimiento(req) {
  const usuario_id = req.usuario.id;
  const { id } = req.params;
  return Envio.findOne({
    where: esAdministrador(req) ? { id } : { id, usuario_id },
    include: [{ model: EnvioItem, as: 'items' }],
  });
}

async function envioAbastecimientoDecorado(envioId) {
  const result = await Envio.findByPk(envioId, {
    include: [
      { model: Courier, attributes: ['id', 'nombre', 'telefono', 'vehiculo'] },
      { model: EnvioItem, as: 'items' },
    ],
  });
  return decorarEnvio(result);
}

function manejarErrorAbastecimiento(res, error, contexto) {
  const status = error.status || 500;
  if (status >= 500) console.error(`[Abastecimiento] ${contexto}:`, error);
  return res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : error.message });
}

exports.obtenerDatosTransferenciaAbastecimiento = async (req, res) => {
  try {
    const envio = await envioParaAbastecimiento(req);
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });
    const datos = await AbastecimientoFlujo.obtenerDatosTransferencia(envio);
    return res.json(datos);
  } catch (error) {
    return manejarErrorAbastecimiento(res, error, 'Error obteniendo datos de transferencia');
  }
};

exports.subirComprobanteAbastecimientoMiddleware = subirComprobanteAbastecimientoMulter;

exports.subirComprobanteAbastecimiento = async (req, res) => {
  try {
    if (esAdministrador(req)) {
      return res.status(403).json({ error: 'Solo el comercio puede subir el comprobante de transferencia.' });
    }
    const envio = await envioParaAbastecimiento(req);
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (!req.file) return res.status(400).json({ error: 'El comprobante de transferencia es obligatorio.' });

    await AbastecimientoFlujo.subirComprobantePago({ envio, usuarioId: req.usuario.id, fileData: req.file });
    return res.json(await envioAbastecimientoDecorado(envio.id));
  } catch (error) {
    return manejarErrorAbastecimiento(res, error, 'Error subiendo comprobante');
  }
};

exports.validarPagoAbastecimiento = async (req, res) => {
  try {
    if (!esAdministrador(req)) return res.status(403).json({ error: 'Solo un administrador puede validar el pago.' });
    const envio = await envioParaAbastecimiento(req);
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });

    await AbastecimientoFlujo.validarPago({ envio, usuarioId: req.usuario.id });
    return res.json(await envioAbastecimientoDecorado(envio.id));
  } catch (error) {
    return manejarErrorAbastecimiento(res, error, 'Error validando pago');
  }
};

exports.rechazarPagoAbastecimiento = async (req, res) => {
  try {
    if (!esAdministrador(req)) return res.status(403).json({ error: 'Solo un administrador puede rechazar el pago.' });
    const envio = await envioParaAbastecimiento(req);
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });

    await AbastecimientoFlujo.rechazarPago({ envio, usuarioId: req.usuario.id, motivo: req.body?.motivo });
    return res.json(await envioAbastecimientoDecorado(envio.id));
  } catch (error) {
    return manejarErrorAbastecimiento(res, error, 'Error rechazando pago');
  }
};

exports.avanzarAbastecimiento = async (req, res) => {
  try {
    if (!esAdministrador(req)) return res.status(403).json({ error: 'Solo un administrador puede avanzar el abastecimiento.' });
    const envio = await envioParaAbastecimiento(req);
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });

    await AbastecimientoFlujo.avanzar({ envio, usuarioId: req.usuario.id });
    return res.json(await envioAbastecimientoDecorado(envio.id));
  } catch (error) {
    return manejarErrorAbastecimiento(res, error, 'Error avanzando abastecimiento');
  }
};

exports.confirmarRecepcionAbastecimiento = async (req, res) => {
  try {
    const envio = await envioParaAbastecimiento(req);
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (esAdministrador(req)) {
      return res.status(403).json({ error: 'Solo el comercio puede confirmar la recepción en su depósito.' });
    }

    await AbastecimientoFlujo.confirmarRecepcionDeposito({ envio, usuarioId: req.usuario.id });
    return res.json(await envioAbastecimientoDecorado(envio.id));
  } catch (error) {
    return manejarErrorAbastecimiento(res, error, 'Error confirmando recepción');
  }
};

exports.timelineAbastecimiento = async (req, res) => {
  try {
    const envio = await envioParaAbastecimiento(req);
    if (!envio) return res.status(404).json({ error: 'Pedido no encontrado.' });
    return res.json(await AbastecimientoFlujo.obtenerTimeline(envio.id));
  } catch (error) {
    return manejarErrorAbastecimiento(res, error, 'Error obteniendo timeline');
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

    // Cuántos de MIS pedidos ya mandé/tengo en seguimiento de abastecimiento
    // (comprobante enviado en adelante) — alimenta la pestaña "En
    // seguimiento de abastecimiento" del tablero general, visible tanto
    // para la tienda como para el admin sobre sus propios pedidos.
    try {
      conteos.abastecimiento_pagado = await Envio.count({
        where: {
          ...whereEnviosDeUsuario(req),
          abastecimiento_estado: { [Op.in]: ABASTECIMIENTO_GRUPOS.pagado },
        },
        distinct: true,
        col: 'id',
      });
    } catch (errAbastecimiento) {
      console.error('Error calculando abastecimiento_pagado en conteoPorEstado:', errAbastecimiento);
      conteos.abastecimiento_pagado = 0;
    }

    // Suma real (monto + costo de envio) de TODOS los pedidos que matchean
    // los filtros activos, sin importar la pagina ni la pestana de estado
    // seleccionada -- a diferencia del calculo anterior en el frontend, que
    // sumaba solo lo que habia cargado en memoria (10 filas en la tabla,
    // o solo el estado activo en el kanban) y por eso el 'Total visible a
    // cobrar' mostraba numeros distintos entre Tabla y Kanban.
    try {
      const totalesFila = await Envio.findOne({
        where,
        include,
        attributes: [
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('Envio.monto')), 0), 'total_monto'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('Envio.costo_envio')), 0), 'total_costo_envio'],
        ],
        raw: true,
      });
      conteos.total_visible_a_cobrar = (Number(totalesFila?.total_monto) || 0) + (Number(totalesFila?.total_costo_envio) || 0);
    } catch (errTotales) {
      console.error('Error calculando total_visible_a_cobrar en conteoPorEstado:', errTotales);
      conteos.total_visible_a_cobrar = 0;
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
    where.abastecimiento_estado = { [Op.in]: Object.values(ABASTECIMIENTO_GRUPOS).flat() };

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

    const conteos = { pendiente_pago: 0, pago_enviado: 0, en_seguimiento: 0, recibido: 0, TODOS: 0 };
    for (const fila of filas) {
      const estado = fila.abastecimiento_estado;
      const cantidad = parseInt(fila.cantidad, 10) || 0;
      const grupo = Object.entries(ABASTECIMIENTO_GRUPOS).find(([, valores]) => valores.includes(estado))?.[0];
      if (grupo) {
        conteos[grupo] += cantidad;
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

/**
 * Endpoint: GET /api/envios/gesicomm/pendientes
 * ADMIN ONLY. Pedidos con al menos un componente vendido desde stock que
 * fisicamente esta en un Centro de Fulfillment de Gesicomm (ver
 * reservarDesdeUbicacionTracked en descontarStockYSnapshot) y que todavia no se
 * despacharon — esta es la cola que faltaba: sin esto, nada le avisaba a
 * Gesicomm que tenia que preparar un pedido vendido desde su stock.
 */
/**
 * Matchea el proveedor logistico de la red de Gesicomm (proveedores_logisticos,
 * NO Courier: ese es del comercio y el admin no debe verlo ni asignarlo acá)
 * que cubre el destino del pedido, desde los centros donde realmente salió la
 * mercadería (envio_item_componentes.origen_centro_id). Reusa el mismo
 * matching por coincidencia EXACTA ciudad+departamento que ya usa
 * TarifaDeliveryService para tarifas (TarifaDelivery.buscarOpcion): si no hay
 * match exacto no se asigna nada, nunca se aproxima ni se deja a elección
 * de una lista de "parecidos".
 */
exports.sugerirProveedorLogisticoGesicomm = async (req, res) => {
  if (!esAdministrador(req)) return res.status(403).json({ error: 'Solo Admin' });

  const idNum = parseInt(req.params.id, 10) || 0;
  const envio = await Envio.findOne({
    where: { id: idNum },
    include: [{
      model: EnvioItem,
      as: 'items',
      attributes: ['id', 'cantidad'],
      include: [{
        model: EnvioItemComponente,
        as: 'componentes_vendidos',
        attributes: ['origen_centro_id'],
        required: false,
      }],
    }],
  });
  if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

  const centroIds = [...new Set(
    (envio.items || [])
      .flatMap((it) => (it.componentes_vendidos || []).map((c) => c.origen_centro_id))
      .filter(Boolean),
  )];

  const items = (envio.items || []).map((it) => ({ cantidad: it.cantidad }));
  const paymentMethod = envio.pago_anticipado ? (envio.metodo_pago || 'transferencia') : 'efectivo';

  const opciones = centroIds.length
    ? await TarifaDelivery.resolverOpcionesDeRed({ centroIds }, { paymentMethod, items })
    : [];
  const match = TarifaDelivery.buscarOpcion(opciones, envio.ciudad, envio.departamento);

  return res.json({
    match: (match && match.proveedor_id) ? { proveedor_id: match.proveedor_id, proveedor_nombre: match.proveedor_nombre, costo: match.costo } : null,
    pago_anticipado: envio.pago_anticipado,
    metodo_pago: envio.metodo_pago,
  });
};
exports.listarPedidosParaPrepararGesicomm = async (req, res) => {
  try {
    if (!esAdministrador(req)) return res.status(403).json({ error: 'Solo Admin' });

    const envios = await Envio.findAll({
      where: { estado: { [Op.in]: ['Confirmado', 'Preparado'] } },
      include: [
        { model: Usuario, attributes: ['id', 'nombre'] },
        { model: ProveedorLogistico, as: 'proveedorLogistico', attributes: ['id', 'nombre', 'telefono', 'tipo'], required: false },
        {
          model: EnvioItem,
          as: 'items',
          required: true,
          include: [
            { model: ProductoVariante, as: 'Variante', attributes: ['id', 'nombre'], required: false },
            {
              model: EnvioItemComponente,
              as: 'componentes_vendidos',
              required: true,
              where: { origen_centro_id: { [Op.ne]: null } },
              include: [
                { model: Producto, as: 'producto', attributes: ['id', 'nombre'] },
                { model: Deposito, as: 'centroOrigen', attributes: ['id', 'nombre', 'ciudad'] },
              ],
            },
          ],
        },
      ],
      order: [['created_at', 'ASC']],
    });

    return res.json(envios);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.descontarStockYSnapshot = descontarStockYSnapshot;
exports.costoParaComerciante = costoParaComerciante;
exports.esProductoCargadoPorAdmin = esProductoCargadoPorAdmin;
exports.subirComprobanteAbastecimientoMulter = subirComprobanteAbastecimientoMulter;
exports.calcularAbastecimientoDesdeItems = calcularAbastecimientoDesdeItems;

// Todo lo que estos handlers no atrapen termina en el middleware de errores
// de server.js (500 + log) en vez de tumbar el proceso. Ver src/utils/asyncHandler.js.
//
// Las dos funciones excluidas NO son handlers: las llaman otros módulos con
// su propia firma (items, transacción, usuario_id), así que el tercer
// argumento no es `next` y envolverlas se tragaría el error del llamador.
envolverControlador(module.exports, {
  excluir: ['descontarStockYSnapshot', 'calcularAbastecimientoDesdeItems', 'costoParaComerciante', 'esProductoCargadoPorAdmin', 'subirComprobanteAbastecimientoMulter'],
});
