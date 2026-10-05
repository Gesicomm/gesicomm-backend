const crypto = require('crypto');
const axios = require('axios');

class PagoParService {
  /**
   * Saca el motivo legible de una respuesta de PagoPar.
   *
   * `resultado` no tiene forma estable: a veces es un array de objetos
   * ([{ datos: "..." }]), a veces un array de strings, y a veces un string
   * suelto — por ejemplo "Comercio de desarrollo no habilitado o con acceso
   * vencido.". Leerlo siempre como array hacía que `resultado[0]` fuera la
   * primera LETRA del mensaje, `.datos` diera undefined, y el motivo real se
   * perdiera detrás de un "Error desconocido".
   */
  static motivoDeRespuesta(data) {
    const r = data?.resultado;
    if (typeof r === 'string' && r.trim()) return r.trim();
    if (Array.isArray(r) && r.length) {
      const primero = r[0];
      if (typeof primero === 'string') return primero;
      return primero?.datos || primero?.mensaje || null;
    }
    return null;
  }

  static numeroDesdePagoPar(valor) {
    if (valor === null || valor === undefined) return 0;
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
    const limpio = String(valor)
      .replace('%', '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '');
    const n = Number(limpio);
    return Number.isFinite(n) ? n : 0;
  }

  static normalizarFormaPago(item = {}) {
    const comision = [
      item.comision_porcentaje,
      item.porcentaje_comision,
      item.comision_pct,
      item.comision,
      item.arancel,
      item.arancel_porcentaje,
      item.costo_porcentaje,
    ].map(PagoParService.numeroDesdePagoPar).find(n => n > 0) || 0;

    return {
      id: item.id || item.id_forma_pago || item.forma_pago || item.codigo || item.nombre || item.descripcion,
      nombre: item.nombre || item.descripcion || item.forma_pago || item.metodo || item.medio_pago || 'Metodo PagoPar',
      comision_porcentaje: comision,
      crudo: item,
    };
  }

  static normalizarTexto(valor) {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  static categoriaCheckout(metodo = {}) {
    const nombre = PagoParService.normalizarTexto(metodo.nombre);

    if (nombre.includes('transferencia')) {
      return { id: 'transferencia-bancaria', nombre: 'Transferencia bancaria PagoPar' };
    }
    if (nombre.includes('qr') || nombre.includes('pix')) {
      return { id: 'qr', nombre: 'Pago con QR' };
    }
    if (/(tarjeta|mastercard|visa|american express|cabal|panal|discover|diners)/.test(nombre)) {
      return { id: 'tarjetas', nombre: 'Tarjetas de crédito/débito' };
    }
    if (/(zimple|tigo money|personal pay|pago movil|wally|billetera claro|billetera|fondos)/.test(nombre)) {
      return { id: 'billeteras', nombre: 'Billeteras' };
    }
    if (/(boca|acercandose|pagos habilitadas)/.test(nombre)) {
      return { id: 'bocas-de-pago', nombre: 'Bocas de pago' };
    }

    return null;
  }

  static obtenerOpcionesCheckout(metodos = []) {
    const orden = ['transferencia-bancaria', 'qr', 'tarjetas', 'billeteras', 'bocas-de-pago'];
    const grupos = new Map();

    for (const metodo of metodos) {
      const categoria = PagoParService.categoriaCheckout(metodo);
      if (!categoria) continue;

      const actual = grupos.get(categoria.id) || {
        ...categoria,
        comision_porcentaje: 0,
        metodos_count: 0,
      };
      grupos.set(categoria.id, {
        ...actual,
        comision_porcentaje: Math.max(actual.comision_porcentaje, Number(metodo.comision_porcentaje) || 0),
        metodos_count: actual.metodos_count + 1,
      });
    }

    return orden.map(id => grupos.get(id)).filter(Boolean);
  }

  /**
   * Genera el token (hash SHA1) requerido por PagoPar para iniciar una transacción.
   * sha1(comercio_token_privado + id_pedido + strval(floatval(monto_total)))
   */
  static generateToken(privateKey, orderId, amount) {
    const amountStr = String(parseFloat(amount));
    const data = `${privateKey}${orderId}${amountStr}`;
    return crypto.createHash('sha1').update(data).digest('hex');
  }

  /**
   * Valida la firma de un webhook entrante de PagoPar.
   *
   *   sha1(comercio_token_privado + hash_pedido)
   *
   * Antes acá se hacía sha1(private_key + "PAGOPAR"), una fórmula que NO
   * existe en la documentación de PagoPar — parece una confusión con
   * sha1(private_key + "FORMA-PAGO"), que es la del endpoint de medios de
   * pago (/api/forma-pago/1.1/traer/), no la del callback. Con la fórmula
   * vieja el token nunca coincidía y TODO callback real se rechazaba con
   * 400, así que ningún pago llegaba a confirmarse.
   */
  static validateWebhookSignature(privateKey, hashPedido, tokenReceived) {
    if (!privateKey || !hashPedido || !tokenReceived) return false;
    const expectedToken = crypto.createHash('sha1').update(`${privateKey}${hashPedido}`).digest('hex');
    // timingSafeEqual pide buffers del mismo largo: si el recibido no mide
    // como un sha1 hex, ya sabemos que no coincide.
    const recibido = Buffer.from(String(tokenReceived), 'utf8');
    const esperado = Buffer.from(expectedToken, 'utf8');
    if (recibido.length !== esperado.length) return false;
    return crypto.timingSafeEqual(recibido, esperado);
  }

  /**
   * Paso #3 del flujo de PagoPar: consultar el estado de un pedido.
   *
   *   POST https://api.pagopar.com/api/pedidos/1.1/traer
   *   token = sha1(comercio_token_privado + "CONSULTA")
   *   body  = { hash_pedido, token, token_publico }
   *
   * Ojo con los nombres: los endpoints 1.1 esperan `token_publico`, mientras
   * que el 2.0 (iniciar-transaccion) usa `public_key`. No son intercambiables.
   *
   * Sirve para dos cosas: cerrar el paso 3 que PagoPar exige para habilitar
   * producción, y reconciliar a mano un pedido cuyo callback se haya perdido.
   *
   * @returns {{ pagado: boolean, datos: Object|null }}
   */
  static async consultarEstadoPedido(gateway, hashPedido) {
    if (!gateway?.private_key || !gateway?.public_key) {
      throw new Error('La pasarela del comercio no está configurada correctamente.');
    }
    if (!hashPedido) {
      throw new Error('Falta el hash_pedido a consultar.');
    }

    const token = crypto.createHash('sha1').update(`${gateway.private_key}CONSULTA`).digest('hex');

    let response;
    try {
      response = await axios.post('https://api.pagopar.com/api/pedidos/1.1/traer', {
        hash_pedido: hashPedido,
        token,
        token_publico: gateway.public_key,
      });
    } catch (error) {
      const detalle = PagoParService.motivoDeRespuesta(error.response?.data)
        || error.response?.data?.message
        || error.message
        || 'No se pudo conectar con PagoPar.';
      throw new Error(detalle);
    }

    if (!response.data?.respuesta) {
      // `resultado` puede venir como array de objetos o como string suelto
      // (ej: "Comercio de desarrollo no habilitado o con acceso vencido.").
      // Leerlo siempre como array hacía que `resultado[0]` fuera la primera
      // LETRA del mensaje y el motivo real se perdiera.
      const detalle = PagoParService.motivoDeRespuesta(response.data) || 'PagoPar rechazó la consulta.';
      throw new Error(detalle);
    }

    const datos = Array.isArray(response.data.resultado) ? response.data.resultado[0] : null;
    return {
      pagado: datos?.pagado === true || datos?.pagado === 'true',
      datos: datos || null,
    };
  }

  /**
   * Lista las formas de pago habilitadas en PagoPar y normaliza su comision.
   */
  static async obtenerFormasPago(gateway) {
    if (!gateway?.private_key || !gateway?.public_key) {
      throw new Error('La pasarela del comercio no está configurada correctamente.');
    }

    const token = crypto.createHash('sha1').update(`${gateway.private_key}FORMA-PAGO`).digest('hex');
    let response;
    try {
      response = await axios.post('https://api.pagopar.com/api/forma-pago/1.1/traer/', {
        token,
        token_publico: gateway.public_key,
      });
    } catch (error) {
      const detalle = PagoParService.motivoDeRespuesta(error.response?.data)
        || error.response?.data?.message
        || error.message
        || 'No se pudo consultar las formas de pago de PagoPar.';
      throw new Error(detalle);
    }

    if (!response.data?.respuesta) {
      const detalle = PagoParService.motivoDeRespuesta(response.data) || 'PagoPar rechazó la consulta de formas de pago.';
      throw new Error(detalle);
    }

    const resultado = Array.isArray(response.data.resultado) ? response.data.resultado : [];
    return resultado
      .map(item => PagoParService.normalizarFormaPago(item))
      .filter(item => item.nombre);
  }

  /**
   * Retorna datos del comercio de PagoPar, incluyendo porcentaje de comisión
   * general y, cuando está disponible, comisiones por forma de pago.
   */
  static async obtenerDatosComercio(gateway) {
    if (!gateway?.private_key || !gateway?.public_key) {
      throw new Error('La pasarela del comercio no está configurada correctamente.');
    }

    const token = crypto.createHash('sha1').update(`${gateway.private_key}DATOS-COMERCIO`).digest('hex');
    let response;
    try {
      response = await axios.post('https://api.pagopar.com/api/comercios/2.0/datos-comercio/', {
        token,
        public_key: gateway.public_key,
      });
    } catch (error) {
      const detalle = PagoParService.motivoDeRespuesta(error.response?.data)
        || error.response?.data?.message
        || error.message
        || 'No se pudo consultar los datos del comercio en PagoPar.';
      throw new Error(detalle);
    }

    if (!response.data?.respuesta) {
      const detalle = PagoParService.motivoDeRespuesta(response.data) || 'PagoPar rechazó la consulta de datos del comercio.';
      throw new Error(detalle);
    }

    return response.data.resultado || {};
  }

  /**
   * Inicia una transacción en PagoPar.
   * @param {Object} gateway - Instancia de PaymentGateway con credenciales.
   * @param {Object} envio - Instancia del modelo Envio (pedido de Gesicomm).
   * @param {string} returnUrl - URL de retorno luego de completarse el pago.
   * @returns {Object} Respuesta de PagoPar con el hash y detalles de redirección.
   */
  static async createTransaction(gateway, envio, returnUrl) {
    // API endpoint según entorno
    // Asumimos que la API usa la misma URL base para sandbox si las claves son las que definen el entorno
    // Según documentación (que buscamos), el endpoint es:
    const endpoint = 'https://api.pagopar.com/api/comercios/2.0/iniciar-transaccion';
    
    // Id de pedido del comercio. Va pelado (el id del Envio, que ya es un
    // autoincremental único): antes se prefijaba "GES-" y solo agregaba
    // ruido. Lo que autentica el callback es la firma, no el formato del id.
    const orderId = String(envio.id);
    const orderLabel = String(envio.numero_pedido || envio.id);
    
    // Se cobra el `monto` y nada más: el delivery no se le carga al
    // comprador. El checkout público le muestra ese mismo número (subtotal −
    // cupón), así que sumarle acá el flete le cobraba Gs de más respecto de
    // lo que aceptó en pantalla — y de lo que queda registrado en el pedido.
    // El costo del courier vive aparte, en `costo_envio`, para el arqueo.
    const amount = envio.monto;

    // `documento` lo exige el comercio de PagoPar segun su configuracion: el
    // de la tienda acepta pedidos sin documento, el del sistema (el que cobra
    // abastecimiento y suscripciones) responde "El documento debe estar
    // presente.". Por eso NO se bloquea aca: se manda lo que haya y decide
    // PagoPar. El que necesite documento tiene que proveerlo en su flujo.
    const documento = String(envio.documento || envio.ruc || '').trim();

    const token = this.generateToken(gateway.private_key, orderId, amount);

    // Mapeo de items. El array va como `compras_items` (NO
    // "compras_articulos", que no existe: PagoPar respondia
    // `Faltan campos en el json. ["compras_items"]`).
    //
    // Obligatorios por item segun la doc: nombre, id_producto, precio_total.
    // El resto se manda vacio/por defecto porque no tenemos equivalente:
    // `categoria` y `ciudad` son catalogos de PagoPar que no mapeamos, y los
    // campos `vendedor_*` son para marketplaces multi-vendedor.
    const armarItem = (nombre, cantidad, precioTotal, idProducto) => ({
      ciudad: '1',
      nombre,
      cantidad,
      categoria: '909',
      public_key: gateway.public_key,
      url_imagen: '',
      descripcion: nombre,
      id_producto: idProducto,
      precio_total: precioTotal,
      vendedor_telefono: '',
      vendedor_direccion: '',
      vendedor_direccion_referencia: '',
      vendedor_direccion_coordenadas: '',
    });

    let items = [];
    if (envio.items && envio.items.length > 0) {
      items = envio.items.map((item, i) => armarItem(
        item.nombre_producto || 'Producto',
        item.cantidad || 1,
        item.subtotal || amount,
        // id_producto es obligatorio: se usa el del producto y, si el item no
        // lo tiene (ej. una oferta armada), su posicion como ultimo recurso.
        item.producto_id || item.id || (i + 1),
      ));
    } else {
      items = [armarItem(`Pedido ${orderLabel}`, 1, amount, envio.id)];
    }

    const payload = {
      token: token,
      comprador: {
        ruc: envio.ruc || '',
        email: envio.email || 'cliente@sin-email.com',
        nombre: envio.cliente || 'Cliente',
        telefono: envio.telefono || '',
        documento, // validado arriba: nunca vacio
        coordenadas: '',
        razon_social: envio.razon_social || envio.cliente || '',
        tipo_documento: 'CI',
        direccion: envio.direccion || '',
        ciudad: envio.ciudad || '1',
        direccion_referencia: envio.referencia || ''
      },
      public_key: gateway.public_key,
      monto_total: amount,
      tipo_pedido: 'VENTA-COMERCIO',
      compras_items: items,
      fecha_maxima_pago: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19), // +24hs formato YYYY-MM-DD HH:mm:ss
      id_pedido_comercio: orderId,
      descripcion_resumen: envio.descripcion_resumen || `Pago de pedido ${orderLabel}`,
    };

    try {
      const response = await axios.post(endpoint, payload);
      
      if (!response.data.respuesta) {
        // HTTP 200 pero PagoPar rechazo el pedido. El cuerpo crudo va al log
        // porque es la unica forma de diagnosticar un rechazo nuevo.
        console.error('[PagoParService] PagoPar rechazo la transaccion:', JSON.stringify(response.data));
        const motivo = PagoParService.motivoDeRespuesta(response.data);
        throw new Error(motivo || 'Error desconocido al crear transacción en PagoPar');
      }

      return {
        success: true,
        hash_pedido: response.data.resultado[0].data,
        // El link de pago es https://www.pagopar.com/pagos/[hash]
        payment_url: `https://www.pagopar.com/pagos/${response.data.resultado[0].data}`
      };
    } catch (error) {
      const cuerpo = error.response?.data;
      console.error('[PagoParService] Error al iniciar transacción:', cuerpo || error.message);

      // Propagar el motivo REAL de PagoPar. Antes se tiraba siempre el mismo
      // texto genérico, y como más arriba el checkout se lo traga y cae a
      // WhatsApp, un cobro rechazado terminaba siendo indistinguible de un
      // pedido normal: nadie se enteraba de por qué no se podía pagar.
      const motivo = PagoParService.motivoDeRespuesta(cuerpo) || error.message;

      throw new Error(
        motivo ? `No se pudo iniciar la transacción con PagoPar: ${motivo}` : 'No se pudo iniciar la transacción con PagoPar',
      );
    }
  }
}

module.exports = PagoParService;
