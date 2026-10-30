'use strict';

/**
 * Cola de revisión del catálogo que suben los proveedores por API.
 *
 * Un proveedor aceptado puede empujar sus productos (ver
 * docs/api-integraciones-productos.md), pero nada se publica solo: cada
 * producto entra `estado_revision = 'pendiente'` y `activo = false`, y
 * recién cuando un administrador lo aprueba pasa a verse en Mi catálogo y
 * a poder usarse en landings y páginas de venta. Es el control de qué se
 * vende en Gesicom — no cualquiera puede ofrecer cualquier cosa.
 *
 * Es la misma idea que la revisión de las postulaciones
 * (solicitudProveedor.service.js), un escalón más abajo: allá se decide
 * quién entra, acá qué trae.
 */

const { Op } = require('sequelize');
const { sequelize, Producto, ProductoImagen, Proveedor, Categoria } = require('../models');

const ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
const fallo = (status, message) => Object.assign(new Error(message), { status });

/**
 * Lo que el administrador necesita para decidir sin salir de la pantalla:
 * qué es, de quién, a cuánto y con qué fotos. El precio va en guaraníes
 * enteros, como todo en Gesicom.
 */
function presentar(producto, imagenes) {
  return {
    id: producto.id,
    nombre: producto.nombre,
    sku: producto.sku,
    descripcion: producto.descripcion_corta || producto.propuesta_valor || null,
    categoria: producto.categoria?.nombre || null,
    precio: producto.precio_base != null ? Math.round(Number(producto.precio_base)) : null,
    stock: producto.cantidad_disponible,
    estado: producto.estado_revision,
    nota_revision: producto.revision_nota,
    revisado_en: producto.revisado_en,
    recibido_en: producto.created_at,
    imagenes: (imagenes.get(producto.id) || []).slice(0, 6),
    proveedor: producto.proveedor
      ? { id: producto.proveedor.id, nombre: producto.proveedor.nombre, logo_url: producto.proveedor.logo_url || null }
      : null,
  };
}

class RevisionCatalogoProveedorService {
  /**
   * Los productos esperando decisión, del más nuevo al más viejo. Solo
   * mira productos que tienen proveedor: lo que carga un comercio o el
   * administrador desde el panel no pasa por esta cola.
   */
  static async listar({ estado = 'pendiente', proveedorId = null, page = 1, limit = 20 } = {}) {
    if (!ESTADOS.includes(estado)) throw fallo(400, 'Estado de revisión inválido.');
    const where = { estado_revision: estado, proveedor_id: proveedorId ? proveedorId : { [Op.ne]: null } };

    const [listado, ...conteos] = await Promise.all([
      Producto.findAndCountAll({
        where,
        include: [
          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre', 'logo_url'] },
          { model: Categoria, as: 'categoria', attributes: ['id', 'nombre'], required: false },
        ],
        order: [['created_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset: (page - 1) * limit,
      }),
      ...ESTADOS.map(revision => Producto.count({ where: { estado_revision: revision, proveedor_id: { [Op.ne]: null } } })),
    ]);

    const ids = listado.rows.map(p => p.id);
    const imagenes = new Map();
    if (ids.length) {
      const filas = await ProductoImagen.findAll({
        where: { producto_id: { [Op.in]: ids } },
        attributes: ['producto_id', 'url'],
        order: [['es_principal', 'DESC'], ['orden', 'ASC'], ['id', 'ASC']],
      });
      filas.forEach(f => imagenes.set(f.producto_id, [...(imagenes.get(f.producto_id) || []), f.url]));
    }

    return {
      productos: listado.rows.map(p => presentar(p, imagenes)),
      total: listado.count,
      pagina: page,
      total_paginas: Math.ceil(listado.count / limit) || 0,
      resumen: Object.fromEntries(ESTADOS.map((revision, i) => [revision, conteos[i]])),
    };
  }

  /** Los proveedores que hoy tienen algo esperando, para el filtro de la pantalla. */
  static async proveedoresConPendientes() {
    const filas = await Producto.findAll({
      where: { estado_revision: 'pendiente', proveedor_id: { [Op.ne]: null } },
      include: [{ model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre', 'logo_url'] }],
      attributes: ['proveedor_id', [sequelize.fn('COUNT', sequelize.col('Producto.id')), 'total']],
      group: ['Producto.proveedor_id', 'proveedor.id'],
      order: [[sequelize.literal('total'), 'DESC']],
      raw: false,
    });
    return filas.map(f => ({
      id: f.proveedor?.id,
      nombre: f.proveedor?.nombre,
      logo_url: f.proveedor?.logo_url || null,
      pendientes: Number(f.get('total')),
    })).filter(p => p.id);
  }

  /**
   * Aprobar publica el producto (queda como cualquier otro del catálogo
   * global); rechazar lo deja inactivo con el motivo, que es lo que
   * después se le explica al proveedor. Un rechazo siempre lleva motivo.
   */
  static async revisar(ids, { estado, nota }, adminId) {
    if (!['aprobado', 'rechazado'].includes(estado)) throw fallo(400, 'La decisión tiene que ser "aprobado" o "rechazado".');
    const motivo = String(nota || '').trim();
    if (estado === 'rechazado' && motivo.length < 3) throw fallo(400, 'Indicá el motivo del rechazo.');

    const lista = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isSafeInteger))];
    if (!lista.length) throw fallo(400, 'Elegí al menos un producto.');

    return sequelize.transaction(async transaction => {
      const productos = await Producto.findAll({
        where: { id: { [Op.in]: lista }, proveedor_id: { [Op.ne]: null } },
        transaction,
      });
      if (!productos.length) throw fallo(404, 'No encontramos esos productos de proveedor.');

      for (const producto of productos) {
        await producto.update({
          estado_revision: estado,
          revision_nota: estado === 'rechazado' ? motivo : (motivo || null),
          revisado_por: adminId,
          revisado_en: new Date(),
          // Aprobar es lo único que lo publica. El estado de venta sale del
          // stock que mandó el proveedor, igual que en un alta normal.
          activo: estado === 'aprobado',
          estado_venta: estado === 'aprobado'
            ? (producto.cantidad_disponible > 0 ? 'en_venta' : 'fuera_de_stock')
            : 'no_disponible',
        }, { transaction });
      }

      return { revisados: productos.length, estado };
    });
  }
}

module.exports = RevisionCatalogoProveedorService;
