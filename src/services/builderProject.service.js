'use strict';

/**
 * Proyectos del Page Builder: el contenedor de trabajo del usuario.
 *
 *   Proyecto "Mi Negocio"
 *     ├── páginas sueltas   → /p/<slug>
 *     └── funnels           → /f/<funnel>/<pagina>
 *
 * Un proyecto no se publica ni aparece en ninguna URL: agrupa, nada más.
 * Su `estado` es DERIVADO de lo que cuelga de él, pero se persiste para
 * poder ordenar y filtrar el listado sin una subconsulta por fila.
 * recalcularEstado() es el único lugar que lo escribe.
 *
 * ⚠️ Nada de esto depende de una Tienda. El dueño es `usuario_id` y ese
 * es el filtro de toda consulta. Ver la cabecera de builderPage.service.js.
 */

const { Op } = require('sequelize');

const { BuilderProject, BuilderFunnel, BuilderPage } = require('../models');
const BuilderPageService = require('./builderPage.service');
const BuilderFunnelService = require('./builderFunnel.service');
const { errorHttp } = require('../utils/errorHttp');

class BuilderProjectService {

  static serializar(proyecto, extra = {}) {
    return {
      id: proyecto.id,
      nombre: proyecto.nombre,
      descripcion: proyecto.descripcion,
      estado: proyecto.estado,
      usuario_id: proyecto.usuario_id,
      created_at: proyecto.created_at,
      updated_at: proyecto.updated_at,
      ...extra,
    };
  }

  static async buscarPropio(id, usuario_id) {
    const proyecto = await BuilderProject.findOne({ where: { id, usuario_id } });
    if (!proyecto) throw errorHttp('Proyecto no encontrado.', 404);
    return proyecto;
  }

  // ─── Lectura ────────────────────────────────────────────────────────

  static async listar(usuario_id, filtros = {}) {
    const { q, estado, page = 1, limit = 50 } = filtros;

    const where = { usuario_id };
    if (estado) where.estado = estado;
    if (q) where.nombre = { [Op.iLike]: `%${q}%` };

    const limite = Math.min(parseInt(limit, 10) || 50, 100);
    const pagina = Math.max(parseInt(page, 10) || 1, 1);

    const { rows, count } = await BuilderProject.findAndCountAll({
      where,
      order: [['updated_at', 'DESC']],
      limit: limite,
      offset: (pagina - 1) * limite,
    });

    // Contadores para la tarjeta del listado. Dos consultas agregadas en
    // vez de N+1: el listado por sí solo no necesita traerse las páginas.
    const ids = rows.map(p => p.id);
    const conteoPaginas = await this.contarPor(BuilderPage, ids);
    const conteoFunnels = await this.contarPor(BuilderFunnel, ids);

    return {
      total: count,
      pagina,
      total_paginas: Math.ceil(count / limite),
      proyectos: rows.map(p => this.serializar(p, {
        total_paginas_builder: conteoPaginas.get(p.id) || 0,
        total_funnels: conteoFunnels.get(p.id) || 0,
      })),
    };
  }

  /** @returns {Promise<Map<number, number>>} proyecto_id → cantidad */
  static async contarPor(modelo, proyectoIds) {
    if (!proyectoIds.length) return new Map();
    const filas = await modelo.findAll({
      attributes: [
        'proyecto_id',
        [modelo.sequelize.fn('COUNT', modelo.sequelize.col('id')), 'total'],
      ],
      where: { proyecto_id: { [Op.in]: proyectoIds } },
      group: ['proyecto_id'],
      raw: true,
    });
    return new Map(filas.map(f => [Number(f.proyecto_id), Number(f.total)]));
  }

  /** Detalle: páginas sueltas + funnels con sus páginas en orden. */
  static async obtener(id, usuario_id) {
    const proyecto = await this.buscarPropio(id, usuario_id);

    // funnel_id null = sueltas. Es un filtro explícito y no un scope del
    // modelo para que se vea en la consulta que hay dos clases de página.
    const sueltas = await BuilderPage.findAll({
      where: { proyecto_id: proyecto.id, funnel_id: null },
      order: [['nombre', 'ASC']],
    });

    const funnels = await BuilderFunnel.findAll({
      where: { proyecto_id: proyecto.id },
      order: [['created_at', 'ASC']],
    });

    const funnelsConPaginas = [];
    for (const funnel of funnels) {
      const pasos = await BuilderFunnelService.listarPasos(funnel.id);
      funnelsConPaginas.push(BuilderFunnelService.serializar(funnel, {
        paginas: pasos.map(paso => BuilderPageService.serializar(paso.pagina, {
          funnelSlug: funnel.slug,
          paso: { posicion: paso.posicion, es_entrada: paso.es_entrada },
        })),
      }));
    }

    return this.serializar(proyecto, {
      paginas: sueltas.map(p => BuilderPageService.serializar(p)),
      funnels: funnelsConPaginas,
    });
  }

