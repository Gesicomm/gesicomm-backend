'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  ProveedorLogistico,
  CentroProveedorLogistico,
  Deposito,
  DeliveryZonaTarifa,
  Ciudad,
  Departamento,
} = require('../models');

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/**
 * Proveedores logísticos de la red de Gesicomm.
 *
 * Todo lo que hay acá es infraestructura de la plataforma, no de un comercio:
 * no hay `usuario_id` en ningún lado y el que administra es siempre un
 * administrador. Las tarifas que se escriben van con `usuario_id = NULL` y
 * `courier_id = NULL`, que es lo que las mantiene fuera del checkout de
 * cualquier comercio — incluido el del admin que las creó.
 */
class ProveedorLogisticoService {
  /** Capacidades sin repetidos: el CHECK de Postgres es de subconjunto y los acepta. */
  static normalizarCapacidades(valor) {
    const lista = Array.isArray(valor) ? valor : [];
    const limpias = lista
      .map((c) => String(c || '').trim().toUpperCase())
      .filter(Boolean);
    const desconocida = limpias.find((c) => !ProveedorLogistico.CAPACIDADES.includes(c));
    if (desconocida) throw errorHttp(`Capacidad desconocida: "${desconocida}".`);
    return [...new Set(limpias)];
  }

  static normalizarTipo(valor) {
    const tipo = String(valor || 'TRANSPORTADORA').trim().toUpperCase();
    if (!ProveedorLogistico.TIPOS.includes(tipo)) {
      throw errorHttp(`Tipo de proveedor inválido: "${tipo}".`);
    }
    return tipo;
  }

  static async listar({ soloActivos = false } = {}) {
    return ProveedorLogistico.findAll({
      where: soloActivos ? { activo: true } : undefined,
      order: [['nombre', 'ASC']],
    });
  }

  static async porId(id) {
    const proveedor = await ProveedorLogistico.findByPk(id);
    if (!proveedor) throw errorHttp('Proveedor logístico no encontrado.', 404);
    return proveedor;
  }

  static async crear(datos = {}) {
    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw errorHttp('El proveedor necesita un nombre.');

    return ProveedorLogistico.create({
      nombre,
      tipo: this.normalizarTipo(datos.tipo),
      contacto: datos.contacto ? String(datos.contacto).trim() : null,
      telefono: datos.telefono ? String(datos.telefono).trim() : null,
      email: datos.email ? String(datos.email).trim() : null,
      capacidades: this.normalizarCapacidades(datos.capacidades),
      activo: datos.activo !== false,
    });
  }

  static async actualizar(id, datos = {}) {
    const proveedor = await this.porId(id);
    const cambios = {};

    if (datos.nombre !== undefined) {
      const nombre = String(datos.nombre).trim();
      if (!nombre) throw errorHttp('El proveedor necesita un nombre.');
      cambios.nombre = nombre;
    }
    if (datos.tipo !== undefined) cambios.tipo = this.normalizarTipo(datos.tipo);
    if (datos.capacidades !== undefined) cambios.capacidades = this.normalizarCapacidades(datos.capacidades);
    if (datos.contacto !== undefined) cambios.contacto = datos.contacto ? String(datos.contacto).trim() : null;
    if (datos.telefono !== undefined) cambios.telefono = datos.telefono ? String(datos.telefono).trim() : null;
    if (datos.email !== undefined) cambios.email = datos.email ? String(datos.email).trim() : null;
    if (datos.activo !== undefined) cambios.activo = Boolean(datos.activo);

    await proveedor.update(cambios);
    return proveedor;
  }

  /**
   * Cuántas reglas de cobertura tiene un proveedor, en total y por centro.
   *
   * Se usa antes de borrar: eliminarlo se lleva sus tarifas por cascada, y
   * eso tiene que decirse con un número antes, no descubrirse después.
   */
  static async reglasDe(proveedorId) {
    const filas = await DeliveryZonaTarifa.findAll({
      where: { proveedor_logistico_id: proveedorId },
      attributes: ['centro_id'],
      raw: true,
    });
    return { total: filas.length, centros: new Set(filas.map((f) => f.centro_id)).size };
  }

