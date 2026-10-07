'use strict';

/**
 * Controller público de Landings — sin autenticación. La Tienda ya viene
 * resuelta en req.tienda por middleware/resolverTienda (por hostname).
 *
 * GET  /api/l/:slug          → landing puntual de la tienda del hostname actual.
 * GET  /api/l/                → landing es_home de la tienda del hostname actual.
 * POST /api/l/:slug/eventos   → evento de conversión (Meta CAPI), ver metaCapi.service.js.
 * POST /api/l/eventos         → ídem, para la landing es_home.
 * POST /api/l/:slug/checkout  → crea un Envío (Pedido) real, ver landing.service.js#crearCheckout.
 * POST /api/l/checkout        → ídem, para la landing es_home.
 * POST /api/l/:slug/carrito   → recálculo de carrito en vivo (solo lectura), ver landing.service.js#recalcularCarrito.
 * POST /api/l/carrito         → ídem, para la landing es_home.
 */

const { Envio, EnvioItem, Landing, PaymentGateway, PaymentTransaction, Tienda, Usuario } = require('../models');
const LandingService = require('../services/landing.service');
const MetaCapiService = require('../services/metaCapi.service');
const BuilderPublicPageService = require('../services/builderPublicPage.service');
const PagoParService = require('../services/payments/pagoParService');
const { confirmarPedidoPagado } = require('../services/payments/confirmacionPago');
const RedFulfillmentService = require('../services/redFulfillment.service');

const EVENTOS_PERMITIDOS = new Set(['PageView', 'Contact', 'AddToCart', 'InitiateCheckout', 'ViewContent', 'Lead']);
const MAX_CONTENT_IDS = 40;
const TIPOS_PAGINA_PUBLICA = new Set([
  'contacto',
  'catalogo',
  'politica_privacidad',
  'politica_reembolso',
  'terminos_servicio',
  'politica_envio',
  'aviso_legal',
]);

function tipoPaginaPublica(valor) {
  const normalizado = String(valor || '').trim().toLowerCase().replace(/-/g, '_');
  return TIPOS_PAGINA_PUBLICA.has(normalizado) ? normalizado : null;
}

/**
 * Marca la respuesta como cacheable por el CDN. La landing pública se
 * reconstruía desde la base en CADA visita: con esto un HIT de borde no toca
 * Node.
 *
 * `s-maxage` habla al CDN y `max-age=0` al navegador, que así revalida y
 * aprovecha el ETag débil de Express (304 sin cuerpo). `stale-while-revalidate`
 * evita que al vencer el TTL una ráfaga de visitas caiga toda junta sobre el
 * origen: el borde sirve lo viejo y refresca por detrás.
 *
 * NUNCA cachear el preview. `preview` sale de la cookie accessToken de la
 * dueña (ver obtenerPorSlug) y muestra contenido no publicado — si entrara al
 * cache compartido, el borde se lo serviría a cualquier visitante. Por eso el
 * preview se marca `private, no-store` de forma explícita en vez de confiar en
 * que la regla del CDN excluya las requests con cookie.
 *
 * Solo GET: un POST (/buscar) no lo cachea ningún CDN.
 */
function aplicarCacheDeBorde(req, res, { preview, disponible }) {
  if (req.method !== 'GET') return;
  if (preview) {
    res.set('Cache-Control', 'private, no-store');
    return;
  }
  // Una tienda caída o pausada se cachea poco: que vuelva rápido cuando se
  // reactiva, pero sin dejar a Node atendiendo cada visita mientras está así.
  const sMaxAge = disponible ? 60 : 30;
  res.set('Cache-Control', `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=300`);
}

async function resolverTiendaYLanding(req) {
  let tienda = req.tienda;
  let landing_id = null;
  const slug = req.params.slug || null;

  if (tienda) {
    landing_id = await LandingService.obtenerIdParaEvento(tienda, slug);
    return { tienda, landing_id };
  }

  // Fallback si req.tienda es null (ej: localhost / testing directo por slug)
  if (slug) {
    const l = await Landing.findOne({
      where: { slug },
      include: [{
        model: Tienda,
        include: [{ model: Usuario, attributes: ['id', 'activo'] }],
      }],
    });
    if (l && l.Tienda) {
      return { tienda: l.Tienda, landing_id: l.activo ? l.id : null };
    }
  }

  return { tienda: null, landing_id: null };
}