  // ─── Escritura ──────────────────────────────────────────────────────

  /**
   * @param {{usuario_id: number, inquilino_id: number}} contexto del JWT
   * @param {{nombre?: string, descripcion?: string}} datos
   */
  static async crear(contexto, datos) {
    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw errorHttp('El nombre del proyecto es requerido.', 422);
    if (nombre.length > 150) throw errorHttp('El nombre no puede superar los 150 caracteres.', 422);

    const proyecto = await BuilderProject.create({
      inquilino_id: contexto.inquilino_id,
      usuario_id: contexto.usuario_id,
      nombre,
      descripcion: datos.descripcion ? String(datos.descripcion).trim() : null,
      estado: 'draft',
    });

    return this.serializar(proyecto, { paginas: [], funnels: [] });
  }

  static async actualizar(id, usuario_id, datos) {
    const proyecto = await this.buscarPropio(id, usuario_id);

    if (datos.nombre !== undefined) {
      const nombre = String(datos.nombre || '').trim();
      if (!nombre) throw errorHttp('El nombre del proyecto es requerido.', 422);
      proyecto.nombre = nombre;
    }
    if (datos.descripcion !== undefined) {
      proyecto.descripcion = datos.descripcion ? String(datos.descripcion).trim() : null;
    }

    await proyecto.save();
    return this.obtener(proyecto.id, usuario_id);
  }

  /** Cascada: se lleva funnels, páginas, versiones y pasos. La UI confirma. */
  static async eliminar(id, usuario_id) {
    const proyecto = await this.buscarPropio(id, usuario_id);
    
    // Al igual que con funnels y páginas, borrar el proyecto dispara un CASCADE
    // que borrará funnels y páginas, y eso intentará hacer SET NULL en builder_domains,
    // rompiendo el CHECK chk_builder_domains_target.
    // Borramos los dominios a mano primero.
    const { BuilderDomain, BuilderFunnel, BuilderPage } = require('../models');
    
    const funnels = await BuilderFunnel.findAll({ where: { proyecto_id: proyecto.id }, attributes: ['id'] });
    const paginas = await BuilderPage.findAll({ where: { proyecto_id: proyecto.id }, attributes: ['id'] });
    
    if (funnels.length) {
      await BuilderDomain.destroy({ where: { funnel_id: funnels.map(f => f.id) } });
    }
    if (paginas.length) {
      await BuilderDomain.destroy({ where: { pagina_id: paginas.map(p => p.id) } });
    }

    await proyecto.destroy();
    return true;
  }

  // ─── Páginas y funnels del proyecto ─────────────────────────────────

  /** Crea una página SUELTA (funnel_id null → /p/<slug>). */
  static async crearPagina(id, usuario_id, datos) {
    const proyecto = await this.buscarPropio(id, usuario_id);

    const pagina = await BuilderPageService.crear({
      proyecto_id: proyecto.id,
      usuario_id: proyecto.usuario_id,
      inquilino_id: proyecto.inquilino_id,
      funnel_id: null,
    }, datos);

    return BuilderPageService.serializar(pagina);
  }

  static async crearFunnel(id, usuario_id, datos) {
    const proyecto = await this.buscarPropio(id, usuario_id);

    return BuilderFunnelService.crear({
      proyecto_id: proyecto.id,
      usuario_id: proyecto.usuario_id,
      inquilino_id: proyecto.inquilino_id,
    }, datos);
  }

  // ─── Estado derivado ────────────────────────────────────────────────

  /**
   * Recalcula el estado del proyecto a partir de sus páginas:
   *
   *   published    ≥1 página con published_version_id
   *   unpublished  ninguna publicada, pero alguna se publicó antes
   *   draft        ninguna se publicó nunca
   *
   * Lo llama builderPublish.service.js (FASE 3) después de publicar o
   * despublicar. En la FASE 2 todavía no hay nada publicado, así que
   * siempre devuelve 'draft' — pero la función ya está para que publicar
   * no tenga que inventar esta lógica.
   */
  static async recalcularEstado(proyecto_id, transaction = null) {
    const proyecto = await BuilderProject.findByPk(proyecto_id, { transaction });
    if (!proyecto) return null;

    const publicadas = await BuilderPage.count({
      where: { proyecto_id, published_version_id: { [Op.ne]: null } },
      transaction,
    });
    const publicadasAlgunaVez = await BuilderPage.count({
      where: { proyecto_id, published_at: { [Op.ne]: null } },
      transaction,
    });

    let estado = 'draft';
    if (publicadas > 0) estado = 'published';
    else if (publicadasAlgunaVez > 0) estado = 'unpublished';

    if (proyecto.estado !== estado) {
      proyecto.estado = estado;
      await proyecto.save({ transaction });
    }
    return estado;
  }
}

module.exports = BuilderProjectService;
