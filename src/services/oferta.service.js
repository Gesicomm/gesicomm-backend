'use strict';

/**
 * Servicio de Ofertas comerciales — precio + receta de stock por producto.
 *
 * A diferencia de ProductoCombo (motor de márgenes CPA para bundles
 * principal+upsells), este servicio es deliberadamente simple: una Oferta
 * es "precio X vendido, receta Y descontada de stock". El backend nunca
 * confía en costos/márgenes calculados por el frontend — solo se muestran
 * a partir del catálogo real (precio_costo) al listar.
 */

const { Op } = require('sequelize');
const { Oferta, OfertaComponente, Producto, ProductoImagen, ProductoVariante } = require('../models');

const TIPOS_CONTENIDO = ['pack', 'combo'];
// 'combo' sigue aceptado por compatibilidad con una fila legacy (ya
// inactiva) de cuando existió como oferta de checkout multi-producto. Nada
// en el frontend actual permite crear una nueva: los paquetes son
// estrategia='normal' (mismo producto, más unidades) y solo el order_bump
// vive en el checkout. Ver ProductCheckoutOfertas.jsx.
const ESTRATEGIAS = ['normal', 'order_bump', 'upsell', 'combo'];

/**
 * Estrategias que se presentan DENTRO del checkout (no en la ficha del
 * producto). Son las únicas que pueden tener precio_order_bump y las
 * únicas que la reportería cuenta como "venta incremental".
 *
 * El 'combo' NO está acá: se elige ANTES de comprar, en la ficha del
 * producto, como una forma más de comprarlo ("1 unidad / 2 x precio
 * especial / 3 x precio especial"). Por eso se vende siempre a su
 * precio_normal y no tiene precio promocional de checkout.
 */
const ESTRATEGIAS_CHECKOUT = ['order_bump', 'upsell'];

class OfertaService {

  /**
   * Normaliza y fusiona componentes por producto_id + variante_id (si el
   * payload trae la misma combinación dos veces, se suman las cantidades en
   * vez de rechazar o duplicar), valida cantidad >= 1 y exige al menos un
   * componente.
   *
   * Las variantes NUNCA se definen acá — si el componente trae `variante_id`
   * tiene que pertenecer de verdad a `producto_id` (se verifica contra
   * producto_variantes). Un producto con variantes activas exige elegir una
   * fija o marcar `permite_elegir_variante`: dejarlo sin definir sería
   * ambiguo al momento de agregarlo al carrito.
   */
  static async normalizarComponentes(componentesPayload = [], transaction) {
    const mapa = new Map();
    for (const c of componentesPayload) {
      const productoId = Number(c.producto_id);
      const cantidad = parseInt(c.cantidad, 10) || 0;
      const descuentoPorcentaje = Math.min(100, Math.max(0, parseFloat(c.descuento_porcentaje) || 0));
      const permiteElegirVariante = !!c.permite_elegir_variante;
      const varianteId = c.variante_id ? Number(c.variante_id) : null;
      if (!productoId) throw new Error('Cada componente necesita un producto válido.');
      if (cantidad < 1) throw new Error('La cantidad de cada componente debe ser al menos 1.');

      if (varianteId) {
        const variante = await ProductoVariante.findOne({ where: { id: varianteId, producto_id: productoId, activo: true }, transaction });
        if (!variante) throw new Error('La variante elegida no pertenece a ese producto.');
      } else if (!permiteElegirVariante) {
        const tieneVariantes = await ProductoVariante.count({ where: { producto_id: productoId, activo: true }, transaction });
        if (tieneVariantes > 0) {
          throw new Error('Ese producto tiene variantes: elegí una fija o permití que el cliente la elija.');
        }
      }

      // Fusionar por producto_id+variante_id (regla existente, extendida)
      // suma cantidades; el descuento y la config de variante se quedan con
      // el último valor recibido para esa combinación.
      const clave = `${productoId}:${varianteId || ''}`;
      const existente = mapa.get(clave);
      mapa.set(clave, {
        producto_id: productoId,
        variante_id: varianteId,
        permite_elegir_variante: permiteElegirVariante,
        cantidad: (existente?.cantidad || 0) + cantidad,
        descuento_porcentaje: descuentoPorcentaje,
      });
    }
    if (mapa.size === 0) throw new Error('La oferta necesita al menos un componente de stock.');
    return Array.from(mapa.values());
  }