async function obtenerPorSlug(req, res) {
  try {
    let tienda = req.tienda;
    if (!tienda && req.params.slug) {
      const l = await Landing.findOne({
        where: { slug: req.params.slug },
        include: [{
          model: Tienda,
          include: [{ model: Usuario, attributes: ['id', 'activo'] }],
        }],
      });
      if (l && l.Tienda) tienda = l.Tienda;
    }

    if (!tienda) {
      // *.gesicomm.com ya no es exclusivo de las tiendas: ahí también
      // viven los subdominios del Page Builder (calcula.gesicomm.com).
      // Se resuelve acá, en la MISMA request, y no con un endpoint aparte
      // que el SPA tendría que consultar primero: eso le agregaría una
      // vuelta de red a cada visita de tienda, que son las que hoy tienen
      // tráfico real.
      const registro = await BuilderPublicPageService.resolverHostname(req.hostname);
      if (registro) {
        try {
          const pagina = await BuilderPublicPageService.porHostname(registro, req.params.slug || null);
          return res.json({ tipo: 'builder', disponible: true, ...pagina });
        } catch (err) {
          return res.status(err.status || 404).json({
            message: err.message,
            tipo: 'builder',
            en_construccion: !!err.enConstruccion,
          });
        }
      }

      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    let preview = false;
    const token = req.cookies?.accessToken;
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key-12345');
        // Si el usuario dueño del tenant es el mismo de la tienda
        if (payload.tenantId === tienda.usuario_id) {
          preview = true;
        }
      } catch (e) {
        // Token inválido, se procesa como público normal
      }
    }

    // Support both GET (for initial load) and POST (for search/filtering)
    const options = req.method === 'POST' ? req.body : req.query;
    const vista = String(options.vista || '').toLowerCase();
    
    // For POST /buscar route, we always assume vista=catalogo
    const isCatalogo = vista === 'catalogo' || req.path.endsWith('/buscar');
    
    const tipoPagina = tipoPaginaPublica(options.tipo_pagina || options.tipoPagina || options.pagina_tipo);

    const resultado = isCatalogo
      ? await LandingService.obtenerCatalogoPublico(tienda, req.params.slug || null, preview, {
          pagina: options.pagina,
          porPagina: options.porPagina,
          orden: options.orden,
          disponibilidad: options.disponibilidad,
          categoria: options.categoria,
          marca: options.marca,
          etiqueta: options.etiqueta,
          precioMin: options.precioMin,
          precioMax: options.precioMax,
          soloInicio: options.soloInicio === true || options.soloInicio === 'true',
          busqueda: typeof options.busqueda === 'string' ? options.busqueda : (typeof options.q === 'string' ? options.q : ''),
        })
      : await LandingService.obtenerPublica(tienda, req.params.slug || null, preview, { tipoPagina });
    if (resultado === null) {
      return res.status(404).json({ message: 'Landing no encontrada.' });
    }
    aplicarCacheDeBorde(req, res, { preview, disponible: resultado.disponible !== false });
    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[landing-publica] obtenerPorSlug:', err.message);
    return res.status(500).json({ message: 'Error al obtener la landing.' });
  }
}