  /**
   * Elimina un proveedor.
   *
   * Sin `forzar` se niega cuando tiene cobertura cargada: borrarlo arrastra
   * sus tarifas por cascada, y quien aprieta el botón tiene que saber cuántas
   * antes de perderlas. Para sacarlo de circulación sin perder nada está
   * `actualizar(id, { activo: false })`.
   */
  static async eliminar(id, { forzar = false } = {}) {
    const proveedor = await this.porId(id);
    const reglas = await this.reglasDe(proveedor.id);

    if (reglas.total > 0 && !forzar) {
      throw Object.assign(
        new Error(`"${proveedor.nombre}" tiene ${reglas.total} tarifa(s) cargada(s) en ${reglas.centros} centro(s).`),
        { status: 409, reglas },
      );
    }

    await sequelize.transaction(async (t) => {
      await DeliveryZonaTarifa.destroy({ where: { proveedor_logistico_id: proveedor.id }, transaction: t });
      await CentroProveedorLogistico.destroy({ where: { proveedor_logistico_id: proveedor.id }, transaction: t });
      await proveedor.destroy({ transaction: t });
    });

    return { eliminado: true, reglas_borradas: reglas.total };
  }

  /**
   * El centro tiene que ser un depósito designado como centro de la red.
   *
   * No se puede expresar como FK —`depositos` guarda tanto centros como
   * depósitos privados— así que se valida en cada vínculo. Sin esto, un
   * proveedor de la red podría quedar colgando del depósito privado de un
   * comercio.
   */
  static async centroDeLaRed(centroId) {
    const centro = await Deposito.findOne({ where: { id: centroId, alcance: 'GESICOMM' } });
    if (!centro) throw errorHttp('El centro no existe o no es un centro de la red.', 404);
    return centro;
  }

  /** Vincula un proveedor a un centro. Idempotente: reactiva si ya existía. */
  static async vincularACentro(centroId, proveedorId, { prioridad = 0 } = {}) {
    const [centro, proveedor] = await Promise.all([
      this.centroDeLaRed(centroId),
      this.porId(proveedorId),
    ]);
    if (!centro.activo) throw errorHttp('El centro está inactivo.');
    if (!proveedor.activo) throw errorHttp('El proveedor está inactivo.');

    const [vinculo] = await CentroProveedorLogistico.findOrCreate({
      where: { centro_id: centro.id, proveedor_logistico_id: proveedor.id },
      defaults: { prioridad, activo: true },
    });
    if (!vinculo.activo || vinculo.prioridad !== prioridad) {
      await vinculo.update({ activo: true, prioridad });
    }
    return vinculo;
  }

  static async desvincularDeCentro(centroId, proveedorId) {
    const vinculo = await CentroProveedorLogistico.findOne({
      where: { centro_id: centroId, proveedor_logistico_id: proveedorId },
    });
    if (!vinculo) return { desvinculado: false };
    await vinculo.update({ activo: false });
    return { desvinculado: true };
  }

  /** Proveedores que operan desde un centro, con su prioridad. */
  static async porCentro(centroId, { soloActivos = true } = {}) {
    const vinculos = await CentroProveedorLogistico.findAll({
      where: { centro_id: centroId, ...(soloActivos ? { activo: true } : {}) },
      include: [{ model: ProveedorLogistico, as: 'proveedor', required: true }],
      order: [['prioridad', 'ASC']],
    });
    return vinculos
      .filter((v) => !soloActivos || v.proveedor.activo)
      .map((v) => ({
        id: v.proveedor.id,
        nombre: v.proveedor.nombre,
        tipo: v.proveedor.tipo,
        capacidades: v.proveedor.capacidades || [],
        telefono: v.proveedor.telefono,
        activo: v.proveedor.activo,
        prioridad: v.prioridad,
      }));
  }

  /**
   * Desde qué centros opera un proveedor.
   *
   * Hace falta para editarlo: sin esto la pantalla de edición no sabría en
   * qué centro está parada y tendría que adivinar, que es justo lo que el
   * `centro_id` de las tarifas existe para evitar.
   */
  static async centrosDe(proveedorId) {
    const vinculos = await CentroProveedorLogistico.findAll({
      where: { proveedor_logistico_id: proveedorId, activo: true },
      include: [{ model: Deposito, as: 'centro', required: true }],
      order: [['prioridad', 'ASC']],
    });
    return vinculos.map((v) => ({
      id: v.centro.id,
      nombre: v.centro.nombre,
      ciudad: v.centro.ciudad,
      prioridad: v.prioridad,
    }));
  }

  /** Centros activos de la red. Base de la resolución cuando no se acota. */
  static async centrosActivos() {
    return Deposito.findAll({
      where: { alcance: 'GESICOMM', activo: true },
      order: [['nombre', 'ASC']],
    });
  }

