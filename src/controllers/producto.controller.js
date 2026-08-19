/**
 * Controller de Productos.
 *
 * POST /api/productos/buscar    → Listar con filtros dinámicos (sin Eager Loading masivo)
 * POST /api/productos           → Crear producto
 * GET  /api/productos/:id       → Detalle del producto (sin variantes ni imágenes)
 * GET  /api/productos/:id/variantes → Obtener variantes
 * GET  /api/productos/:id/imagenes  → Obtener imágenes
 * GET  /api/productos/:id/faq       → Obtener preguntas frecuentes
 * GET  /api/productos/:id/historial-precios → Historial
 * PUT  /api/productos/:id       → Actualizar
 * DELETE /api/productos/:id     → Soft-delete
 */
const { sequelize, HistorialPrecio, Producto } = require('../models');
const { rollbackSeguro } = require('../utils/transaction');
const ProductoService = require('../services/producto.service');
const ProductoVarianteService = require('../services/productoVariante.service');
const ImagenService = require('../services/imagen.service');

async function buscar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const esAdmin = req.usuario.rol === 'administrador';
    
    if (req.body.mios_solamente && !esAdmin) {
      req.body.creado_por = req.usuario.id;
    }
    
    const resultado = await ProductoService.buscar(req.body, inquilino_id, esAdmin, req.usuario.id);
    return res.json(resultado);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al buscar productos.' });
  }
}

async function crear(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    const usuario_id = req.usuario.id;
    const esAdmin = req.usuario.rol === 'administrador';
    const { variantes = [], relacionados = [] } = req.body;

    const producto = await ProductoService.crear(req.body, inquilino_id, usuario_id, esAdmin, t);

    if (variantes.length > 0) {
      await ProductoVarianteService.crearMultiples(producto.id, inquilino_id, variantes, t);
      await ProductoService.recalcularStockPadre(producto.id, t);
    }

    if (relacionados.length > 0) {
      // Por simplicidad, se mantiene aquí, pero podría ir a un RelacionadosService
      const { ProductoRelacionado } = require('../models');
      await ProductoRelacionado.bulkCreate(
        relacionados.map(r => ({ inquilino_id, producto_id: producto.id, producto_relacionado_id: r })),
        { transaction: t, ignoreDuplicates: true }
      );
    }

    await t.commit();
    return res.status(201).json(producto);
  } catch (err) {
    await rollbackSeguro(t);
    console.error('[crear producto]', err);
    if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
      const mensajes = err.errors?.map(e => e.message) || [err.message];
      return res.status(422).json({ message: 'Error de validación.', errores: mensajes });
    }
    return res.status(err.message.includes('Validación') ? 422 : 400).json({ 
      message: err.message || 'Error al crear producto.', 
      errores: err.errores 
    });
  }
}

async function detalle(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const esAdmin = req.usuario.rol === 'administrador';
    const producto = await ProductoService.detalle(req.params.id, inquilino_id, esAdmin, req.usuario.id);
    return res.json(producto);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al obtener producto.' });
  }
}

/**
 * Simulador de precio (tab Precios/Ofertas del admin) — ver
 * ProductoService.simularPrecio: llama al mismo PricingService que el
 * checkout público, nunca una segunda implementación del cálculo.
 */
async function simularPrecio(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const { cantidad, variante_id, oferta_id } = req.body || {};
    const resultado = await ProductoService.simularPrecio(req.params.id, inquilino_id, { cantidad, variante_id, oferta_id });
    return res.json(resultado);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 400;
    return res.status(status).json({ message: err.message || 'Error al simular el precio.' });
  }
}

async function variantes(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const vars = await ProductoVarianteService.listarPorProducto(req.params.id, inquilino_id);
    return res.json(vars);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener variantes.' });
  }
}

async function imagenes(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const imgs = await ImagenService.listarPorProducto(req.params.id, inquilino_id);
    return res.json(imgs);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener imágenes.' });
  }
}

async function faq(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const preguntas = await ProductoService.listarFaq(req.params.id, inquilino_id);
    return res.json(preguntas);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al obtener las preguntas frecuentes.' });
  }
}

async function relacionados(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const datos = await ProductoService.listarRelacionados(req.params.id, inquilino_id);
    return res.json(datos);
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al obtener los productos relacionados.' });
  }
}

async function historialPrecios(req, res) {
  try {
    const { id } = req.params;
    const inquilino_id = req.usuario.tenantId;

    const producto = await Producto.findOne({ where: { id, inquilino_id }, attributes: ['id'] });
    if (!producto) return res.status(404).json({ message: 'Producto no encontrado.' });

    const historial = await HistorialPrecio.findAll({
      where: { producto_id: id },
      order: [['fecha_cambio', 'DESC']],
      limit: 20,
    });

    return res.json(historial);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error al obtener el historial de precios.' });
  }
}

async function actualizar(req, res) {
  const t = await sequelize.transaction();
  try {
    const inquilino_id = req.usuario.tenantId;
    const usuario_id = req.usuario.id;
    const esAdmin = req.usuario.rol === 'administrador';
    
    const producto = await ProductoService.actualizar(req.params.id, req.body, inquilino_id, usuario_id, esAdmin, t);

    if (req.body.variantes !== undefined) {
      await ProductoVarianteService.sincronizar(req.params.id, inquilino_id, req.body.variantes, t);
      await ProductoService.recalcularStockPadre(req.params.id, t);
    }

    if (req.body.faq !== undefined) {
      await ProductoService.sincronizarFaq(req.params.id, inquilino_id, req.body.faq, t);
    }

    if (req.body.relacionados !== undefined) {
      await ProductoService.sincronizarRelacionados(req.params.id, inquilino_id, req.body.relacionados, t);
    }

    await t.commit();
    return res.json(producto);
  } catch (err) {
    await rollbackSeguro(t);
    console.error(err);
    return res.status(err.message.includes('Validación') ? 422 : (err.message.includes('no encontrado') ? 404 : 500)).json({ 
      message: err.message || 'Error al actualizar producto.',
      errores: err.errores 
    });
  }
}

async function eliminar(req, res) {
  try {
    const inquilino_id = req.usuario.tenantId;
    const esAdmin = req.usuario.rol === 'administrador';
    await ProductoService.eliminar(req.params.id, inquilino_id, req.usuario.id, esAdmin);
    return res.json({ message: 'Producto dado de baja correctamente.' });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('no encontrado') ? 404 : 500;
    return res.status(status).json({ message: err.message || 'Error al dar de baja el producto.' });
  }
}

module.exports = {
  buscar,
  crear,
  detalle,
  simularPrecio,
  variantes,
  imagenes,
  faq,
  relacionados,
  historialPrecios,
  actualizar,
  eliminar
};