  /**
   * "Pack" es una presentación alternativa del propio producto ancla (ej.
   * "Earplugs x3") — no un bundle. Si permitiéramos otros productos ahí
   * dejaría de ser un pack y pasaría a comportarse como un combo sin
   * declararlo, confundiendo el modelo. "Combo" sí admite varios productos
   * libremente. estrategia y tipo_contenido quedan independientes a
   * propósito (un combo puede ser normal/order_bump/upsell igual que un
   * pack) — esta regla solo restringe qué productos puede tener cada uno.
   *
   * Única excepción: estrategia='combo' ("3 productos x 120.000" en el
   * checkout) exige tipo_contenido='combo' — ver resolverTipoContenido().
   */
  static validarComponentesParaTipo(tipoContenido, productoAnclaId, componentes) {
    if (tipoContenido !== 'pack') return;
    const soloAncla = componentes.length === 1 && Number(componentes[0].producto_id) === Number(productoAnclaId);
    if (!soloAncla) {
      throw new Error('Un "pack" solo puede tener el producto ancla como componente (en la cantidad que corresponda). Para combinar varios productos, usá "combo".');
    }
  }

  /**
   * Un order bump/upsell se vende SIEMPRE como una línea aparte de la del
   * producto ancla (ver CartDrawer/FunnelCheckout — el ancla ya es su
   * propia línea de carrito con su propio precio y su propio descuento de
   * stock). Si su receta de componentes incluyera también al ancla, al
   * confirmarse el pedido se le descontaría stock DOS veces (una por su
   * línea propia, otra por la receta del bump) y `precio_normal` quedaría
   * ambiguo entre "el extra" y "el bundle completo". Por eso acá se saca
   * al ancla de la receta pase lo que pase: la única receta válida para
   * estas dos estrategias es "lo que se agrega de más".
   *
   * Un combo de estrategia='normal' es distinto: ahí SÍ existe una sola
   * línea que reemplaza la compra entera (se elige en la ficha del
   * producto, como otra forma de comprarlo), así que su receta necesita
   * incluir el ancla — a esa estrategia esta función no le toca nada.
   */
  static excluirAnclaDeBumpOUpsell(componentes, estrategia, productoAnclaId) {
    if (estrategia !== 'order_bump' && estrategia !== 'upsell') return componentes;
    const sinAncla = componentes.filter(c => Number(c.producto_id) !== Number(productoAnclaId));
    if (sinAncla.length === 0) {
      throw new Error('Un order bump/upsell necesita al menos un producto distinto al principal — no tiene sentido que se ofrezca a sí mismo.');
    }
    return sinAncla;
  }