  /**
   * Una regla de cobertura de la red, normalizada.
   *
   * `usuario_id` y `courier_id` van explícitamente en null: es lo que el
   * CHECK de la tabla exige y lo que mantiene estas reglas fuera del
   * checkout de cualquier comercio.
   */
  static normalizarRegla(regla, centroId, proveedorId) {
    const r = regla || {};
    const ciudad = String(r.ciudad || '').trim();
    if (!ciudad) throw errorHttp('Cada regla necesita una ciudad.', 400);

    const numero = (valor, porDefecto = null) => (
      valor === '' || valor === undefined || valor === null ? porDefecto : Number(valor)
    );

    const rango_min = numero(r.rango_min, 0);
    const rango_max = numero(r.rango_max);
    const costo = numero(r.costo, 0);

    if (costo < 0) {
      throw errorHttp('El costo de la tarifa no puede ser negativo.', 400);
    }
    if (rango_min < 1) {
      throw errorHttp('El rango mínimo de cantidad debe ser al menos 1.', 400);
    }
    if (rango_max !== null && rango_max < rango_min) {
      throw errorHttp('El rango máximo debe ser mayor o igual al rango mínimo.', 400);
    }

    return {
      usuario_id: null,
      courier_id: null,
      proveedor_logistico_id: proveedorId,
      centro_id: centroId,
      ciudad,
      departamento: r.departamento ? String(r.departamento).trim() : null,
      ciudad_id: numero(r.ciudad_id),
      departamento_id: numero(r.departamento_id),
      pais_id: numero(r.pais_id),
      tipo_cobertura: r.tipo_cobertura || 'CIUDAD',
      tipo_pago: r.tipo_pago || 'Ambos',
      rango_min,
      rango_max,
      costo,
      tiempo_entrega_min_hs: numero(r.tiempo_entrega_min_hs),
      tiempo_entrega_max_hs: numero(r.tiempo_entrega_max_hs),
      activo: r.activo !== false,
    };
  }

  /**
   * Reemplaza la cobertura de UN proveedor desde UN centro.
   *
   * El alcance del borrado es exactamente ese par. Borrar por proveedor
   * solo se llevaría puestas las tarifas que ese mismo proveedor tiene desde
   * los otros centros, que es justo la distinción que el modelo existe para
   * preservar.
   */
  static async reemplazarCobertura(centroId, proveedorId, reglas = []) {
    await this.centroDeLaRed(centroId);
    await this.porId(proveedorId);

    const normalizadas = (Array.isArray(reglas) ? reglas : [])
      .map((r) => this.normalizarRegla(r, Number(centroId), Number(proveedorId)));

    // Validar solapamiento de rangos entre reglas del mismo destino/tipo
    for (let i = 0; i < normalizadas.length; i++) {
      for (let j = i + 1; j < normalizadas.length; j++) {
        const r1 = normalizadas[i];
        const r2 = normalizadas[j];
        if (r1.tipo_cobertura === r2.tipo_cobertura && r1.ciudad === r2.ciudad && r1.tipo_pago === r2.tipo_pago) {
          const min1 = r1.rango_min;
          const max1 = r1.rango_max === null ? Infinity : r1.rango_max;
          const min2 = r2.rango_min;
          const max2 = r2.rango_max === null ? Infinity : r2.rango_max;
          if (Math.max(min1, min2) <= Math.min(max1, max2)) {
            throw errorHttp('Existe solapamiento de rangos de cantidad para el mismo destino.', 400);
          }
        }
      }
    }

    await sequelize.transaction(async (t) => {
      await DeliveryZonaTarifa.destroy({
        where: { centro_id: centroId, proveedor_logistico_id: proveedorId },
        transaction: t,
      });
      if (normalizadas.length > 0) {
        await DeliveryZonaTarifa.bulkCreate(normalizadas, { transaction: t });
      }
    });

    return this.cobertura(centroId, proveedorId);
  }

  static async cobertura(centroId, proveedorId) {
    return DeliveryZonaTarifa.findAll({
      where: { centro_id: centroId, proveedor_logistico_id: proveedorId },
      include: [
        { model: Ciudad, as: 'ciudad_catalogo', attributes: ['id', 'nombre'], required: false },
        { model: Departamento, as: 'departamento_catalogo', attributes: ['id', 'nombre'], required: false },
      ],
      order: [['departamento', 'ASC'], ['ciudad', 'ASC'], ['rango_min', 'ASC']],
    });
  }

  /** Cuántas ciudades distintas cubre cada proveedor, para los listados. */
  static async ciudadesPorProveedor(proveedorIds = []) {
    const ids = [...new Set(proveedorIds.map(Number).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const filas = await DeliveryZonaTarifa.findAll({
      where: { proveedor_logistico_id: { [Op.in]: ids }, activo: true },
      attributes: [
        'proveedor_logistico_id',
        [sequelize.fn('COUNT', sequelize.literal('DISTINCT COALESCE(ciudad_id::text, ciudad)')), 'ciudades'],
      ],
      group: ['proveedor_logistico_id'],
      raw: true,
    });

    return new Map(filas.map((f) => [Number(f.proveedor_logistico_id), Number(f.ciudades) || 0]));
  }
}

module.exports = ProveedorLogisticoService;
