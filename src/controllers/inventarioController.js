'use strict';

const { IngresoInventarioService, ESTADOS } = require('../services/ingresoInventario.service');
const ProveedorLogisticoService = require('../services/proveedorLogistico.service');
const { Op } = require('sequelize');
const { IngresoInventario, IngresoInventarioItem, InventarioUbicacion, Deposito, Producto, ProductoVariante, HistorialIngresoInventario, Usuario } = require('../models');
const { idsDeAdministradores } = require('../services/notificaciones/pedidosNotificaciones.service');

// Función de ayuda para validar rol de admin
const esAdmin = (req) => {
  const r = req.usuario?.rol;
  const nombre = typeof r === 'object' ? r?.nombre : r;
  return nombre === 'administrador' || nombre === 'Admin' || nombre === 'SuperAdmin';
};

const claveStock = ({ usuario_id, deposito_id, producto_id, variante_id }) => (
  `${usuario_id}:${deposito_id}:${producto_id}:${variante_id || 'SIN_VARIANTE'}`
);

/**
 * Endpoint: GET /api/inventario/centros-destino
 * Centros de Fulfillment de Gesicomm activos, para elegir destino de un
 * ingreso. GET /api/depositos no sirve para esto: esta scopeado siempre a
 * usuario_id (ver depositoController.listar), y los centros Gesicomm son
 * del admin, no del comercio que envia el ingreso.
 */
