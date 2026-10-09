const crypto = require('crypto');

jest.mock('../models', () => ({
  SolicitudEliminacion: { findOne: jest.fn(), create: jest.fn() },
  Usuario: {},
  MetaIntegration: { findAll: jest.fn(), destroy: jest.fn() },
}));

const { SolicitudEliminacion, MetaIntegration } = require('../models');
const SolicitudEliminacionService = require('../services/solicitudEliminacion.service');

/**
 * Data Deletion Callback: cuando alguien quita la app desde Facebook, las
 * conexiones guardadas con su meta_user_id se tienen que borrar en el acto.
 * Unitario, con los modelos mockeados: no toca la base.
 */
describe('SolicitudEliminacionService.crearDesdeMetaCallback', () => {
  const APP_SECRET = 'secreto-de-prueba-no-usar-en-produccion';
  const firmar = (payload) => {
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const firma = crypto.createHmac('sha256', APP_SECRET).update(payloadB64).digest('base64url');
    return `${firma}.${payloadB64}`;
  };
  const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '555' });
  const contexto = { ip: '1.2.3.4', userAgent: 'facebookexternalhit' };

  beforeEach(() => {
    jest.clearAllMocks();
    SolicitudEliminacion.findOne.mockResolvedValue(null);
    SolicitudEliminacion.create.mockImplementation(async (datos) => datos);
  });

  test('borra las conexiones del usuario y la solicitud nace completada', async () => {
    MetaIntegration.findAll.mockResolvedValue([{ id: 7, usuario_id: 3, inquilino_id: 1 }]);

    await SolicitudEliminacionService.crearDesdeMetaCallback(signed, APP_SECRET, contexto);

    expect(MetaIntegration.destroy).toHaveBeenCalledWith({ where: { meta_user_id: '555' } });
    const datos = SolicitudEliminacion.create.mock.calls[0][0];
    expect(datos.estado).toBe('completada');
    expect(datos.usuario_id).toBe(3);
    expect(datos.procesada_en).toBeInstanceOf(Date);
    expect(datos.ip_solicitante).toBeNull();
    expect(datos.user_agent).toBeNull();
  });

  test('sin conexiones con ese meta_user_id queda recibida para revisión manual', async () => {
    MetaIntegration.findAll.mockResolvedValue([]);

    await SolicitudEliminacionService.crearDesdeMetaCallback(signed, APP_SECRET, contexto);

    expect(MetaIntegration.destroy).not.toHaveBeenCalled();
    const datos = SolicitudEliminacion.create.mock.calls[0][0];
    expect(datos.estado).toBe('recibida');
    expect(datos.procesada_en).toBeNull();
    expect(datos.ip_solicitante).toBe('1.2.3.4');
  });

  test('con firma inválida no borra nada', async () => {
    await expect(
      SolicitudEliminacionService.crearDesdeMetaCallback(signed, 'otro-secreto', contexto)
    ).rejects.toThrow('Firma del signed_request inválida.');

    expect(MetaIntegration.findAll).not.toHaveBeenCalled();
    expect(MetaIntegration.destroy).not.toHaveBeenCalled();
  });
});
