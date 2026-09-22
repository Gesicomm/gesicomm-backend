'use strict';

const { Op } = require('sequelize');
const {
  Courier, DeliveryZonaTarifa, Ciudad, Departamento, ProveedorLogistico, Deposito,
} = require('../models');

/**
 * Única fuente de resolución de tarifas de delivery.
 *
 * Antes esto vivía dentro de LandingService y fusionaba dos tablas
 * (`courier_tarifas` y `delivery_zona_tarifas`) en una misma bolsa de
 * candidatos, quedándose con el más barato. Esa fusión hacía que editar una
 * tarifa en un lado no tuviera efecto si existía una fila más barata en el
 * otro. Hoy la única fuente de verdad es `delivery_zona_tarifas`.
 *
 * Ningún controller ni service debe volver a consultar tablas de tarifas por
 * su cuenta: todo cálculo de cobertura/costo entra por acá.
 */
class TarifaDeliveryService {
  static normalizarTexto(valor) {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  }

  static cantidadEvaluada(items) {
    const total = (items || []).reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
    return total > 0 ? total : 1;
  }

  static tipoPagoDesdeMetodo(paymentMethod) {
    const metodo = String(paymentMethod || 'efectivo').trim().toLowerCase();
    return metodo && metodo !== 'efectivo' ? 'Anticipado' : 'Al Recibir';
  }

  /**
   * Entre varias reglas del mismo destino gana la más barata que además sea
   * compatible con el tipo de pago y caiga dentro del rango de cantidad.
   */
  static elegirTarifa(candidatos, targetTipoPago, cantidad, requerirCapacidad = null) {
    const ordenadas = [...candidatos].sort((a, b) => (Number(a.tarifa?.costo) || 0) - (Number(b.tarifa?.costo) || 0));
    const enRango = (t) => {
      const min = Number(t.tarifa?.rango_min) || 0;
      const max = (t.tarifa?.rango_max === null || t.tarifa?.rango_max === undefined || t.tarifa?.rango_max === '') ? Infinity : Number(t.tarifa?.rango_max);
      return cantidad >= min && cantidad <= max;
    };
    const pagoCompatible = (t) => t.tarifa?.tipo_pago === 'Ambos' || t.tarifa?.tipo_pago === targetTipoPago;
    const capacidadCompatible = (t) => {
      if (!requerirCapacidad) return true;
      const prov = t.proveedor;
      if (!prov || !prov.activo) return false;
      const caps = Array.isArray(prov.capacidades) ? prov.capacidades : [];
      return caps.includes(requerirCapacidad);
    };

    // Solo se aceptan candidatas que cumplan capacidad, tipo de pago Y caigan estrictamente en el rango.
    return ordenadas.find(t => capacidadCompatible(t) && pagoCompatible(t) && enRango(t)) || null;
  }

  /** Cobertura completa de un comercio: una opción por destino, con su costo. */
  static async resolverOpcionesDelivery(usuarioId, { paymentMethod = 'efectivo', items = [] } = {}) {
    if (!usuarioId) return [];
    return this.resolverDesdeZonas({ usuario_id: usuarioId, activo: true }, { paymentMethod, items });
  }

  /**
   * Cobertura de un conjunto puntual de couriers, sin importar de quién sean.
   *
   * Hace falta para el fulfillment gestionado por Gesicomm: esos couriers son
   * del usuario admin, así que sus tarifas nunca aparecerían filtrando por el
   * usuario_id del comercio. También sirve para acotar la logística propia a
   * los couriers habilitados en un depósito.
   */
  static async resolverOpcionesPorCouriers(courierIds, { paymentMethod = 'efectivo', items = [] } = {}) {
    const ids = [...new Set((courierIds || []).map(Number).filter(Boolean))];
    if (ids.length === 0) return [];
    return this.resolverDesdeZonas({ courier_id: { [Op.in]: ids }, activo: true }, { paymentMethod, items });
  }

  /**
   * Cobertura de la red logística de Gesicomm.
   *
   * La pregunta que responde es la completa: centro + proveedor + destino +
   * cantidad + método de pago. El centro forma parte de la identidad de la
   * tarifa porque el mismo proveedor puede cobrar distinto a la misma ciudad
   * según desde dónde sale.
   *
   * Sin `centroIds` toma todos los centros activos y gana el más barato por
   * destino. No hay asignación comercio->centro todavía; cuando exista, esto
   * es un filtro más, no una reescritura.
   */
  static async resolverOpcionesDeRed({ centroIds, proveedorIds } = {}, { paymentMethod = 'efectivo', items = [], requerirCapacidad = null } = {}) {
    const where = { proveedor_logistico_id: { [Op.ne]: null }, activo: true };

    const centros = [...new Set((centroIds || []).map(Number).filter(Boolean))];
    if (centros.length > 0) where.centro_id = { [Op.in]: centros };

    const proveedores = [...new Set((proveedorIds || []).map(Number).filter(Boolean))];
    if (proveedores.length > 0) where.proveedor_logistico_id = { [Op.in]: proveedores };

    return this.resolverDesdeZonas(where, { paymentMethod, items, requerirCapacidad });
  }