exports.listarCentrosDestino = async (req, res) => {
  try {
    const centros = await ProveedorLogisticoService.centrosActivos();
    return res.json(centros.map((c) => ({ id: c.id, nombre: c.nombre, ciudad: c.ciudad, departamento: c.departamento })));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/ingresos/listado
 * Lista los inbounds (ingresos) del comercio.
 */
/**
 * Endpoint: POST /api/inventario/ingresos/listado
 * Lista los inbounds (ingresos) del comercio, paginado y con filtros
 * dinamicos (misma convencion que ProductoService.buscar: page/limit,
 * respuesta { total, pagina, total_paginas, ingresos }).
 */
exports.listarIngresos = async (req, res) => {
  try {
    const { estado, texto, page = 1, limit = 20 } = req.body;
    const whereClause = {};

    if (!esAdmin(req)) {
      whereClause.usuario_id = req.usuario.id;
    }

    if (estado) {
      whereClause.estado = estado;
    }

    // Busqueda por texto: numero de ingreso (ING-0012 o 12) o nombre del
    // centro. El nombre de centro se resuelve antes por separado: mezclar
    // un where anidado ($centro.nombre$) con paginacion sobre un hasMany
    // (items) rompe el conteo de Sequelize, asi que se resuelve en dos pasos.
    if (texto) {
      const soloNumeros = texto.replace(/\D/g, '');
      const centrosCoincidentes = await Deposito.findAll({
        where: { nombre: { [Op.iLike]: `%${texto}%` } },
        attributes: ['id'],
      });
      const condiciones = [];
      if (soloNumeros) condiciones.push({ id: Number(soloNumeros) });
      if (centrosCoincidentes.length) condiciones.push({ centro_gesicomm_id: { [Op.in]: centrosCoincidentes.map((c) => c.id) } });
      whereClause[Op.or] = condiciones.length ? condiciones : [{ id: -1 }];
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { rows: ingresos, count } = await IngresoInventario.findAndCountAll({
      where: whereClause,
      include: [
        { model: Deposito, as: 'centro', attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'] },
        { model: Usuario, attributes: ['id', 'nombre', 'correo_electronico'] },
        { 
          model: IngresoInventarioItem, 
          as: 'items',
          include: [
            { model: Producto, attributes: ['id', 'nombre', 'sku'] },
            { model: ProductoVariante, attributes: ['id', 'nombre', 'sku_variante'] }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: Number(limit),
      offset,
      distinct: true,
    });

    const ingresosJson = ingresos.map((ingreso) => ingreso.toJSON());
    const condicionesStock = [];
    ingresosJson.forEach((ingreso) => {
      (ingreso.items || []).forEach((item) => {
        condicionesStock.push({
          usuario_id: ingreso.usuario_id,
          deposito_id: ingreso.centro_gesicomm_id,
          producto_id: item.producto_id,
          variante_id: item.variante_id || null,
        });
      });
    });

    const stocks = condicionesStock.length
      ? await InventarioUbicacion.findAll({
        where: { [Op.or]: condicionesStock },
        attributes: ['usuario_id', 'deposito_id', 'producto_id', 'variante_id', 'cantidad_disponible', 'cantidad_reservada'],
      })
      : [];

    const stockPorClave = new Map(stocks.map((stock) => [claveStock(stock), stock]));
    const ingresosConStock = ingresosJson.map((ingreso) => {
      const items = (ingreso.items || []).map((item) => {
        const stock = stockPorClave.get(claveStock({
          usuario_id: ingreso.usuario_id,
          deposito_id: ingreso.centro_gesicomm_id,
          producto_id: item.producto_id,
          variante_id: item.variante_id,
        }));
        return {
          ...item,
          stock_actual_disponible: stock?.cantidad_disponible || 0,
          stock_actual_reservado: stock?.cantidad_reservada || 0,
        };
      });
      return {
        ...ingreso,
        items,
        stock_actual_disponible: items.reduce((acc, item) => acc + item.stock_actual_disponible, 0),
        stock_actual_reservado: items.reduce((acc, item) => acc + item.stock_actual_reservado, 0),
      };
    });

    return res.json({
      total: count,
      pagina: Number(page),
      total_paginas: Math.ceil(count / Number(limit)),
      ingresos: ingresosConStock,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Error al listar ingresos' });
  }
};

/**
 * Endpoint: GET /api/inventario/ingresos/:id
 */
exports.obtenerIngreso = async (req, res) => {
  try {
    const { id } = req.params;
    const ingreso = await IngresoInventario.findByPk(id, {
      include: [
        { model: Deposito, as: 'centro', attributes: ['id', 'nombre', 'ciudad', 'direccion', 'persona_contacto', 'telefono_contacto'] },
        { model: Usuario, attributes: ['id', 'nombre', 'correo_electronico'] },
        { 
          model: IngresoInventarioItem, 
          as: 'items',
          include: [
            { model: Producto, attributes: ['id', 'nombre', 'sku'] },
            { model: ProductoVariante, attributes: ['id', 'nombre', 'sku_variante'] }
          ]
        },
        {
          model: HistorialIngresoInventario,
          as: 'historial',
          include: [{ model: Usuario, attributes: ['id', 'nombre'] }],
        }
      ],
      // El `order` de una subcoleccion NO se puede declarar dentro de su
      // propio include (Sequelize lo ignora en silencio): hay que listarla
      // aca, calificada con el alias, para que el historial salga
      // realmente en orden cronologico y no en el orden fisico de la tabla.
      order: [[{ model: HistorialIngresoInventario, as: 'historial' }, 'createdAt', 'ASC']],
    });

    if (!ingreso) return res.status(404).json({ error: 'Ingreso no encontrado' });
    if (!esAdmin(req) && ingreso.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    return res.json(ingreso);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/ingresos
 * Crea un borrador.
 */
exports.crearBorrador = async (req, res) => {
  try {
    const { centro_gesicomm_id, items } = req.body;
    if (!centro_gesicomm_id || !items || !items.length) {
      return res.status(400).json({ error: 'Faltan datos obligatorios (centro y productos).' });
    }

    const ingreso = await IngresoInventarioService.crearBorrador(req.usuario.id, centro_gesicomm_id, items);
    return res.status(201).json(ingreso);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/ingresos/:id/confirmar-envio
 */
exports.confirmarEnvio = async (req, res) => {
  try {
    const { id } = req.params;
    const ingreso = await IngresoInventarioService.confirmarEnvio(id, req.usuario.id);
    return res.json(ingreso);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/ingresos/:id/marcar-en-transito
 */
exports.marcarEnTransito = async (req, res) => {
  try {
    const { id } = req.params;
    const { transportista, numero_seguimiento, observacion } = req.body;
    const ingreso = await IngresoInventarioService.marcarEnTransito(id, req.usuario.id, { transportista, numero_seguimiento, observacion }, esAdmin(req));
    return res.json(ingreso);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/ingresos/:id/recepcion
 * ADMIN ONLY
 */
exports.registrarRecepcion = async (req, res) => {
  try {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo Admin' });
    const { id } = req.params;
    const ingreso = await IngresoInventarioService.recepcionFisica(id, req.usuario.id);
    return res.json(ingreso);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/ingresos/:id/resolver-diferencias
 * ADMIN ONLY
 */
exports.resolverDiferencias = async (req, res) => {
  try {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo Admin' });
    const { id } = req.params;
    const { conteos } = req.body; // [{ item_id, cantidad_recibida, cantidad_aceptada, observacion }]
    if (!conteos || !Array.isArray(conteos)) return res.status(400).json({ error: 'Conteos inválidos' });
    
    const ingreso = await IngresoInventarioService.resolverDiferencias(id, req.usuario.id, conteos);
    return res.json(ingreso);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/ingresos/:id/habilitar-stock
 * ADMIN ONLY
 */
exports.habilitarStock = async (req, res) => {
  try {
    if (!esAdmin(req)) return res.status(403).json({ error: 'Solo Admin' });
    const { id } = req.params;
    const ingreso = await IngresoInventarioService.habilitarStock(id, req.usuario.id);
    return res.json(ingreso);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};

/**
 * Endpoint: POST /api/inventario/stock/listado
 * Muestra las existencias físicas en ubicaciones.
 */
/**
 * Endpoint: POST /api/inventario/stock/listado
 * "Mi inventario": el stock unificado del comercio en cualquier ubicacion
 * (deposito propio o centro Gesicomm), sin importar por que camino llego
 * ahi (ingreso propio, abastecimiento). Paginado + filtros dinamicos, misma
 * convencion que ProductoService.buscar (page/limit, respuesta
 * { total, pagina, total_paginas, filas, kpis }).
 *
 * origen: 'PROPIO' (producto creado por el comercio) vs 'GESICOMM'
 * (creado_por null o por un administrador) — es el mismo criterio que ya
 * usa envioController.esProductoCargadoPorAdmin para el resto del sistema.
 * ubicacion: 'PROPIA' vs 'GESICOMM' segun Deposito.alcance.
 */
exports.listarStockUbicacion = async (req, res) => {
  try {
    const {
      texto, origen, ubicacion, page = 1, limit = 20,
    } = req.body;

    const whereClause = {};
    if (!esAdmin(req)) {
      whereClause.usuario_id = req.usuario.id;
    }
    if (ubicacion === 'PROPIA' || ubicacion === 'GESICOMM') {
      whereClause['$Deposito.alcance$'] = ubicacion;
    }

    // Un solo fetch de admins: lo usa tanto el filtro de origen (si vino)
    // como el calculo del campo origen por fila mas abajo. Antes se
    // resolvia dos veces con criterios distintos y cuando el filtro venia
    // activo el campo por fila quedaba mal (bug real, visto en pruebas: filtrar
    // por PROPIO devolvia filas marcadas como GESICOMM).
    const adminIds = await idsDeAdministradores();

    const productoWhere = {};
    if (texto) productoWhere.nombre = { [Op.iLike]: `%${texto}%` };
    if (origen === 'PROPIO' || origen === 'GESICOMM') {
      productoWhere.creado_por = origen === 'GESICOMM'
        ? { [Op.or]: [{ [Op.is]: null }, { [Op.in]: adminIds }] }
        : { [Op.and]: [{ [Op.ne]: null }, { [Op.notIn]: adminIds.length ? adminIds : [-1] }] };
    }

    const include = [
      { model: Producto, attributes: ['id', 'nombre', 'sku', 'creado_por'], where: Object.keys(productoWhere).length ? productoWhere : undefined, required: true },
      { model: ProductoVariante, attributes: ['id', 'nombre', 'sku_variante'] },
      { model: Deposito, attributes: ['id', 'nombre', 'alcance', 'ciudad'], required: true },
    ];

    const offset = (Number(page) - 1) * Number(limit);
    const { rows, count } = await InventarioUbicacion.findAndCountAll({
      where: whereClause,
      include,
      order: [[{ model: Producto }, 'nombre', 'ASC']],
      limit: Number(limit),
      offset,
      subQuery: false,
    });

    const esGesicomm = (prod) => (prod.creado_por == null) || adminIds.includes(prod.creado_por);

    const filas = rows.map((r) => ({
      id: r.id,
      Producto: r.Producto,
      ProductoVariante: r.ProductoVariante,
      Deposito: r.Deposito,
      cantidad_disponible: r.cantidad_disponible,
      cantidad_reservada: r.cantidad_reservada,
      origen: r.Producto ? (esGesicomm(r.Producto) ? 'GESICOMM' : 'PROPIO') : null,
    }));

    // KPIs sobre el TOTAL filtrado, no solo la pagina visible.
    const todasLasFilas = await InventarioUbicacion.findAll({
      where: whereClause,
      include: [
        { model: Producto, attributes: ['id'], where: Object.keys(productoWhere).length ? productoWhere : undefined, required: true },
        { model: Deposito, attributes: ['id'], required: true },
      ],
      attributes: ['cantidad_disponible', 'cantidad_reservada', 'deposito_id'],
    });
    const kpis = {
      total_unidades: todasLasFilas.reduce((acc, r) => acc + r.cantidad_disponible + r.cantidad_reservada, 0),
      disponibles: todasLasFilas.reduce((acc, r) => acc + r.cantidad_disponible, 0),
      reservadas: todasLasFilas.reduce((acc, r) => acc + r.cantidad_reservada, 0),
      ubicaciones: new Set(todasLasFilas.map((r) => r.deposito_id)).size,
    };

    return res.json({
      total: count,
      pagina: Number(page),
      total_paginas: Math.ceil(count / Number(limit)),
      filas,
      kpis,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
