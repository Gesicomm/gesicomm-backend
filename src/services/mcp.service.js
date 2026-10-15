'use strict';

/**
 * Servicio MCP de Gesicomm.
 * Expone contexto comercial, catálogo, validaciones y guardado seguro de código
 * para que agentes de IA (Claude Code, OpenAI Codex, Cursor) construyan y actualicen
 * landings en "Lienzo en blanco" respetando al 100% el motor comercial, carrito,
 * pedidos y píxeles de Gesicomm.
 */

const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Landing, LandingItem, Producto, ProductoImagen, Oferta, Tienda, LandingTemplate, Faq, Categoria } = require('../models');
const LandingSimpleService = require('./landingSimple.service');
const LandingCodigoService = require('./landingCodigo.service');
const AICodeValidator = require('./aiCodeValidator.service');
const { PROMPT_MAESTRO } = require('../utils/promptMaestroMcp');

class McpService {

  /**
   * Genera un token JWT de larga duración (30 días) para que Claude o Codex
   * se autentiquen con el MCP Server sin depender de cookies de navegador.
   */
  static generarTokenMCP(usuario, tiendaId) {
    if (!tiendaId) throw new Error('Se requiere una tienda activa para generar el token MCP.');
    const payload = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      permisos: usuario.permisos || ['gestionar_landing'],
      tenantId: usuario.tenantId,
      tiendaId: Number(tiendaId),
      tipo: 'mcp_access',
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
    return {
      token,
      tiendaId: Number(tiendaId),
      expiraEn: '30d',
    };
  }

  /**
   * Lista las landings de la tienda que usan Lienzo en Blanco (código libre).
   */
  static async listarLandings(tiendaId) {
    const landings = await Landing.findAll({
      where: { tienda_id: tiendaId },
      include: [
        {
          model: LandingTemplate,
          as: 'template',
          required: false,
        },
      ],
      order: [['id', 'DESC']],
    });

    return landings.map(l => {
      const content = l.content || {};
      const esLienzo = l.template?.slug === 'lienzo-blanco' || content.editor_type === 'code' || l.template?.kind === 'codigo';
      return {
        id: l.id,
        titulo: l.titulo || 'Sin título',
        slug: l.slug,
        activo: !!l.activo,
        es_home: !!l.es_home,
        es_lienzo_blanco: esLienzo,
        tipo_venta: content.venta?.tipo || 'catalogo',
        fecha_actualizacion: l.updated_at,
      };
    });
  }

