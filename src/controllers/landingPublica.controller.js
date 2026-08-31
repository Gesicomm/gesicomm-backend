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

const { Landing, Tienda, Usuario } = require('../models');
const LandingService = require('../services/landing.service');
const MetaCapiService = require('../services/metaCapi.service');
const BuilderPublicPageService = require('../services/builderPublicPage.service');

const EVENTOS_PERMITIDOS = new Set(['Contact', 'AddToCart', 'InitiateCheckout', 'ViewContent', 'Lead']);
const MAX_CONTENT_IDS = 40;

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

    const resultado = await LandingService.obtenerPublica(tienda, req.params.slug || null, preview);
    if (resultado === null) {
      return res.status(404).json({ message: 'Landing no encontrada.' });
    }
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
    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[landing-publica] obtenerProducto:', err.message);
    return res.status(500).json({ message: 'Error al obtener el producto.' });
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
      ruc: limpiarTexto(body.ruc, 20),
      razon_social: limpiarTexto(body.razon_social, MAX_TEXTO_CORTO),
      quiere_factura: body.quiere_factura !== undefined ? Boolean(body.quiere_factura) : Boolean(body.ruc && String(body.ruc).trim()),
      telefono: limpiarTexto(body.telefono, 50),
      ciudad: limpiarTexto(body.ciudad, 100),
      departamento: limpiarTexto(body.departamento, 100),
      direccion: limpiarTexto(body.direccion, 255),
      referencia: limpiarTexto(body.referencia, MAX_TEXTO_LARGO),
      payment_method: limpiarTexto(body.payment_method, 50),
      items: Array.isArray(body.items) ? body.items.slice(0, 40).map(i => ({
        content_id: typeof i?.content_id === 'string' ? i.content_id.slice(0, 200) : null,
        variante_id: Number.isFinite(Number(i?.variante_id)) ? Number(i.variante_id) : undefined,
        oferta_id: Number.isFinite(Number(i?.oferta_id)) ? Number(i.oferta_id) : undefined,
        cantidad: i?.cantidad,
      })) : [],
    };

    const resultado = await LandingService.crearCheckout(tienda, req.params.slug || null, datosCliente);
    return res.status(201).json(resultado);
  } catch (err) {
    const status = err.status || (err.message?.includes('no encontrada') ? 404 : 400);
    console.error('[landing-publica] crearCheckout:', err.message);
    return res.status(status).json({ message: err.message || 'Error al crear el pedido.' });
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
    const catalogo = await LandingService.obtenerCatalogoParaEvento(landing_id);

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

module.exports = { obtenerPorSlug, obtenerProducto, registrarEvento, crearCheckout, recalcularCarrito };
