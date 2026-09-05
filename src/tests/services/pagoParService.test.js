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
});