  static validarPayload(payload) {
    const { codigo, nombre, tipo_contenido, estrategia, precio_normal, precio_order_bump } = payload;
    if (!codigo?.trim()) throw new Error('El código de la oferta es obligatorio.');
    if (!nombre?.trim()) throw new Error('El nombre de la oferta es obligatorio.');
    if (tipo_contenido !== undefined && !TIPOS_CONTENIDO.includes(tipo_contenido)) {
      throw new Error(`tipo_contenido inválido. Valores permitidos: ${TIPOS_CONTENIDO.join(', ')}.`);
    }
    if (estrategia !== undefined && !ESTRATEGIAS.includes(estrategia)) {
      throw new Error(`estrategia inválida. Valores permitidos: ${ESTRATEGIAS.join(', ')}.`);
    }
    // Estrictamente mayor a 0: una oferta a precio 0 no es una promoción, es
    // regalar el producto — y casi siempre viene de un campo que quedó vacío
    // (pasó de verdad: se guardaron ofertas en 0 y se mostraban sin precio).
    if (!(parseFloat(precio_normal) > 0)) throw new Error('El precio de la oferta tiene que ser mayor a 0.');
    if (ESTRATEGIAS_CHECKOUT.includes(estrategia)) {
      const tienePrecioCheckout = precio_order_bump !== null && precio_order_bump !== undefined && precio_order_bump !== '';
      if (tienePrecioCheckout && !(parseFloat(precio_order_bump) > 0)) {
        throw new Error('El precio promocional de checkout tiene que ser mayor a 0.');
      }
      if (tienePrecioCheckout && parseFloat(precio_order_bump) >= parseFloat(precio_normal)) {
        throw new Error('El precio promocional de checkout tiene que ser menor al precio normal.');
      }
    } else if (precio_order_bump !== null && precio_order_bump !== undefined && !(parseFloat(precio_order_bump) > 0)) {
      throw new Error('El precio promocional de checkout tiene que ser mayor a 0.');
    }
    if (payload.fecha_inicio && payload.fecha_fin && String(payload.fecha_fin) < String(payload.fecha_inicio)) {
      throw new Error('La fecha de fin no puede ser anterior a la de inicio.');
    }
  }

  /**
   * Los dos precios llegan del cliente con nombres nuevos, pero durante la
   * transición el frontend viejo (y los tests) todavía mandan `precio` a
   * secas. Se normaliza acá, en un solo lugar, en vez de repetir el fallback
   * en crear() y actualizar().
   *
   * precio_order_bump se guarda SOLO para estrategias de checkout: dejarlo
   * cargado en una oferta "normal" sería un precio muerto que nadie cobra
   * pero que confundiría a la reportería.
   */
  static normalizarPrecios(payload, actual = null) {
    const estrategia = payload.estrategia ?? actual?.estrategia ?? 'normal';

    const normalCrudo = payload.precio_normal !== undefined
      ? payload.precio_normal
      : (payload.precio !== undefined ? payload.precio : actual?.precio_normal);
    const precioNormal = Math.max(0, Math.round(parseFloat(normalCrudo) || 0));

    let precioOrderBump = null;
    if (ESTRATEGIAS_CHECKOUT.includes(estrategia)) {
      const bumpCrudo = payload.precio_order_bump !== undefined
        ? payload.precio_order_bump
        : actual?.precio_order_bump;
      precioOrderBump = (bumpCrudo === null || bumpCrudo === undefined || bumpCrudo === '')
        ? null
        : Math.max(0, Math.round(parseFloat(bumpCrudo) || 0));
    }

    return { precio_normal: precioNormal, precio_order_bump: precioOrderBump, precio: precioNormal };
  }

  static normalizarBeneficios(payload, actual = null) {
    if (payload.beneficios === undefined) return actual?.beneficios ?? [];
    if (!Array.isArray(payload.beneficios)) return [];
    return payload.beneficios.map(b => String(b || '').trim()).filter(Boolean).slice(0, 6);
  }

  /**
   * estrategia='combo' significa literalmente "paquete de varios productos
   * a precio fijo", así que su tipo_contenido no puede ser 'pack' (que por
   * definición solo admite el producto ancla). Se fuerza acá en vez de
   * rechazar el payload: el formulario del checkout elige la estrategia, no
   * el tipo de contenido, y hacerlo fallar por un campo que esa pantalla ni
   * muestra sería un callejón sin salida para el usuario.
   */
  static resolverTipoContenido(estrategia, tipoContenidoPedido, actual = null) {
    if (estrategia === 'combo') return 'combo';
    return tipoContenidoPedido ?? actual?.tipo_contenido ?? 'pack';
  }

