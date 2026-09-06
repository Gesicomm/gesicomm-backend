const crypto = require('crypto');
const axios = require('axios');

class PagoParService {
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

    const response = await axios.post('https://api.pagopar.com/api/pedidos/1.1/traer', {
      hash_pedido: hashPedido,
      token,
      token_publico: gateway.public_key,
    });

    if (!response.data?.respuesta) {
      // `resultado` puede venir como array de objetos o como string suelto
      // (ej: "Comercio de desarrollo no habilitado o con acceso vencido.").
      // Leerlo siempre como array hacía que `resultado[0]` fuera la primera
      // LETRA del mensaje y el motivo real se perdiera.
      const r = response.data?.resultado;
      const detalle = (typeof r === 'string' && r.trim())
        || (Array.isArray(r) && (typeof r[0] === 'string' ? r[0] : r[0]?.datos || r[0]?.mensaje))
        || 'PagoPar rechazó la consulta.';
      throw new Error(detalle);
    }

    const datos = Array.isArray(response.data.resultado) ? response.data.resultado[0] : null;
    return {
      pagado: datos?.pagado === true || datos?.pagado === 'true',
      datos: datos || null,
    };
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
    
    // Id único de comercio
    const orderId = `GES-${envio.id}`;
    
    // Total
    const amount = envio.monto + (envio.costo_envio || 0);

    const token = this.generateToken(gateway.private_key, orderId, amount);

    // Mapeo de items
    let items = [];
    if (envio.items && envio.items.length > 0) {
      items = envio.items.map(item => ({
        nombre: item.nombre_producto || 'Producto',
        cantidad: item.cantidad || 1,
        precio_total: item.subtotal || amount
      }));
    } else {
      items = [{
        nombre: `Pedido ${orderId}`,
        cantidad: 1,
        precio_total: amount
      }];
    }

    const payload = {
      token: token,
      comprador: {
        ruc: envio.ruc || '',
        email: 'cliente@sin-email.com', // Gesicomm no requiere email obligatoriamente en checkout
        nombre: envio.cliente || 'Cliente',
        telefono: envio.telefono || '',
        documento: envio.ruc || '', // Si no hay doc, usar ruc o vacío
        coordenadas: '',
        razon_social: envio.razon_social || envio.cliente || '',
        tipo_documento: 'CI',
        direccion: envio.direccion || 'Sin dirección',
        ciudad: envio.ciudad ? 1 : 1 // Idealmente mapear ID de ciudad de PagoPar
      },
      public_key: gateway.public_key,
      monto_total: amount,
      tipo_pedido: 'VENTA-COMERCIO',
      compras_articulos: items,
      fecha_maxima_pago: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19), // +24hs formato YYYY-MM-DD HH:mm:ss
      id_pedido_comercio: orderId,
      descripcion_resumen: `Pago de pedido ${orderId}`,
    };

    try {
      const response = await axios.post(endpoint, payload);
      
      if (!response.data.respuesta) {
        throw new Error(response.data.resultado[0]?.datos || 'Error desconocido al crear transacción en PagoPar');
      }

      return {
        success: true,
        hash_pedido: response.data.resultado[0].data,
        // El link de pago es https://www.pagopar.com/pagos/[hash]
        payment_url: `https://www.pagopar.com/pagos/${response.data.resultado[0].data}`
      };
    } catch (error) {
      console.error('[PagoParService] Error al iniciar transacción:', error.response?.data || error.message);
      throw new Error('No se pudo iniciar la transacción con PagoPar');
    }
  }
}

module.exports = PagoParService;