  /**
   * Expande las reglas de cobertura a los destinos realmente alcanzables.
   *
   *   CIUDAD             -> esa ciudad
   *   RESTO_DEPARTAMENTO -> todas las ciudades de ese departamento
   *   RESTO_PAIS         -> todas las ciudades de ese país
   *
   * Las legacy sin clasificar (tipo_cobertura NULL) NO se expanden: siguen
   * produciendo su destino por texto, tal como antes. Expandirlas exigiría
   * inferir a qué ciudad se referían, y "fernando" o "Central" no se pueden
   * adivinar sin inventar cobertura.
   */
  static async expandirCobertura(zonas) {
    const deptoIds = new Set();
    const paisIds = new Set();
    for (const z of zonas) {
      if (z.tipo_cobertura === 'RESTO_DEPARTAMENTO' && z.departamento_id) deptoIds.add(z.departamento_id);
      if (z.tipo_cobertura === 'RESTO_PAIS' && z.pais_id) paisIds.add(z.pais_id);
    }
    const vacio = { porDepartamento: new Map(), porPais: new Map() };
    if (deptoIds.size === 0 && paisIds.size === 0) return vacio;

    const condiciones = [];
    if (deptoIds.size > 0) condiciones.push({ departamento_id: { [Op.in]: [...deptoIds] } });
    if (paisIds.size > 0) condiciones.push({ '$departamento.pais_id$': { [Op.in]: [...paisIds] } });

    const ciudades = await Ciudad.findAll({
      where: { activo: true, [Op.or]: condiciones },
      include: [{
        model: Departamento, as: 'departamento', attributes: ['id', 'nombre', 'pais_id'], required: true,
      }],
    });

    const porDepartamento = new Map();
    const porPais = new Map();
    for (const c of ciudades) {
      const dep = porDepartamento.get(c.departamento_id) || [];
      dep.push(c);
      porDepartamento.set(c.departamento_id, dep);

      const paisId = c.departamento.pais_id;
      const pais = porPais.get(paisId) || [];
      pais.push(c);
      porPais.set(paisId, pais);
    }
    return { porDepartamento, porPais };
  }

