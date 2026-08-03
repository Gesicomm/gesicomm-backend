const crypto = require('crypto');
const SolicitudEliminacionService = require('../services/solicitudEliminacion.service');

/**
 * Tests del parseo del signed_request de Meta.
 *
 * Es la única autenticación que tiene el Data Deletion Callback: si la
 * verificación de firma se rompiera sin que nadie lo note, cualquiera podría
 * postear al endpoint y disparar el borrado de datos de terceros. Por eso
 * estos casos son unitarios y no tocan la base — corren siempre.
 */
describe('SolicitudEliminacionService.parsearSignedRequest', () => {
  const APP_SECRET = 'secreto-de-prueba-no-usar-en-produccion';

  /** Arma un signed_request válido igual que lo hace Meta. */
  const firmar = (payload, secret = APP_SECRET) => {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const firma = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
    return `${firma}.${payloadB64}`;
  };

  test('decodifica un signed_request correctamente firmado', () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '1234567890', issued_at: 1700000000 });

    const payload = SolicitudEliminacionService.parsearSignedRequest(signed, APP_SECRET);

    expect(payload.user_id).toBe('1234567890');
    expect(payload.algorithm).toBe('HMAC-SHA256');
  });

  test('rechaza un signed_request firmado con otro secreto', () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '1234567890' }, 'secreto-del-atacante');

    expect(() => SolicitudEliminacionService.parsearSignedRequest(signed, APP_SECRET))
      .toThrow('Firma del signed_request inválida.');
  });

  test('rechaza un payload manipulado que conserva la firma original', () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '1234567890' });
    const [firma] = signed.split('.');
    const payloadFalso = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '9999999999' }))
      .toString('base64url');

    expect(() => SolicitudEliminacionService.parsearSignedRequest(`${firma}.${payloadFalso}`, APP_SECRET))
      .toThrow('Firma del signed_request inválida.');
  });

  test('rechaza una firma de largo distinto sin romperse en timingSafeEqual', () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '1234567890' });
    const [, payloadB64] = signed.split('.');

    expect(() => SolicitudEliminacionService.parsearSignedRequest(`YWJj.${payloadB64}`, APP_SECRET))
      .toThrow('Firma del signed_request inválida.');
  });

  test('rechaza un signed_request sin punto separador', () => {
    expect(() => SolicitudEliminacionService.parsearSignedRequest('sin-punto', APP_SECRET))
      .toThrow('signed_request inválido.');
  });

  test('rechaza un payload válido pero sin user_id', () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', issued_at: 1700000000 });

    expect(() => SolicitudEliminacionService.parsearSignedRequest(signed, APP_SECRET))
      .toThrow('El signed_request no contiene user_id.');
  });

  test('falla explícitamente si el App Secret no está configurado', () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '1' });

    expect(() => SolicitudEliminacionService.parsearSignedRequest(signed, undefined))
      .toThrow('FACEBOOK_APP_SECRET no configurado en el servidor.');
  });
});

describe('SolicitudEliminacionService.calcularFechaLimite', () => {
  test('compromete 30 días desde la recepción', () => {
    const desde = new Date('2026-01-01T10:00:00Z');
    const limite = SolicitudEliminacionService.calcularFechaLimite(desde);

    const dias = Math.round((limite - desde) / (1000 * 60 * 60 * 24));
    expect(dias).toBe(30);
  });
});

describe('SolicitudEliminacionService.serializarPublico', () => {
  test('no expone datos personales en la vista pública de estado', () => {
    const solicitud = {
      codigo: 'abc123',
      estado: 'en_proceso',
      created_at: new Date(),
      fecha_limite: new Date(),
      procesada_en: null,
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
      motivo: 'Ya no uso el servicio',
      ip_solicitante: '203.0.113.10',
      notas_internas: 'Verificada por soporte',
    };

    const publico = SolicitudEliminacionService.serializarPublico(solicitud);

    expect(publico).not.toHaveProperty('nombre');
    expect(publico).not.toHaveProperty('email');
    expect(publico).not.toHaveProperty('motivo');
    expect(publico).not.toHaveProperty('ip_solicitante');
    expect(publico).not.toHaveProperty('notas_internas');
    expect(publico.codigo).toBe('abc123');
  });
});