  /**
   * Campos opcionales de presentación y vigencia. Vacío se guarda como NULL,
   * no como cadena vacía: NULL en fecha_inicio/fecha_fin significa "sin
   * límite por ese lado" (ver PricingService.ofertaVigente), y '' rompería
   * esa lectura.
   */
  static normalizarExtras(payload) {
    const extras = {};
    if (payload.imagen_url !== undefined) {
      extras.imagen_url = payload.imagen_url?.trim() || null;
      // Editar imagen_url como texto libre (no por el endpoint de subida) ya
      // no corresponde a ningún objeto de R2 propio — limpiar storage_key
      // para no dejarlo apuntando a una key que no coincide con la URL.
      extras.imagen_storage_key = null;
      extras.imagen_mime_type = null;
      extras.imagen_size = null;
      extras.imagen_width = null;
      extras.imagen_height = null;
    }
    if (payload.fecha_inicio !== undefined) extras.fecha_inicio = payload.fecha_inicio || null;
    if (payload.fecha_fin !== undefined) extras.fecha_fin = payload.fecha_fin || null;
    return extras;
  }

  /**
   * Imagen propia de la oferta (Oferta.imagen_url) — UNA sola, no una
   * galería: una tarjeta de paquete en la ficha muestra exactamente una
   * foto. Se guarda en la Oferta y no en la landing a propósito: la misma
   * oferta se administra desde la carga de productos y desde el armador de
   * landing, y tiene que ser la misma foto en los dos lados.
   *
   * `imagenData` es el objeto de ImagenService.procesarArchivoParaR2
   * ({url, storage_key, mime_type, size, width, height}) o null para quitar.
   *
   * @returns {{imagen_url: string|null, anterior: {url: string, storage_key: string|null}|null}}
   *   `anterior` es la imagen que se reemplaza, para que el controller borre
   *   ese objeto de R2 (o el archivo legacy en disco).
   */
  static async actualizarImagen(id, inquilino_id, imagenData) {
    const oferta = await Oferta.findOne({ where: { id, inquilino_id } });
    if (!oferta) throw new Error('Oferta no encontrada.');
    const anterior = oferta.imagen_url ? { url: oferta.imagen_url, storage_key: oferta.imagen_storage_key } : null;

    oferta.imagen_url = imagenData ? imagenData.url : null;
    oferta.imagen_storage_key = imagenData ? imagenData.storage_key : null;
    oferta.imagen_mime_type = imagenData ? imagenData.mime_type : null;
    oferta.imagen_size = imagenData ? imagenData.size : null;
    oferta.imagen_width = imagenData ? imagenData.width : null;
    oferta.imagen_height = imagenData ? imagenData.height : null;
    await oferta.save();
    return { imagen_url: oferta.imagen_url, anterior };
  }

