const PagoParService = require('../../services/payments/pagoParService');
const crypto = require('crypto');

describe('PagoParService', () => {
  it('debe generar el token correctamente según la especificación sha1', () => {
    const privateKey = 'test_private';
    const orderId = 'GES-100';
    const amount = 50000;

    const expectedToken = crypto.createHash('sha1').update('test_privateGES-10050000').digest('hex');
    const token = PagoParService.generateToken(privateKey, orderId, amount);
    
    expect(token).toBe(expectedToken);
  });

  // La firma del callback es sha1(private_key + hash_pedido). Este test
  // afirmaba sha1(private_key + "PAGOPAR"), que no es ninguna fórmula de
  // PagoPar — con eso todo callback real se rechazaba con 400.
  it('debe validar la firma del webhook con sha1(private_key + hash_pedido)', () => {
    const privateKey = 'test_private';
    const hashPedido = 'ad57c9c94f745fdd9bc9093bb4092976';
    const tokenRecibido = crypto.createHash('sha1').update(`${privateKey}${hashPedido}`).digest('hex');

    expect(PagoParService.validateWebhookSignature(privateKey, hashPedido, tokenRecibido)).toBe(true);
    expect(PagoParService.validateWebhookSignature(privateKey, hashPedido, 'invalid')).toBe(false);
    expect(PagoParService.validateWebhookSignature(privateKey, 'otro-hash', tokenRecibido)).toBe(false);
  });

  it('agrupa las formas internas en opciones visibles del checkout', () => {
    const opciones = PagoParService.obtenerOpcionesCheckout([
      { nombre: 'Pagos nacionales e internacionales con Mastercard y Visa', comision_porcentaje: 5.5 },
      { nombre: 'Acepta Visa, Mastercard, American Express, Cabal, Panal, Discover, Diners Club.', comision_porcentaje: 6.16 },
      { nombre: 'PIX vía QR', comision_porcentaje: 5.5 },
      { nombre: 'Pagá con la app de tu banco, financiera o cooperativa a través de un QR', comision_porcentaje: 6.16 },
      { nombre: 'Pago con transferencias bancarias. Los pagos se procesan de 08:30 a17:30 hs.', comision_porcentaje: 5.5 },
      { nombre: 'Utilice sus fondos de Tigo Money', comision_porcentaje: 5.5 },
      { nombre: 'Utilice sus fondos de Zimple', comision_porcentaje: 6.16 },
      { nombre: 'Acercándose a las bocas de pagos habilitadas luego de confirmar el pedido', comision_porcentaje: 6.05 },
      { nombre: 'Metodo tecnico no visible', comision_porcentaje: 9.99 },
    ]);

    expect(opciones).toEqual([
      { id: 'transferencia-bancaria', nombre: 'Transferencia bancaria PagoPar', comision_porcentaje: 5.5, metodos_count: 1 },
      { id: 'qr', nombre: 'Pago con QR', comision_porcentaje: 6.16, metodos_count: 2 },
      { id: 'tarjetas', nombre: 'Tarjetas de crédito/débito', comision_porcentaje: 6.16, metodos_count: 2 },
      { id: 'billeteras', nombre: 'Billeteras', comision_porcentaje: 6.16, metodos_count: 2 },
      { id: 'bocas-de-pago', nombre: 'Bocas de pago', comision_porcentaje: 6.05, metodos_count: 1 },
    ]);
  });
});