  /**
   * Obtiene la radiografía comercial completa de la landing para que Claude / Codex
   * conozcan cada producto, sus ofertas, variantes, precios en Guaraníes y las
   * directivas obligatorias para que el motor de pedidos y píxel funcionen.
   */
  static async obtenerContextoComercial(landingId, tiendaId) {
    const landing = await LandingSimpleService.obtener(landingId, tiendaId);
    if (!landing) throw new Error('Landing no encontrada.');

    const tienda = await Tienda.findByPk(tiendaId);
    const content = landing.content || {};
    const venta = content.venta || {};

    // Obtener categorías activas de la tienda
    let categoriasDb = [];
    if (tienda?.inquilino_id) {
      categoriasDb = await Categoria.findAll({
        where: { inquilino_id: tienda.inquilino_id, activo: true },
        attributes: ['id', 'nombre', 'slug', 'parent_id'],
        order: [['nombre', 'ASC']],
      });
    }

    // Obtener productos asociados a la landing (limitado estrictamente a lo agregado por el comerciante)
    const itemsRaw = landing.items || [];
    const mapaLandingItems = new Map(itemsRaw.map(it => [Number(it.referencia_id), it]));
    const idsProductos = itemsRaw.filter(it => it.tipo === 'producto').map(it => Number(it.referencia_id));
    const idsCombos = itemsRaw.filter(it => it.tipo === 'combo').map(it => Number(it.referencia_id));
    
    let productosDb = [];
    const includeProducto = [
      { model: Oferta, as: 'ofertas', required: false },
      { model: ProductoImagen, as: 'imagenes', required: false },
      { model: Categoria, as: 'categoria', required: false, attributes: ['id', 'nombre', 'slug'] },
    ];

    if (idsProductos.length) {
      // Estrictamente los productos agregados a esta landing
      productosDb = await Producto.findAll({
        where: { id: { [Op.in]: idsProductos }, inquilino_id: tienda.inquilino_id, activo: true },
        include: includeProducto,
      });
    } else {
      // Si la landing no tiene items configurados todavía, se muestra el catálogo de la tienda
      productosDb = await Producto.findAll({
        where: { tienda_id: tiendaId, activo: true },
        include: includeProducto,
        limit: 12,
        order: [['id', 'DESC']],
      });
    }

    const productos = productosDb.map(p => {
      const pJson = p.toJSON ? p.toJSON() : p;
      const landingItem = mapaLandingItems.get(Number(p.id));
      const ofertasRaw = pJson.ofertas || [];
      const bumps = ofertasRaw.filter(o => o.estrategia === 'order_bump');
      const paquetes = ofertasRaw.filter(o => o.estrategia === 'normal');
      const upsells = ofertasRaw.filter(o => o.estrategia === 'upsell');

      const imagenesOrdenadas = (pJson.imagenes || [])
        .sort((a, b) => (b.es_principal ? 1 : 0) - (a.es_principal ? 1 : 0) || (a.orden || 0) - (b.orden || 0))
        .map(img => img.url)
        .filter(Boolean);
      const imagenPrincipal = imagenesOrdenadas[0] || pJson.imagen || null;

      const precioVenta = Number(p.precio_usuario || p.precio_base || p.precio || 0);
      const precioAntes = landingItem?.precio_ancla 
        ? Number(landingItem.precio_ancla) 
        : (p.precio_tachado ? Number(p.precio_tachado) : null);
      const descuentoPct = (precioAntes && precioAntes > precioVenta)
        ? Math.round((1 - precioVenta / precioAntes) * 100)
        : 0;

      return {
        id: p.id,
        content_id: `producto-${p.id}`,
        nombre: p.nombre,
        descripcion: p.descripcion_corta || p.descripcion_larga || p.descripcion || '',
        precio_venta_gs: precioVenta,
        precio_antes_gs: precioAntes,
        descuento_porcentaje: descuentoPct,
        etiqueta: landingItem?.etiqueta || null,
        mostrar_en_inicio: landingItem ? landingItem.mostrar_en_inicio !== false : true,
        envio_incluido: landingItem?.envio_incluido === true,
        imagen_principal: imagenPrincipal,
        imagenes: imagenesOrdenadas.length ? imagenesOrdenadas : (imagenPrincipal ? [imagenPrincipal] : []),
        categoria: pJson.categoria ? { id: pJson.categoria.id, nombre: pJson.categoria.nombre, slug: pJson.categoria.slug } : null,
        tiene_variantes: Array.isArray(p.variantes) && p.variantes.length > 0,
        variantes: (p.variantes || []).map(v => ({
          id: v.id,
          nombre: v.nombre,
          precio_adicional_gs: Number(v.precio || 0),
          stock: v.stock,
        })),
        order_bumps: bumps.map(b => ({
          id: b.id,
          titulo: b.nombre || b.titulo,
          precio_gs: Number(b.precio_order_bump || b.precio_normal || b.precio || 0),
          precio_antes_gs: Number(b.precio_normal || 0) || null,
          descripcion: b.descripcion,
          imagen: b.imagen_url || null,
        })),
        paquetes_cantidad: paquetes.map(pq => ({
          id: pq.id,
          cantidad: pq.cantidad || 1,
          titulo: pq.nombre || pq.titulo,
          precio_total_gs: Number(pq.precio_normal || pq.precio || 0),
          descuento_porcentaje: pq.descuento_porcentaje || null,
        })),
      };
    });

    const contratoMotorComercial = {
      regla_oro: 'NO programes carritos ni checkout en JS. Solo usá las directivas data-gesicomm-* y el runtime de Gesicomm procesará pedidos, inventario, PagoPar y Meta Pixel automáticamente.',
      moneda: 'PYG (Guaraníes paraguayos)',
      directivas_carrito_pedidos: {
        comprar_y_abrir_checkout: 'data-gesicomm-comprar (colocar en botones principales de compra. Al clickear, agrega al carrito y abre el checkout)',
        agregar_silencioso: 'data-gesicomm-agregar (colocar en tarjetas de catálogo donde el cliente puede seguir navegando)',
        order_bump: 'data-gesicomm-bump (colocar en <input type="checkbox" data-gesicomm-bump> dentro del contenedor de la oferta bump)',
        variante_selector: 'data-gesicomm-variante="ID" o data-gesicomm-lista="variantes" (para que el cliente seleccione talle o color antes de comprar)',
        cantidad_input: 'data-gesicomm-cantidad-input (input numérico para elegir cantidad)',
        total_dinamico: 'data-gesicomm-total (elemento que muestra el total recalculado en Guaraníes)',
      },
      directivas_binds_datos: {
        precio: 'data-gesicomm-bind="precio" (reemplaza por el precio real formateado en Guaraníes)',
        precio_antes: 'data-gesicomm-bind="precio_antes" (precio tachado si existe descuento)',
        ahorro: 'data-gesicomm-bind="ahorro" (calcula automáticamente "Ahorrás Gs X")',
        nombre: 'data-gesicomm-bind="nombre" (título del producto)',
        imagen: 'data-gesicomm-bind="imagen" (asigna el src a la imagen del producto)',
      },
      tracking_y_pixel: {
        eventos_automaticos: 'El runtime dispara automáticamente ViewContent al entrar, AddToCart al hacer clic en comprar/agregar, InitiateCheckout al abrir checkout y Purchase al completar el pedido.',
        evento_personalizado: 'data-gesicomm-evento="NombreDelEvento" (para registrar clicks en CTAs secundarios o consultas).',
      },
      directivas_categorias_y_banners: {
        filtrar_por_categoria: 'data-gesicomm-lista="productos" data-gesicomm-categoria="NOMBRE_O_SLUG" (muestra solo productos de esa categoría, ej: data-gesicomm-categoria="Accesorios Tech")',
        navegar_a_categoria: 'data-gesicomm-categoria-ir="NOMBRE_O_SLUG" (colocar en banners, links de navegación o tarjetas de categoría para llevar al cliente a esa vista)',
      },
      restriccion_estricta_productos: 'ESTRICTO: Solo podés usar y mostrar los productos listados en "productos". NO inventes productos ficticios ni agregues combos o artículos de afuera que no existan en la lista "productos". Si mostrás ofertas o descuentos, usá los productos que tienen precio_antes_gs y descuento_porcentaje > 0.',
      diseno_cro_recomendado: {
        enfoque: 'Mobile-first (390px ancho base). Las compras en Paraguay se hacen un 95% desde smartphones.',
        componentes_clave: [
          'Sticky CTA bar inferior en mobile con botón Comprar ahora',
          'Bloque de beneficios con iconos (Envío a todo el país, Pago contra entrega, Garantía)',
          'Badges llamativos de descuento y urgencia moderada',
          'Selector visual de variantes con pills táctiles',
          'Sección de prueba social / testimonios de clientes verificados',
          'Acordeón FAQ con respuestas a dudas de envíos y pagos',
        ],
      },
    };

    return {
      landing: {
        id: landing.id,
        titulo: landing.titulo,
        slug: landing.slug,
        activo: landing.activo,
        tipo_venta: venta.tipo || 'catalogo',
        generado_por_ia: Boolean(landing.content?.generado_por_ia || landing.content?.origen === 'mcp'),
        bloques_inicio_bloqueados: Boolean(landing.content?.bloques_inicio_bloqueados),
      },
      tienda: {
        id: tienda?.id,
        nombre: tienda?.nombre,
        slug: tienda?.slug,
        whatsapp: tienda?.whatsapp || '',
        colores: {
          primario: tienda?.color_primario || '#2563eb',
          fondo: tienda?.color_fondo || '#ffffff',
          texto: tienda?.color_texto || '#111827',
        },
      },
      configuracion_comercial: {
        seleccion: venta.seleccion || 'todos',
        banners: venta.inicio?.banners || venta.inicio_comercial?.banners || [],
        banners_intermedios: venta.inicio?.banners_intermedios || venta.inicio_comercial?.banners_intermedios || [],
        secciones_inicio: venta.inicio?.secciones || venta.inicio_comercial?.secciones || [],
        urgencia: venta.urgencia || null,
        cross_sell: venta.cross_sell || null,
      },
      categorias: categoriasDb.map(c => ({
        id: c.id,
        nombre: c.nombre,
        slug: c.slug,
        parent_id: c.parent_id,
      })),
      productos,
      contrato_motor_comercial: contratoMotorComercial,
      prompt_maestro_gesicomm: PROMPT_MAESTRO,
    };
  }