  /**
   * Lista las ofertas activas (o todas, si se pide) de un producto, con sus
   * componentes y el costo/margen calculado en vivo contra el catálogo
   * actual — esto es solo informativo para la pantalla de administración,
   * nunca se persiste (el costo real de una venta ya confirmada vive en
   * EnvioItemComponente, no acá).
   */
  static async listarPorProducto(producto_ancla_id, inquilino_id, { soloActivas = false, transaction, usuarioId = null } = {}) {
    const where = { producto_ancla_id, inquilino_id };
    if (soloActivas) where.activo = true;

    const ofertas = await Oferta.findAll({
      where,
      transaction,
      include: [{
        model: OfertaComponente,
        as: 'componentes',
        include: [{
          model: Producto,
          as: 'producto',
          attributes: ['id', 'nombre', 'sku', 'precio_costo', 'precio_base', 'creado_por', 'cantidad_disponible'],
          include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }]
        }, {
          model: ProductoVariante,
          as: 'variante',
        }],
      }],
      order: [['orden', 'ASC'], ['created_at', 'ASC']],
    });

    return ofertas.map(o => this.conMargen(o, usuarioId));
  }

  /**
   * Todas las ofertas del inquilino, sin pasar producto por producto. Lo usa
   * el armador de landing para mostrar de una vez los bumps/upsells de los
   * productos de la landing. Mismo formato que listarPorProducto (con
   * margen) + `producto_ancla` para saber de qué producto es cada una.
   *
   * @param {number} inquilino_id
   * @param {{estrategias?: string[], productoIds?: number[], soloActivas?: boolean}} filtros
   */
  static async listar(inquilino_id, { estrategias = [], productoIds = [], soloActivas = false, usuarioId = null } = {}) {
    const where = { inquilino_id };
    const validas = estrategias.filter(e => ESTRATEGIAS.includes(e));
    if (validas.length) where.estrategia = validas;
    if (productoIds.length) where.producto_ancla_id = productoIds;
    if (soloActivas) where.activo = true;

    const ofertas = await Oferta.findAll({
      where,
      include: [{
        model: OfertaComponente,
        as: 'componentes',
        include: [{
          model: Producto,
          as: 'producto',
          attributes: ['id', 'nombre', 'sku', 'precio_costo', 'precio_base', 'creado_por', 'cantidad_disponible'],
          include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }],
        }, {
          model: ProductoVariante,
          as: 'variante',
        }],
      }],
      order: [['producto_ancla_id', 'ASC'], ['orden', 'ASC'], ['created_at', 'ASC']],
    });

    const idsAncla = [...new Set(ofertas.map(o => o.producto_ancla_id))];
    const anclas = idsAncla.length
      ? await Producto.findAll({
        where: { id: idsAncla, inquilino_id },
        attributes: ['id', 'nombre'],
        include: [{ model: ProductoImagen, as: 'imagenes', attributes: ['url', 'es_principal'] }],
      })
      : [];
    const mapaAnclas = new Map(anclas.map(p => {
      const imgs = p.imagenes || [];
      const principal = imgs.find(i => i.es_principal) || imgs[0];
      return [p.id, { id: p.id, nombre: p.nombre, imagen: principal?.url || null }];
    }));

    return ofertas.map(o => ({
      ...this.conMargen(o, usuarioId),
      producto_ancla: mapaAnclas.get(o.producto_ancla_id) || null,
    }));
  }

  /**
   * Costo de una unidad para el comercio — mismo criterio que el "Te cuesta"
   * del catálogo (PrecioUsuarioService): de un producto propio es su
   * precio_costo; de uno del catálogo de Gesicom, lo que el comercio le paga
   * (precio_base). Antes se usaba siempre precio_costo, que en los productos
   * de Gesicom viene vacío: un bump de un adaptador al 30% menos mostraba
   * "margen 100%" cuando en realidad dejaba pérdida.
   */
  static costoParaComercio(producto, usuarioId = null) {
    if (!producto) return 0;
    const precioCosto = producto.precio_costo != null ? parseFloat(producto.precio_costo) : null;
    const precioBase = parseFloat(producto.precio_base) || 0;
    const esPropio = usuarioId != null && producto.creado_por != null && Number(producto.creado_por) === Number(usuarioId);
    if (esPropio && precioCosto != null) return precioCosto;
    if (usuarioId == null && precioCosto) return precioCosto;
    return precioBase;
  }

  static conMargen(ofertaInstancia, usuarioId = null) {
    const oferta = ofertaInstancia.toJSON();
    const costo = (oferta.componentes || []).reduce((acc, c) => {
      return acc + this.costoParaComercio(c.producto, usuarioId) * c.cantidad;
    }, 0);
    // El margen se calcula sobre el precio normal (canal de referencia).
    // El del bump va aparte: es el que más importa vigilar, porque es un
    // precio promocional y puede quedar por debajo del costo sin que se note.
    const precio = parseFloat(oferta.precio_normal ?? oferta.precio) || 0;
    const ganancia = precio - costo;
    oferta.costo = costo;
    oferta.ganancia = ganancia;
    oferta.margen_pct = precio > 0 ? Number(((ganancia / precio) * 100).toFixed(1)) : 0;

    const precioBump = oferta.precio_order_bump === null || oferta.precio_order_bump === undefined
      ? null : parseFloat(oferta.precio_order_bump) || 0;
    // Para la pantalla de administración: distinguir "existe" (activo) de
    // "está corriendo hoy" (vigente), que con fechas son cosas distintas.
    oferta.vigente = require('./pricing.service').ofertaVigente(oferta);
    oferta.ganancia_order_bump = precioBump !== null ? precioBump - costo : null;
    oferta.margen_order_bump_pct = precioBump > 0
      ? Number((((precioBump - costo) / precioBump) * 100).toFixed(1)) : null;
    return oferta;
  }

  static async obtener(ofertaId, inquilino_id, transaction) {
    const oferta = await Oferta.findOne({
      where: { id: ofertaId, inquilino_id },
      include: [{ model: OfertaComponente, as: 'componentes' }],
      transaction,
    });
    if (!oferta) throw new Error('Oferta no encontrada.');
    return oferta;
  }

  // Resuelve las referencias al producto que acaba de crearse dentro de
  // la misma transacción. Si falla una oferta, se revierte el alta completa.
  static async crearBorradores(productoId, borradores, inquilino_id, transaction) {
    try {
      if (!Array.isArray(borradores)) throw new Error('Las ofertas deben ser una lista.');
      const creadas = [];
      for (const borrador of borradores) {
        if (!borrador || !Array.isArray(borrador.componentes)) throw new Error('La oferta necesita sus componentes de stock.');
        const componentes = borrador.componentes.map(({ es_producto_actual, ...c }) => ({
          ...c, producto_id: es_producto_actual === true ? productoId : Number(c.producto_id),
        }));
        const ids = [...new Set(componentes.map(c => c.producto_id))];
        if (ids.some(id => !Number.isInteger(id) || id <= 0)) throw new Error('Cada componente necesita un producto válido.');
        const productos = await Producto.findAll({ where: { id: ids, inquilino_id, activo: true }, attributes: ['id'], transaction });
        // El producto nuevo puede guardarse inactivo; las referencias a
        // otros productos sí deben estar disponibles en este inquilino.
        const disponibles = new Set([productoId, ...productos.map(p => Number(p.id))]);
        if (ids.some(id => !disponibles.has(id))) throw new Error('Uno de los productos de la oferta no está disponible.');
        creadas.push(await this.crear(productoId, { ...borrador, componentes }, inquilino_id, transaction));
      }
      return creadas;
    } catch (err) {
      err.seccion = 'venta';
      throw err;
    }
  }

  static async crear(producto_ancla_id, payload, inquilino_id, transaction) {
    const precios = this.normalizarPrecios(payload);
    this.validarPayload({ ...payload, ...precios });
    const estrategia = payload.estrategia || 'normal';
    const tipoContenido = this.resolverTipoContenido(estrategia, payload.tipo_contenido);
    let componentes = await this.normalizarComponentes(payload.componentes, transaction);
    componentes = this.excluirAnclaDeBumpOUpsell(componentes, estrategia, producto_ancla_id);
    this.validarComponentesParaTipo(tipoContenido, producto_ancla_id, componentes);

    const oferta = await Oferta.create({
      inquilino_id,
      producto_ancla_id,
      codigo: payload.codigo.trim(),
      nombre: payload.nombre.trim(),
      tipo_contenido: tipoContenido,
      estrategia,
      ...precios,
      ...this.normalizarExtras(payload),
      descripcion: payload.descripcion?.trim() || null,
      beneficios: this.normalizarBeneficios(payload),
      activo: payload.activo === undefined ? true : !!payload.activo,
      orden: payload.orden || 0,
    }, { transaction });

    await OfertaComponente.bulkCreate(
      componentes.map(c => ({ ...c, oferta_id: oferta.id })),
      { transaction }
    );

    return this.obtener(oferta.id, inquilino_id, transaction);
  }

  static async actualizar(ofertaId, payload, inquilino_id, transaction) {
    const oferta = await Oferta.findOne({ where: { id: ofertaId, inquilino_id }, transaction });
    if (!oferta) throw new Error('Oferta no encontrada.');

    const precios = this.normalizarPrecios(payload, oferta);
    this.validarPayload({
      codigo: payload.codigo ?? oferta.codigo,
      nombre: payload.nombre ?? oferta.nombre,
      tipo_contenido: payload.tipo_contenido,
      estrategia: payload.estrategia,
      // Las fechas se validan una contra otra, así que hay que mirar la
      // combinación resultante y no solo lo que vino en este payload.
      fecha_inicio: payload.fecha_inicio !== undefined ? payload.fecha_inicio : oferta.fecha_inicio,
      fecha_fin: payload.fecha_fin !== undefined ? payload.fecha_fin : oferta.fecha_fin,
      ...precios,
    });

    const updates = {};
    if (payload.codigo !== undefined) updates.codigo = payload.codigo.trim();
    if (payload.nombre !== undefined) updates.nombre = payload.nombre.trim();
    if (payload.estrategia !== undefined) updates.estrategia = payload.estrategia;
    // Un cambio de estrategia puede arrastrar el tipo_contenido aunque el
    // payload no lo mencione (ver resolverTipoContenido).
    updates.tipo_contenido = this.resolverTipoContenido(
      payload.estrategia ?? oferta.estrategia, payload.tipo_contenido, oferta
    );
    // Los precios se reescriben siempre: normalizarPrecios ya arrastró los
    // valores actuales cuando el payload no los trae, y borrar
    // precio_order_bump al pasar la oferta a una estrategia que no es de
    // checkout es parte de lo que tiene que pasar.
    Object.assign(updates, precios, this.normalizarExtras(payload));
    if (payload.descripcion !== undefined) updates.descripcion = payload.descripcion?.trim() || null;
    if (payload.beneficios !== undefined) updates.beneficios = this.normalizarBeneficios(payload, oferta);
    if (payload.activo !== undefined) updates.activo = !!payload.activo;
    if (payload.orden !== undefined) updates.orden = payload.orden;

    // tipo_contenido y componentes pueden llegar en llamadas separadas —
    // hay que validar la combinación resultante contra lo que YA tiene la
    // oferta cuando uno de los dos no viene en este payload (ej.: pasar un
    // combo existente a "pack" sin reenviar componentes no debe dejar
    // guardado un pack con productos que no son el ancla).
    const tipoContenidoEfectivo = updates.tipo_contenido;
    const estrategiaEfectiva = payload.estrategia ?? oferta.estrategia;
    let componentesNuevos = payload.componentes !== undefined ? await this.normalizarComponentes(payload.componentes, transaction) : null;
    if (componentesNuevos !== null) {
      componentesNuevos = this.excluirAnclaDeBumpOUpsell(componentesNuevos, estrategiaEfectiva, oferta.producto_ancla_id);
    }
    const componentesParaValidar = componentesNuevos !== null
      ? componentesNuevos
      : (await OfertaComponente.findAll({ where: { oferta_id: oferta.id }, attributes: ['producto_id', 'cantidad'], transaction, raw: true }));
    this.validarComponentesParaTipo(tipoContenidoEfectivo, oferta.producto_ancla_id, componentesParaValidar);

    await oferta.update(updates, { transaction });

    if (componentesNuevos !== null) {
      await OfertaComponente.destroy({ where: { oferta_id: oferta.id }, transaction });
      await OfertaComponente.bulkCreate(
        componentesNuevos.map(c => ({ ...c, oferta_id: oferta.id })),
        { transaction }
      );
    }

    return this.obtener(oferta.id, inquilino_id, transaction);
  }

  /**
   * Baja lógica (activo=false) — nunca se borra en duro: pedidos históricos
   * referencian la oferta por oferta_id para trazabilidad, aunque el costo
   * real ya quedó snapshoteado aparte en EnvioItemComponente.
   */
  static async eliminar(ofertaId, inquilino_id, transaction) {
    const oferta = await Oferta.findOne({ where: { id: ofertaId, inquilino_id }, transaction });
    if (!oferta) throw new Error('Oferta no encontrada.');
    await oferta.update({ activo: false }, { transaction });
    return oferta;
  }
}

module.exports = OfertaService;
