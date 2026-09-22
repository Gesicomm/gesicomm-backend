'use strict';

const { Op } = require('sequelize');
const { Deposito, Tienda, Pais, Departamento, Ciudad } = require('../models');
const TarifaDelivery = require('./tarifaDelivery.service');
const ProveedorLogisticoService = require('./proveedorLogistico.service');

function errorHttp(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/**
 * La red de fulfillment de Gesicomm, vista como producto logístico y no como
 * un CRUD de couriers.
 *
 * Los operadores de esta red son proveedores logísticos, no couriers: un
 * courier pertenece a un comercio y entrega los pedidos de ese comercio, y
 * un proveedor mueve mercadería dentro de la red. Son entidades distintas a
 * propósito.
 *
 * Todo lo que devuelve sale del MISMO motor de tarifas que usa el checkout
 * (TarifaDeliveryService): así el "desde ₲X" que ve un comercio en la
 * vidriera es literalmente el precio que le van a cobrar, y no un número
 * calculado aparte que puede divergir.
 *
 * Nada acá asume que exista un solo centro.
 */
class RedFulfillmentService {
  /** Proveedores logísticos de la red. */
  static async proveedoresDeRed(soloActivos = true) {
    return ProveedorLogisticoService.listar({ soloActivos });
  }

  static async centros(soloActivos = false) {
    return Deposito.findAll({
      where: { alcance: 'GESICOMM', ...(soloActivos ? { activo: true } : {}) },
      order: [['nombre', 'ASC']],
    });
  }

  /**
   * Cobertura resuelta de la red. Es la base de todos los KPIs: se calcula
   * sólo sobre reglas realmente utilizables (centro activo + proveedor activo
   * + tarifa activa), porque un MIN/MAX sobre la tabla entera mostraría
   * precios de proveedores apagados o de la logística propia de un comercio.
   */
  static async coberturaDeRed({ paymentMethod = 'efectivo', centroIds = null } = {}) {
    const [centros, proveedores] = await Promise.all([
      centroIds ? Promise.resolve(centroIds.map((id) => ({ id }))) : this.centros(true),
      this.proveedoresDeRed(true),
    ]);
    if (centros.length === 0 || proveedores.length === 0) return [];

    return TarifaDelivery.resolverOpcionesDeRed(
      { centroIds: centros.map((c) => c.id), proveedorIds: proveedores.map((p) => p.id) },
      { paymentMethod },
    );
  }

  /** KPIs del dashboard. Sin métricas inventadas: lo que no hay, va en null. */
  static async resumen() {
    const [centrosTodos, proveedores, cobertura] = await Promise.all([
      this.centros(),
      this.proveedoresDeRed(),
      this.coberturaDeRed(),
    ]);

    const costos = cobertura.map((o) => Number(o.costo) || 0).filter((n) => n > 0);
    const tiemposMin = cobertura.map((o) => o.tiempo_entrega_min_hs).filter((n) => n != null);
    const tiemposMax = cobertura.map((o) => o.tiempo_entrega_max_hs).filter((n) => n != null);

    const departamentos = new Set(
      cobertura.map((o) => TarifaDelivery.normalizarTexto(o.departamento)).filter(Boolean),
    );

    return {
      centros_activos: centrosTodos.filter((c) => c.activo).length,
      centros_totales: centrosTodos.length,
      proveedores_activos: proveedores.length,
      // Una ciudad cubierta es un destino alcanzable, no una regla: Luque
      // puede tener varias reglas (proveedor x rango x método) y sigue siendo
      // una. La cobertura ya viene deduplicada por destino.
      ciudades_cubiertas: cobertura.length,
      departamentos_cubiertos: departamentos.size,
      tarifa_desde: costos.length ? Math.min(...costos) : null,
      tarifa_hasta: costos.length ? Math.max(...costos) : null,
      // Sin datos numéricos suficientes no se muestra tiempo: es preferible
      // vacío a un plazo inventado sobre el que después se prometen entregas.
      tiempo_min_hs: tiemposMin.length ? Math.min(...tiemposMin) : null,
      tiempo_max_hs: tiemposMax.length ? Math.max(...tiemposMax) : null,
      configurada: centrosTodos.length > 0,
    };
  }

  /** Depósitos que un admin podría designar como centro. */
  static async candidatosACentro(usuarioId) {
    return Deposito.findAll({
      where: { usuario_id: usuarioId, alcance: 'PROPIO', activo: true },
      order: [['nombre', 'ASC']],
    });
  }

  /**
   * Marca un depósito como centro de la red.
   *
   * No alcanza con escribir el campo: un centro mal designado deja tarifas
   * colgando de infraestructura que no es de Gesicomm, o peor, se roba el
   * depósito con el que un comercio despacha sus propias ventas.
   */
  static async designarCentro(depositoId, usuarioId) {
    const deposito = await Deposito.findOne({ where: { id: depositoId, usuario_id: usuarioId } });
    if (!deposito) throw errorHttp('Depósito no encontrado.', 404);

    if (deposito.alcance === 'GESICOMM') return deposito; // idempotente
    if (!deposito.activo) {
      throw errorHttp('El depósito está inactivo: activalo antes de usarlo como centro de la red.');
    }

    const enUso = await Tienda.count({ where: { deposito_fulfillment_id: deposito.id } });
    if (enUso > 0) {
      throw errorHttp(
        `"${deposito.nombre}" es el depósito desde el que un comercio despacha su propia logística. Elegí otro o cambiá esa configuración primero.`,
      );
    }

    await deposito.update({ alcance: 'GESICOMM' });
    return deposito;
  }

  static async centroPorId(id) {
    const centro = await Deposito.findOne({ where: { id, alcance: 'GESICOMM' } });
    if (!centro) throw errorHttp('Centro de fulfillment no encontrado.', 404);
    return centro;
  }

  /**
   * Detalle de un centro. Hoy los proveedores de la red sirven a todos los
   * centros; cuando exista vínculo por centro se acota acá sin tocar la UI.
   */
  static async detalleCentro(id) {
    const [centro, proveedores, cobertura] = await Promise.all([
      this.centroPorId(id),
      this.proveedoresDeRed(),
      this.coberturaDeRed(),
    ]);

    const costos = cobertura.map((o) => Number(o.costo) || 0).filter((n) => n > 0);
    const departamentos = new Set(cobertura.map((o) => o.departamento).filter(Boolean));

    return {
      centro: {
        id: centro.id,
        nombre: centro.nombre,
        activo: centro.activo,
        ciudad: centro.ciudad,
        departamento: centro.departamento,
        direccion: centro.direccion,
        referencia: centro.referencia,
        persona_contacto: centro.persona_contacto,
        telefono_contacto: centro.telefono_contacto,
        google_maps_url: centro.google_maps_url,
      },
      capacidad: {
        proveedores: proveedores.length,
        ciudades: cobertura.length,
        departamentos: departamentos.size,
      },
      tarifas: {
        desde: costos.length ? Math.min(...costos) : null,
        hasta: costos.length ? Math.max(...costos) : null,
      },
    };
  }

  /** Cobertura agrupada por departamento, con el detalle de reglas (admin). */
  static async coberturaAgrupada(centroId = null) {
    // Acotada al centro cuando se pide: la tarifa pertenece al par
    // centro+proveedor, así que mostrar la red entera en el detalle de un
    // centro diría precios que desde ese centro no se cobran.
    const cobertura = await this.coberturaDeRed(centroId ? { centroIds: [Number(centroId)] } : {});
    const grupos = new Map();

    for (const opcion of cobertura) {
      const clave = opcion.departamento || 'Sin departamento';
      const grupo = grupos.get(clave) || { departamento: clave, ciudades: [] };
      grupo.ciudades.push(opcion);
      grupos.set(clave, grupo);
    }

    return [...grupos.values()]
      .map((g) => ({
        ...g,
        total_ciudades: g.ciudades.length,
        desde: Math.min(...g.ciudades.map((c) => c.costo)),
      }))
      .sort((a, b) => a.departamento.localeCompare(b.departamento, 'es'));
  }

  /**
   * Proveedores de la red con su cobertura y tarifa mínima.
   *
   * Incluye los inactivos a propósito: un proveedor apagado tiene que verse
   * en el listado del admin para poder reactivarlo. Los KPIs, en cambio, sólo
   * cuentan los activos — por eso `coberturaDeRed` filtra y esto no.
   */
  static async proveedores() {
    const proveedores = await this.proveedoresDeRed(false);
    if (proveedores.length === 0) return [];

    const centros = await this.centros(true);
    const cobertura = centros.length === 0 ? [] : await TarifaDelivery.resolverOpcionesDeRed({
      centroIds: centros.map((c) => c.id),
      proveedorIds: proveedores.map((p) => p.id),
    });

    return proveedores.map((p) => {
      const propias = cobertura.filter((o) => o.proveedor_id === p.id);
      const costos = propias.map((o) => Number(o.costo) || 0).filter((n) => n > 0);
      return {
        id: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        capacidades: p.capacidades || [],
        telefono: p.telefono,
        contacto: p.contacto,
        email: p.email,
        activo: p.activo,
        ciudades: propias.length,
        desde: costos.length ? Math.min(...costos) : null,
      };
    });
  }

  /**
   * Cobertura COMERCIAL para el comercio: consolidada por ciudad y sin
   * revelar qué proveedor entrega. Quién hace la última milla es decisión
   * operativa de Gesicomm, no parte de lo que el comercio contrata.
   */
  static async coberturaComercial() {
    const [alRecibir, anticipado] = await Promise.all([
      this.coberturaDeRed({ paymentMethod: 'efectivo' }),
      this.coberturaDeRed({ paymentMethod: 'transferencia' }),
    ]);

    const porCiudad = new Map();
    const acumular = (opciones, metodo) => {
      for (const o of opciones) {
        const clave = o.ciudad_id ? `id:${o.ciudad_id}` : `txt:${TarifaDelivery.normalizarTexto(o.ciudad)}`;
        const actual = porCiudad.get(clave) || {
          departamento: o.departamento,
          ciudad: o.ciudad,
          desde: o.costo,
          hasta: o.costo,
          tiempoMinHs: o.tiempo_entrega_min_hs ?? null,
          tiempoMaxHs: o.tiempo_entrega_max_hs ?? null,
          metodosPago: new Set(),
        };
        actual.desde = Math.min(actual.desde, o.costo);
        actual.hasta = Math.max(actual.hasta, o.costo);
        if (o.tiempo_entrega_min_hs != null) {
          actual.tiempoMinHs = actual.tiempoMinHs == null
            ? o.tiempo_entrega_min_hs : Math.min(actual.tiempoMinHs, o.tiempo_entrega_min_hs);
        }
        if (o.tiempo_entrega_max_hs != null) {
          actual.tiempoMaxHs = actual.tiempoMaxHs == null
            ? o.tiempo_entrega_max_hs : Math.max(actual.tiempoMaxHs, o.tiempo_entrega_max_hs);
        }
        actual.metodosPago.add(metodo);
        porCiudad.set(clave, actual);
      }
    };

    acumular(alRecibir, 'AL_RECIBIR');
    acumular(anticipado, 'ANTICIPADO');

    return [...porCiudad.values()]
      .map((c) => ({ ...c, metodosPago: [...c.metodosPago].sort() }))
      .sort((a, b) => {
        const dep = String(a.departamento || '').localeCompare(String(b.departamento || ''), 'es');
        return dep || String(a.ciudad || '').localeCompare(String(b.ciudad || ''), 'es');
      });
  }

  /** Catálogo geográfico para selectores y filtros. */
  static async catalogoGeografico({ conCiudades = false } = {}) {
    const departamentos = await Departamento.findAll({
      where: { activo: true },
      include: conCiudades
        ? [{ model: Ciudad, as: 'ciudades', where: { activo: true }, required: false, attributes: ['id', 'nombre'] }]
        : [],
      order: conCiudades
        ? [['nombre', 'ASC'], [{ model: Ciudad, as: 'ciudades' }, 'nombre', 'ASC']]
        : [['nombre', 'ASC']],
    });

    return departamentos.map((d) => ({
      id: d.id,
      pais_id: d.pais_id,
      nombre: d.nombre,
      ...(conCiudades ? { ciudades: (d.ciudades || []).map((c) => ({ id: c.id, nombre: c.nombre })) } : {}),
    }));
  }
}

module.exports = RedFulfillmentService;
module.exports.errorHttp = errorHttp;