  /**
   * Obtiene el código actual de la vista seleccionada.
   */
  static async obtenerCodigo(landingId, tiendaId, vista = 'inicio', contentId = null) {
    const landing = await LandingSimpleService.obtener(landingId, tiendaId);
    if (!landing) throw new Error('Landing no encontrada.');

    const content = landing.content || {};
    const vistas = content.vistas || {};

    if (vista === 'inicio') {
      return {
        vista: 'inicio',
        codigo: content.codigo || { html: '', css: '', js: '' },
      };
    }

    if (vista === 'producto' && contentId) {
      const propia = vistas.productos?.[contentId];
      if (propia) return { vista: `propia:${contentId}`, codigo: propia };
    }

    if (vistas[vista]) {
      return {
        vista,
        codigo: vistas[vista],
      };
    }

    return {
      vista,
      codigo: { html: '', css: '', js: '' },
    };
  }

  /**
   * Valida que el código HTML respete el motor comercial de Gesicomm antes de guardarlo.
   */
  static validarMotorComercial(html, vista = 'inicio') {
    const texto = String(html || '');
    const errores = [];
    const advertencias = [];
    const sugerencias = [];

    // Chequeo de CTA obligatorio para que funcione el carrito
    const tieneComprar = /data-gesicomm-comprar/.test(texto);
    const tieneAgregar = /data-gesicomm-agregar/.test(texto);

    if (!tieneComprar && !tieneAgregar) {
      errores.push('Falta el botón de compra: El HTML debe contener al menos un elemento con "data-gesicomm-comprar" o "data-gesicomm-agregar" para que el visitante pueda comprar, entrar al carrito y activar el Píxel de Meta.');
    }

    // Chequeo de scripts invasivos
    if (/<script\b[^>]*>(?![\s\S]*<\/script>)[\s\S]*/i.test(texto) || /onclick\s*=\s*["'][^"']*window\.location/i.test(texto)) {
      advertencias.push('Se detectaron scripts o manejadores onclick invasivos. Los scripts inline serán removidos por seguridad; usá las directivas data-gesicomm-* nativas.');
    }

    // Chequeo de precios hardcodeados vs dinámicos
    if (/Gs\s*[0-9]{2,3}\.?[0-9]{3}/i.test(texto) && !/data-gesicomm-bind=["']precio["']/.test(texto)) {
      sugerencias.push('Detectamos precios escritos en texto fijo. Te recomendamos usar data-gesicomm-bind="precio" para que el precio siempre coincida con el catálogo de Gesicomm.');
    }

    // Chequeo de order bump
    if (/data-gesicomm-lista=["']ofertas_bump["']/.test(texto) && !/data-gesicomm-bump/.test(texto)) {
      errores.push('La sección de Order Bump no tiene la casilla con el atributo data-gesicomm-bump.');
    }

    // Chequeo de botón flotante de WhatsApp duplicado
    if (/whatsapp/i.test(texto) && /fixed/i.test(texto) && (/(?:bottom|right)/i.test(texto))) {
      advertencias.push('Detectamos un botón flotante de WhatsApp con position: fixed. Gesicomm ya inyecta automáticamente el botón oficial de WhatsApp en la esquina inferior. Te recomendamos remover tu botón flotante propio para evitar que se superpongan en pantalla.');
    }

    return {
      valido: errores.length === 0,
      errores,
      advertencias,
      sugerencias,
    };
  }

  /**
   * Valida y guarda el código HTML/CSS/JS generado por Claude o Codex en la landing.
   */
  static async guardarCodigo(landingId, tiendaId, inquilinoId, { vista = 'inicio', html, css = '', js = '', contentId = null }) {
    const landing = await LandingSimpleService.buscarPropia(landingId, tiendaId);
    if (!landing) throw new Error('Landing no encontrada.');

    // 1. Validar motor comercial
    const validacion = this.validarMotorComercial(html, vista);
    if (!validacion.valido) {
      const err = new Error('El código no cumple con los requisitos del motor comercial de Gesicomm.');
      err.errores = validacion.errores;
      err.advertencias = validacion.advertencias;
      throw err;
    }

    // 2. Sanitizar con el sanitizador oficial de Gesicomm
    const codigoLimpio = LandingCodigoService.sanitizar({ html, css, js });

    // 3. Preparar payload de actualización y marcar como generado por IA / MCP
    const content = JSON.parse(JSON.stringify(landing.content || {}));
    const vistas = content.vistas || {};

    codigoLimpio.generado_por_mcp = true;

    if (vista === 'inicio') {
      content.codigo = codigoLimpio;
    } else if (vista === 'producto' && contentId) {
      if (!vistas.productos) vistas.productos = {};
      vistas.productos[contentId] = codigoLimpio;
      content.vistas = vistas;
    } else {
      vistas[vista] = codigoLimpio;
      content.vistas = vistas;
    }

    content.generado_por_ia = true;
    content.origen = 'mcp';
    content.bloques_inicio_bloqueados = true;

    // 4. Persistir a través de LandingSimpleService
    const landingActualizada = await LandingSimpleService.actualizarCodigo(
      landing,
      tiendaId,
      inquilinoId,
      {
        codigo: content.codigo,
        vistas: content.vistas,
        generado_por_ia: true,
        origen: 'mcp',
        bloques_inicio_bloqueados: true,
      }
    );

    return {
      ok: true,
      landing_id: landingActualizada.id,
      vista,
      advertencias: validacion.advertencias,
      sugerencias: validacion.sugerencias,
      mensaje: `Vista "${vista}" actualizada y conectada exitosamente al motor comercial de Gesicomm.`,
    };
  }
}

module.exports = McpService;