  static async resolverDesdeZonas(where, { paymentMethod = 'efectivo', items = [], requerirCapacidad = null } = {}) {
    const zonas = await DeliveryZonaTarifa.findAll({
      where,
      include: [
        { model: Courier, as: 'courier', attributes: ['id', 'nombre', 'activo'], required: false },
        { model: ProveedorLogistico, as: 'proveedor', attributes: ['id', 'nombre', 'activo', 'capacidades'], required: false },
        { model: Deposito, as: 'centro', attributes: ['id', 'nombre'], required: false },
      ],
      order: [['departamento', 'ASC'], ['ciudad', 'ASC'], ['rango_min', 'ASC']],
    });

    const targetTipoPago = this.tipoPagoDesdeMetodo(paymentMethod);
    const cantidad = this.cantidadEvaluada(items);
    const { porDepartamento, porPais } = await this.expandirCobertura(zonas);

    const PRIORIDAD = { CIUDAD: 0, RESTO_DEPARTAMENTO: 1, RESTO_PAIS: 2 };
    const grupos = new Map();

    const agregar = (key, ciudad, departamento, zona, nivel, ciudadId) => {
      const grupo = grupos.get(key) || { ciudad, departamento, ciudad_id: ciudadId ?? null, niveles: new Map() };
      const lista = grupo.niveles.get(nivel) || [];
      lista.push({
        tarifa: zona,
        courier: zona.courier?.activo ? zona.courier : null,
        proveedor: zona.proveedor?.activo ? zona.proveedor : null,
        centro: zona.centro || null,
        ciudad,
        departamento,
      });
      grupo.niveles.set(nivel, lista);
      grupo.ciudad_id = grupo.ciudad_id ?? ciudadId ?? null;
      grupos.set(key, grupo);
    };

    for (const zona of zonas) {
      const tipo = zona.tipo_cobertura;

      if (tipo === 'RESTO_DEPARTAMENTO' || tipo === 'RESTO_PAIS') {
        const alcanzadas = tipo === 'RESTO_DEPARTAMENTO'
          ? (porDepartamento.get(zona.departamento_id) || [])
          : (porPais.get(zona.pais_id) || []);
        for (const c of alcanzadas) {
          const key = `id:${c.id}`;
          agregar(key, c.nombre, c.departamento?.nombre || null, zona, PRIORIDAD[tipo], c.id);
        }
        continue;
      }

      const ciudad = String(zona.ciudad || '').trim();
      if (!ciudad) continue;
      const departamento = zona.departamento ? String(zona.departamento).trim() : null;
      const key = zona.ciudad_id
        ? `id:${zona.ciudad_id}`
        : `txt:${this.normalizarTexto(departamento)}::${this.normalizarTexto(ciudad)}`;
      agregar(key, ciudad, departamento, zona, PRIORIDAD.CIUDAD, zona.ciudad_id || null);
    }

    const opciones = [];
    for (const grupo of grupos.values()) {
      const nivel = Math.min(...grupo.niveles.keys());
      const lista = grupo.niveles.get(nivel);
      const origen = this.elegirTarifa(lista, targetTipoPago, cantidad, requerirCapacidad);
      const elegida = origen?.tarifa;
      if (!origen || !elegida) continue;
      opciones.push({
        ciudad: grupo.ciudad,
        departamento: grupo.departamento,
        ciudad_id: grupo.ciudad_id,
        costo: Number(elegida.costo) || 0,
        tiempo_entrega_hs: elegida.tiempo_entrega_hs || null,
        tiempo_entrega_min_hs: elegida.tiempo_entrega_min_hs ?? null,
        tiempo_entrega_max_hs: elegida.tiempo_entrega_max_hs ?? null,
        tipo_cobertura: elegida.tipo_cobertura || 'CIUDAD',
        // Se conservan tal cual: son 18 consumidores, incluido el checkout
        // público. Una regla de red los deja en null y llena los de abajo.
        courier_id: origen.courier?.id || null,
        courier_nombre: origen.courier?.nombre || null,
        proveedor_id: origen.proveedor?.id || null,
        proveedor_nombre: origen.proveedor?.nombre || null,
        centro_id: origen.centro?.id || null,
        centro_nombre: origen.centro?.nombre || null,
        // Quién entrega, sin que quien muestre tenga que saber de qué familia
        // es la regla.
        operador_nombre: origen.courier?.nombre || origen.proveedor?.nombre || null,
        reglas: lista.map(({ tarifa, courier, proveedor, centro }) => ({
          costo: Number(tarifa.costo) || 0,
          tipo_pago: tarifa.tipo_pago || 'Ambos',
          rango_min: Number(tarifa.rango_min) || 0,
          rango_max: tarifa.rango_max === null || tarifa.rango_max === undefined ? null : Number(tarifa.rango_max),
          tiempo_entrega_hs: tarifa.tiempo_entrega_hs || null,
          courier_id: courier?.id || null,
          courier_nombre: courier?.nombre || null,
          proveedor_id: proveedor?.id || null,
          proveedor_nombre: proveedor?.nombre || null,
          centro_id: centro?.id || null,
          operador_nombre: courier?.nombre || proveedor?.nombre || null,
        })),
      });
    }

    return opciones.sort((a, b) => {
      const dep = String(a.departamento || '').localeCompare(String(b.departamento || ''), 'es');
      return dep || String(a.ciudad || '').localeCompare(String(b.ciudad || ''), 'es');
    });
  }

  /**
   * Coincidencia exacta de destino. Si no hay match no se estima ni se
   * aproxima: se devuelve null y el costo queda para carga manual.
   */
  static buscarOpcion(opciones, ciudad, departamento) {
    const ciudadNorm = this.normalizarTexto(ciudad);
    const deptoNorm = this.normalizarTexto(departamento);
    if (!ciudadNorm) return null;

    const exacta = opciones.find(op =>
      this.normalizarTexto(op.ciudad) === ciudadNorm
      && this.normalizarTexto(op.departamento) === deptoNorm
    );
    if (exacta) return exacta;

    if (!deptoNorm) {
      const porCiudad = opciones.filter(op => this.normalizarTexto(op.ciudad) === ciudadNorm);
      if (porCiudad.length === 1) return porCiudad[0];
    }

    return null;
  }
}

module.exports = TarifaDeliveryService;
