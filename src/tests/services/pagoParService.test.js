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

  it('debe validar la firma del webhook correctamente', () => {
    const privateKey = 'test_private';
    const tokenRecibido = crypto.createHash('sha1').update('test_privatePAGOPAR').digest('hex');
    
    expect(PagoParService.validateWebhookSignature(privateKey, tokenRecibido)).toBe(true);
    expect(PagoParService.validateWebhookSignature(privateKey, 'invalid')).toBe(false);
  });
});