async function obtenerProducto(req, res) {
  try {
    let tienda = req.tienda;
    if (!tienda && req.params.slug) {
      const l = await Landing.findOne({
        where: { slug: req.params.slug },
        include: [{
          model: Tienda,
          include: [{ model: Usuario, attributes: ['id', 'activo'] }],
        }],
      });
      if (l && l.Tienda) tienda = l.Tienda;
    }

    if (!tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    const resultado = await LandingService.obtenerProductoPublico(
      tienda,
      req.params.slug || null,
      req.params.productoSlug
    );
    if (resultado === null) {
      return res.status(404).json({ message: 'Producto no encontrado.' });
    }
    // Esta ruta no tiene rama de preview (no lee la cookie de la dueña), así
    // que su respuesta es siempre la pública y se puede cachear sin más.
    aplicarCacheDeBorde(req, res, { preview: false, disponible: resultado.disponible !== false });
    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[landing-publica] obtenerProducto:', err.message);
    return res.status(500).json({ message: 'Error al obtener el producto.' });
  }
}

/**
 * Departamentos y ciudades de Paraguay (catálogo compartido, no por
 * inquilino) para el selector de dirección del checkout propio del lienzo —
 * el mismo catálogo que ya usa Courier → Nuevo pedido, pero público porque
 * acá no hay sesión: es el cliente completando su propia dirección.
 */
async function geografia(req, res) {
  try {
    const resultado = await RedFulfillmentService.catalogoGeografico({ conCiudades: true });
    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[landing-publica] geografia:', err.message);
    return res.status(500).json({ message: 'Error al obtener el catálogo geográfico.' });
  }
}

/**
 * El nombre de producto que se guarda nunca sale del cliente: se resuelve
 * contra el catálogo real de la landing. /eventos es público y sin auth, y su
 * payload termina renderizado en "productos más consultados" del panel de la
 * dueña de la tienda — sin esto, cualquiera podía llenarle las estadísticas
 * de productos inventados.
 *
 * El sufijo de variante se conserva solo si esa variante existe de verdad en
 * ese producto: "Remera (XL)" sigue funcionando, "Remera (lo que sea)" cae al
 * nombre canónico.
 */
function nombreCanonico(content_id, nombreCliente, catalogo) {
  const entrada = catalogo.get(content_id);
  if (!entrada) return null;
  if (typeof nombreCliente === 'string') {
    const conVariante = nombreCliente.match(/^(.*) \((.+)\)$/);
    if (conVariante && conVariante[1] === entrada.nombre && entrada.variantes.has(conVariante[2])) {
      return nombreCliente;
    }
  }
  return entrada.nombre;
}

/**
 * Blindaje de custom_data antes de reenviarlo a la Graph API: solo se
 * aceptan las claves que Meta espera para este tipo de evento, con tipos y
 * tamaños acotados. Todo lo demás en el body se descarta en silencio — es
 * un endpoint público de escritura, nunca se reenvía JSON arbitrario del
 * cliente tal cual.
 *
 * @param {Map} catalogo - ver LandingService.obtenerCatalogoParaEvento.
 */
function limpiarCustomData(custom_data, catalogo) {
  if (!custom_data || typeof custom_data !== 'object') return undefined;
  const limpio = {};

  if (Array.isArray(custom_data.content_ids)) {
    const ids = custom_data.content_ids.filter(id => catalogo.has(id)).slice(0, MAX_CONTENT_IDS);
    if (ids.length) limpio.content_ids = ids;
  }
  // content_name NO se toma del cliente: se deriva de los content_ids que sí
  // existen en la landing. Ver nombreCanonico().
  if (limpio.content_ids?.length === 1) {
    limpio.content_name = nombreCanonico(limpio.content_ids[0], custom_data.content_name, catalogo);
  } else if (limpio.content_ids?.length > 1) {
    limpio.content_name = `Carrito (${limpio.content_ids.length} productos)`;
  }
  if (custom_data.content_type === 'product' || custom_data.content_type === 'product_group') {
    limpio.content_type = custom_data.content_type;
  }
  if (Number.isFinite(custom_data.value)) {
    limpio.value = Math.max(0, Math.min(999999999, Math.round(custom_data.value)));
  }
  if (typeof custom_data.currency === 'string') {
    limpio.currency = custom_data.currency.slice(0, 10);
  }
  if (Number.isFinite(custom_data.num_items)) {
    limpio.num_items = Math.max(1, Math.min(999, Math.trunc(custom_data.num_items)));
  }

  return Object.keys(limpio).length ? limpio : undefined;
}

/**
 * event_source_url lo manda un visitante anónimo: viaja a la Graph API y
 * queda guardado tal cual en LandingEvento.payload. Hoy no se renderiza en
 * ningún lado (estadisticas() solo devuelve agregados), pero guardar un
 * esquema arbitrario es dejar armado un XSS almacenado para el día que el
 * panel liste eventos crudos con un enlace clickeable. El valor legítimo es
 * siempre window.location.href de una landing https.
 */
function limpiarUrlOrigen(url) {
  if (typeof url !== 'string') return null;
  const limpio = url.trim().slice(0, 500);
  return /^https?:\/\//i.test(limpio) ? limpio : null;
}

/**
 * Detalle por producto de un checkout de carrito o agregado — NO se manda a la Graph
 * API de Meta (custom_data ya cumple el schema de Meta por su cuenta), se
 * guarda solo en LandingEvento.payload para que estadisticas() pueda
 * calcular "productos más consultados" con más de un producto por evento.
 */
function limpiarItems(items, catalogo) {
  if (!Array.isArray(items)) return undefined;
  const limpio = items
    // Antes alcanzaba con mandar un `nombre` cualquiera. Ahora el item tiene
    // que existir en la landing: lo que no está en el catálogo se descarta.
    .filter(i => i && catalogo.has(i.content_id))
    .slice(0, MAX_CONTENT_IDS)
    .map(i => ({
      content_id: i.content_id,
      nombre: nombreCanonico(i.content_id, i.nombre, catalogo),
      cantidad: Number.isFinite(i.cantidad) ? Math.max(1, Math.min(999, Math.trunc(i.cantidad))) : 1,
      // precio sigue viniendo del cliente (acotado, pero no verificado contra
      // el catálogo): recalcularlo acá exigiría duplicar toda la resolución de
      // precios de obtenerPublica (PrecioUsuario + precio_minimo + delta de
      // variante). Impacto acotado a valor_carritos de las estadísticas, que
      // ya es una métrica de intención y no de venta confirmada.
      precio: Number.isFinite(i.precio) ? Math.max(0, Math.min(999999999, Math.round(i.precio))) : null,
    }));
  return limpio.length ? limpio : undefined;
}

const MAX_TEXTO_CORTO = 150;
const MAX_TEXTO_LARGO = 300;

/** Recorta y descarta si no es string — mismo criterio que limpiarUrlOrigen para campos de texto libre del checkout público. */
function limpiarTexto(valor, maxLen) {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim().slice(0, maxLen);
  return limpio || null;
}

/**
 * Checkout público — crea un Envío (Pedido) real en estado "Pendiente".
 * Toda la resolución de precio/stock/pertenencia a la landing vive en
 * LandingService.crearCheckout(); acá solo se sanea el texto libre del
 * body antes de pasarlo (mismo espíritu que limpiarCustomData/limpiarItems
 * para /eventos: nunca se reenvía el body del cliente tal cual).
 */
async function crearCheckout(req, res) {
  try {
    const { tienda } = await resolverTiendaYLanding(req);
    if (!tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    const body = req.body || {};
    const datosCliente = {
      nombre_cliente: limpiarTexto(body.nombre_cliente, MAX_TEXTO_CORTO),
      documento: limpiarTexto(body.documento, 30),
      ruc: limpiarTexto(body.ruc, 20),
      razon_social: limpiarTexto(body.razon_social, MAX_TEXTO_CORTO),
      quiere_factura: body.quiere_factura !== undefined ? Boolean(body.quiere_factura) : Boolean(body.ruc && String(body.ruc).trim()),
      telefono: limpiarTexto(body.telefono, 50),
      ciudad: limpiarTexto(body.ciudad, 100),
      departamento: limpiarTexto(body.departamento, 100),
      direccion: limpiarTexto(body.direccion, 255),
      referencia: limpiarTexto(body.referencia, MAX_TEXTO_LARGO),
      payment_method: limpiarTexto(body.payment_method, 50),
      // El cupon se re-valida contra la BD en LandingService.crearCheckout; aca solo se sanea.
      cupon_codigo: limpiarTexto(body.cupon_codigo, 40),
      // Atribución: el carrito los manda desde la primera visita (ver
      // capturarUtm en useStoreCart). Antes se descartaban acá y todo pedido
      // de landing quedaba sin campaña aunque las columnas existieran.
      utm_source: limpiarTexto(body.utm_source, 100),
      utm_medium: limpiarTexto(body.utm_medium, 100),
      utm_campaign: limpiarTexto(body.utm_campaign, 100),
      items: Array.isArray(body.items) ? body.items.slice(0, 40).map(i => ({
        content_id: typeof i?.content_id === 'string' ? i.content_id.slice(0, 200) : null,
        variante_id: Number.isFinite(Number(i?.variante_id)) ? Number(i.variante_id) : undefined,
        oferta_id: Number.isFinite(Number(i?.oferta_id)) ? Number(i.oferta_id) : undefined,
        // Variante elegida por el cliente para el componente "elegible" del
        // bump/upsell de esta línea (ver Oferta/OfertaComponente
        // .permite_elegir_variante) — se re-valida contra esa oferta y ese
        // producto en LandingService.resolverCarrito, acá solo se sanea el tipo.
        componente_variante_id: Number.isFinite(Number(i?.componente_variante_id)) ? Number(i.componente_variante_id) : undefined,
        cantidad: i?.cantidad,
      })) : [],
    };

    const contexto = {
      client_ip: req.ip,
      client_user_agent: req.headers['user-agent'] || null,
      fbc: typeof body.fbc === 'string' ? body.fbc.slice(0, 200) : (req.cookies?._fbc || null),
      fbp: typeof body.fbp === 'string' ? body.fbp.slice(0, 200) : (req.cookies?._fbp || null),
      event_source_url: limpiarUrlOrigen(body.event_source_url),
    };
    const resultado = await LandingService.crearCheckout(tienda, req.params.slug || null, datosCliente, contexto);
    return res.status(201).json(resultado);
  } catch (err) {
    const status = err.status || (err.message?.includes('no encontrada') ? 404 : 400);
    console.error('[landing-publica] crearCheckout:', err.message);
    return res.status(status).json({ message: err.message || 'Error al crear el pedido.' });
  }
}

/**
 * Recorta la respuesta de PagoPar antes de exponerla en un endpoint PUBLICO.
 *
 * El objeto crudo de PagoPar trae `token` —que es sha1(private_key +
 * hash_pedido), o sea lo MISMO que nuestro webhook acepta como prueba de
 * autenticidad— y `documento`, la cedula del comprador. Devolverlo entero
 * permitia que cualquiera con el hash (que viaja en la URL de retorno del
 * comprador) leyera el token y falsificara un callback marcando el pedido
 * como pagado. Por eso se listan los campos permitidos en vez de filtrar los
 * prohibidos: si PagoPar agrega un campo sensible manana, no se filtra solo.
 */
function datosPublicosPagopar(datos) {
  if (!datos || typeof datos !== 'object') return null;
  return {
    pagado: datos.pagado === true || datos.pagado === 'true',
    cancelado: datos.cancelado === true || datos.cancelado === 'true',
    monto: datos.monto ?? null,
    forma_pago: datos.forma_pago ?? null,
    fecha_pago: datos.fecha_pago ?? null,
    fecha_maxima_pago: datos.fecha_maxima_pago ?? null,
    ultimo_mensaje_error: datos.ultimo_mensaje_error ?? null,
  };
}

async function resultadoPago(req, res) {
  try {
    const { tienda } = await resolverTiendaYLanding(req);
    if (!tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    const hash = limpiarTexto(req.params.hash, 200);
    if (!hash) {
      return res.status(400).json({ message: 'Falta el hash del pedido.' });
    }

    const transaction = await PaymentTransaction.findOne({
      where: { provider: 'pagopar', payment_hash: hash },
    });
    if (!transaction) {
      return res.status(404).json({ message: 'No encontramos una transacción de PagoPar para esta tienda.' });
    }

    const envio = await Envio.findByPk(transaction.envio_id, {
      include: [{ model: EnvioItem, as: 'items' }],
    });
    if (!envio || envio.usuario_id !== tienda.usuario_id) {
      return res.status(404).json({ message: 'No encontramos una transacción de PagoPar para esta tienda.' });
    }

    const gateway = await PaymentGateway.findOne({
      where: { usuario_id: tienda.usuario_id, provider: 'pagopar' },
    });
    if (!gateway || !gateway.private_key || !gateway.public_key) {
      return res.status(400).json({ message: 'La pasarela de PagoPar de esta tienda no está configurada.' });
    }

    const consulta = await PagoParService.consultarEstadoPedido(gateway, hash);
    let reconciliacion = 'sin_cambios';
    if (consulta.pagado) {
      reconciliacion = await confirmarPedidoPagado(envio, transaction, { origen: 'PagoPar (retorno tienda)', req });
    }

    return res.status(200).json({
      success: true,
      pagado: consulta.pagado,
      pedido_id: envio.id,
      numero_pedido: envio.numero_pedido,
      monto: envio.monto,
      estado_pedido: envio.estado,
      estado_transaccion: transaction.status,
      reconciliacion,
      // Saneado: nunca el objeto crudo (ver datosPublicosPagopar).
      pagopar: datosPublicosPagopar(consulta.datos),
    });
  } catch (err) {
    console.error('[landing-publica] resultadoPago:', err.response?.data || err.message);
    return res.status(400).json({ message: err.message || 'No se pudo consultar el resultado del pago.' });
  }
}

/**
 * Recálculo de carrito en vivo — SOLO LECTURA, nunca crea un Envío. Mismo
 * saneo de items que crearCheckout, sin los datos personales del cliente
 * (acá no hace falta un formulario completo, solo qué hay en el carrito).
 * Toda la resolución de precio vive en LandingService.recalcularCarrito(),
 * que reusa el mismo PricingService que ve el visitante y que cobra el
 * checkout final — nunca una segunda implementación del cálculo.
 */
async function recalcularCarrito(req, res) {
  try {
    const { tienda } = await resolverTiendaYLanding(req);
    if (!tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items.slice(0, 40).map(i => ({
      content_id: typeof i?.content_id === 'string' ? i.content_id.slice(0, 200) : null,
      variante_id: Number.isFinite(Number(i?.variante_id)) ? Number(i.variante_id) : undefined,
      oferta_id: Number.isFinite(Number(i?.oferta_id)) ? Number(i.oferta_id) : undefined,
      componente_variante_id: Number.isFinite(Number(i?.componente_variante_id)) ? Number(i.componente_variante_id) : undefined,
      cantidad: i?.cantidad,
    })) : [];

    const resultado = await LandingService.recalcularCarrito(tienda, req.params.slug || null, items);
    return res.status(200).json(resultado);
  } catch (err) {
    const status = err.status || (err.message?.includes('no encontrada') ? 404 : 400);
    console.error('[landing-publica] recalcularCarrito:', err.message);
    return res.status(status).json({ message: err.message || 'Error al recalcular el carrito.' });
  }
}

/**
 * Valida un cupón contra el carrito y devuelve cuánto descontaría. NO lo
 * consume: el uso se registra recién cuando el pedido se crea de verdad
 * (ver LandingService.crearCheckout), así probar un código diez veces no
 * gasta las diez.
 *
 * El descuento se recalcula del lado del servidor en el checkout: lo que
 * devuelve acá es para mostrar, nunca es lo que termina cobrándose.
 */
async function validarCupon(req, res) {
  try {
    const { tienda } = await resolverTiendaYLanding(req);
    if (!tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items.slice(0, 40).map(i => ({
      content_id: typeof i?.content_id === 'string' ? i.content_id.slice(0, 200) : null,
      variante_id: Number.isFinite(Number(i?.variante_id)) ? Number(i.variante_id) : undefined,
      oferta_id: Number.isFinite(Number(i?.oferta_id)) ? Number(i.oferta_id) : undefined,
      componente_variante_id: Number.isFinite(Number(i?.componente_variante_id)) ? Number(i.componente_variante_id) : undefined,
      cantidad: i?.cantidad,
    })) : [];

    const resultado = await LandingService.validarCupon(
      tienda,
      req.params.slug || null,
      String(body.codigo || '').slice(0, 40),
      items
    );
    return res.status(200).json(resultado);
  } catch (err) {
    // El motivo del rechazo ("vencido", "no aplica a tus productos") es
    // justamente lo que el comprador necesita leer, así que va tal cual.
    console.error('[landing-publica] validarCupon:', err.message);
    return res.status(400).json({ message: err.message || 'No se pudo aplicar el cupón.' });
  }
}

async function registrarEvento(req, res) {
  try {
    const { tienda, landing_id } = await resolverTiendaYLanding(req);
    if (!tienda) {
      return res.status(404).json({ message: 'Este dominio no corresponde a ninguna tienda.' });
    }

    const { event_name, event_id, event_source_url, fbc, fbp, custom_data, items } = req.body || {};

    if (!EVENTOS_PERMITIDOS.has(event_name)) {
      return res.status(400).json({ message: 'event_name inválido.' });
    }
    if (typeof event_id !== 'string' || !event_id.trim() || event_id.length > 100) {
      return res.status(400).json({ message: 'event_id inválido.' });
    }

    if (!landing_id) {
      return res.status(404).json({ message: 'Landing no encontrada.' });
    }

    // Un evento cuyos items no existen en la landing igual se registra (el
    // conteo de conversiones sigue siendo válido), pero sin detalle de
    // producto — no se descarta entero para no perder eventos legítimos de
    // alguien que tenía la landing abierta cuando se editó el catálogo.
    const contentIdsEvento = [
      ...(Array.isArray(custom_data?.content_ids) ? custom_data.content_ids : []),
      ...(Array.isArray(items) ? items.map(i => i?.content_id) : []),
    ].filter(id => typeof id === 'string').slice(0, MAX_CONTENT_IDS);
    const catalogo = await LandingService.obtenerCatalogoParaEvento(landing_id, contentIdsEvento);

    // Nunca bloquea la respuesta al visitante por un fallo de Meta — ver
    // metaCapi.service.js, enviarEvento() no rechaza.
    const resultado = await MetaCapiService.enviarEvento(tienda, {
      landing_id,
      event_name,
      event_id: event_id.trim(),
      event_source_url: limpiarUrlOrigen(event_source_url),
      client_ip: req.ip,
      client_user_agent: req.headers['user-agent'] || null,
      fbc: typeof fbc === 'string' ? fbc.slice(0, 200) : (req.cookies?._fbc || null),
      fbp: typeof fbp === 'string' ? fbp.slice(0, 200) : (req.cookies?._fbp || null),
      custom_data: limpiarCustomData(custom_data, catalogo),
      items: limpiarItems(items, catalogo),
    });

    return res.status(202).json({ ok: true, enviado_capi: resultado.enviado });
  } catch (err) {
    console.error('[landing-publica] registrarEvento:', err.message);
    // 202 igual: el pixel de navegador ya disparó, no tiene sentido que el
    // visitante vea un error por algo que no lo afecta.
    return res.status(202).json({ ok: false });
  }
}

/**
 * Registra una visita a la landing.
 *
 * Vive en un POST propio y no en /eventos porque una visita no es un evento de
 * Meta: /eventos valida contra EVENTOS_PERMITIDOS y reenvía a la CAPI.
 *
 * Antes la visita se contaba con un INSERT dentro del GET público. Eso ataba
 * cada visita a un hit en Node, así que cachear ese GET en el CDN (que es el
 * objetivo: el GET reconstruía la landing desde la base en cada visita) habría
 * dejado de contar todos los HIT en silencio. Contándola desde el navegador el
 * GET queda cacheable. Efecto lateral buscado: los bots que no ejecutan JS
 * dejan de contar como visita — antes sí lo hacían, era un límite conocido.
 *
 * Siempre 202: el visitante nunca ve un error por un fallo de tracking.
 */
async function registrarVisitaPublica(req, res) {
  try {
    const { tienda, landing_id } = await resolverTiendaYLanding(req);
    if (!tienda || !landing_id) return res.status(202).json({ ok: false });
    LandingService.registrarVisita(landing_id);
    return res.status(202).json({ ok: true });
  } catch (err) {
    console.error('[landing-publica] registrarVisitaPublica:', err.message);
    return res.status(202).json({ ok: false });
  }
}

module.exports = { obtenerPorSlug, obtenerProducto, registrarEvento, registrarVisitaPublica, crearCheckout, recalcularCarrito, validarCupon, resultadoPago, geografia };
