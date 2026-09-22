'use strict';

const { IngresoInventarioService, ESTADOS } = require('../services/ingresoInventario.service');
const { IngresoInventario, IngresoInventarioItem, InventarioUbicacion, Deposito, Producto, ProductoVariante, HistorialIngresoInventario } = require('../models');

// Función de ayuda para validar rol de admin
const esAdmin = (req) => {
  const r = req.usuario?.rol;
  const nombre = typeof r === 'object' ? r?.nombre : r;
  return nombre === 'administrador' || nombre === 'Admin' || nombre === 'SuperAdmin';
};

/**
 * Endpoint: POST /api/inventario/ingresos/listado
 * Lista los inbounds (ingresos) del comercio.
 */
exports.listarIngresos = async (req, res) => {
  try {
    const { estado } = req.body;
    const whereClause = {};

    if (!esAdmin(req)) {
      whereClause.usuario_id = req.usuario.id;
    }

    if (estado) {
      whereClause.estado = estado;
    }

    const ingresos = await IngresoInventario.findAll({
      where: whereClause,
      include: [
        { model: Deposito, as: 'centro', attributes: ['id', 'nombre', 'ciudad'] },
        { 
          model: IngresoInventarioItem, 
          as: 'items',
          include: [
            { model: Producto, attributes: ['id', 'nombre', 'sku'] },
            { model: ProductoVariante, attributes: ['id', 'nombre', 'sku_variante'] }
          ]
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return res.json(ingresos);
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
        { model: Deposito, as: 'centro', attributes: ['id', 'nombre', 'ciudad'] },
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
          order: [['createdAt', 'ASC']]
        }
      ]
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
    const ingreso = await IngresoInventarioService.marcarEnTransito(id, req.usuario.id, { transportista, numero_seguimiento, observacion });
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
exports.listarStockUbicacion = async (req, res) => {
  try {
    const whereClause = {};
    if (!esAdmin(req)) {
      whereClause.usuario_id = req.usuario.id;
    }

    const stock = await InventarioUbicacion.findAll({
      where: whereClause,
      include: [
        { model: Producto, attributes: ['id', 'nombre', 'sku'] },
        { model: ProductoVariante, attributes: ['id', 'nombre', 'sku_variante'] },
        { model: Deposito, attributes: ['id', 'nombre', 'alcance', 'ciudad'] }
      ]
    });

    return res.json(stock);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
