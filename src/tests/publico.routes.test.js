const crypto = require('crypto');

/**
 * Tests de integración HTTP de las rutas públicas.
 *
 * Los modelos se simulan a propósito: estas rutas se sirven SIN
 * autenticación —es lo que exige Meta para el pedido de eliminación de
 * datos— y lo que hay que verificar acá es la cadena de middlewares
 * (validación, honeypot, límite de tasa) y el contrato de la respuesta, no
 * si Sequelize escribe en Postgres. Además evita abrir un pool contra la
 * base de desarrollo, que vive detrás de un túnel SSH.
 */
jest.mock('../models', () => {
  const registros = [];
  return {
    sequelize: { define: jest.fn() },
    SolicitudEliminacion: {
      findOne: jest.fn().mockResolvedValue(null),
      findByPk: jest.fn().mockResolvedValue(null),
      findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
      create: jest.fn(async (datos) => {
        const registro = { ...datos, id: registros.length + 1, created_at: new Date() };
        registros.push(registro);
        return registro;
      }),
    },
    Usuario: {
      findOne: jest.fn().mockResolvedValue({ id: 1, correo_electronico: 'ana@example.com', inquilino_id: 1 }),
    },
    MensajeContacto: {
      findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
      create: jest.fn(async (datos) => ({ ...datos, id: 1, created_at: new Date() })),
    },
  };
});

const express = require('express');
const request = require('supertest');
const { SolicitudEliminacion, Usuario, MensajeContacto } = require('../models');

const APP_SECRET = 'secreto-de-prueba-no-usar-en-produccion';

function crearApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/publico', require('../routes/publico'));
  return app;
}

/** Arma un signed_request válido igual que lo hace Meta. */
function firmar(payload, secret = APP_SECRET) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${firma}.${payloadB64}`;
}

describe('POST /api/publico/eliminacion-datos', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    SolicitudEliminacion.findOne.mockResolvedValue(null);
    Usuario.findOne.mockResolvedValue({ id: 1, correo_electronico: 'ana@example.com', inquilino_id: 1 });
    app = crearApp();
  });

  const solicitudValida = {
    nombre: 'Ana Pérez',
    email: 'Ana@Example.COM',
    empresa: 'Tienda Ejemplo',
    motivo: 'Ya no uso el servicio',
    confirmacion: true,
  };

  test('registra una solicitud válida y devuelve código y URL de estado', async () => {
    const res = await request(app).post('/api/publico/eliminacion-datos').send(solicitudValida);

    expect(res.status).toBe(201);
    expect(res.body.solicitud.codigo).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body.url_estado).toContain(`/data-deletion/estado/${res.body.solicitud.codigo}`);
    expect(SolicitudEliminacion.create).toHaveBeenCalledTimes(1);
  });

  test('normaliza el email a minúsculas antes de guardarlo', async () => {
    await request(app).post('/api/publico/eliminacion-datos').send(solicitudValida);

    expect(SolicitudEliminacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@example.com' })
    );
  });

  test('la respuesta pública no expone datos personales del solicitante', async () => {
    const res = await request(app).post('/api/publico/eliminacion-datos').send(solicitudValida);

    const serializado = JSON.stringify(res.body);
    expect(serializado).not.toContain('ana@example.com');
    expect(serializado).not.toContain('Ana Pérez');
  });

  test('rechaza con 404 si el email no pertenece a ninguna cuenta registrada', async () => {
    Usuario.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/publico/eliminacion-datos')
      .send(solicitudValida);

    expect(res.status).toBe(404);
    expect(res.body.message).toContain('No encontramos ninguna cuenta');
    expect(SolicitudEliminacion.create).not.toHaveBeenCalled();
  });

  test('rechaza un email inválido con 400 y no toca la base', async () => {
    const res = await request(app)
      .post('/api/publico/eliminacion-datos')
      .send({ ...solicitudValida, email: 'no-es-un-email' });

    expect(res.status).toBe(400);
    expect(res.body.errores.some((e) => e.campo === 'email')).toBe(true);
    expect(SolicitudEliminacion.create).not.toHaveBeenCalled();
  });

  test('exige la confirmación explícita de que la eliminación es permanente', async () => {
    const res = await request(app)
      .post('/api/publico/eliminacion-datos')
      .send({ ...solicitudValida, confirmacion: false });

    expect(res.status).toBe(400);
    expect(SolicitudEliminacion.create).not.toHaveBeenCalled();
  });

  test('el honeypot descarta el envío de un bot sin delatar la detección', async () => {
    const res = await request(app)
      .post('/api/publico/eliminacion-datos')
      .send({ ...solicitudValida, sitio_web: 'http://spam.example' });

    // Responde 201 como un envío legítimo para no darle al bot la señal de
    // que fue detectado, pero no persiste nada.
    expect(res.status).toBe(201);
    expect(SolicitudEliminacion.create).not.toHaveBeenCalled();
  });

  test('reutiliza la solicitud abierta en vez de duplicarla', async () => {
    SolicitudEliminacion.findOne.mockResolvedValue({
      codigo: 'abc123def456abc123def456',
      estado: 'recibida',
      created_at: new Date(),
      fecha_limite: new Date(),
      procesada_en: null,
    });

    const res = await request(app).post('/api/publico/eliminacion-datos').send(solicitudValida);

    expect(res.status).toBe(200);
    expect(res.body.solicitud.codigo).toBe('abc123def456abc123def456');
    expect(SolicitudEliminacion.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/publico/eliminacion-datos/:codigo', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = crearApp();
  });

  test('devuelve estado y fechas, nunca datos personales', async () => {
    SolicitudEliminacion.findOne.mockResolvedValue({
      codigo: 'abc123def456abc123def456',
      estado: 'en_proceso',
      created_at: new Date('2026-08-01'),
      fecha_limite: new Date('2026-08-31'),
      procesada_en: null,
      nombre: 'Ana Pérez',
      email: 'ana@example.com',
      motivo: 'Motivo confidencial',
      ip_solicitante: '203.0.113.10',
      notas_internas: 'Nota interna',
    });

    const res = await request(app).get('/api/publico/eliminacion-datos/abc123def456abc123def456');

    expect(res.status).toBe(200);
    expect(res.body.solicitud.estado).toBe('en_proceso');

    const serializado = JSON.stringify(res.body);
    expect(serializado).not.toContain('Ana Pérez');
    expect(serializado).not.toContain('ana@example.com');
    expect(serializado).not.toContain('Motivo confidencial');
    expect(serializado).not.toContain('203.0.113.10');
    expect(serializado).not.toContain('Nota interna');
  });

  test('responde 404 con un código inexistente', async () => {
    SolicitudEliminacion.findOne.mockResolvedValue(null);

    const res = await request(app).get('/api/publico/eliminacion-datos/no-existe');

    expect(res.status).toBe(404);
  });
});

describe('POST /api/meta/data-deletion-callback', () => {
  let app;
  const secretoOriginal = process.env.FACEBOOK_APP_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    SolicitudEliminacion.findOne.mockResolvedValue(null);
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;

    // El controller se monta suelto en vez de usar routes/meta.js completo,
    // porque ese archivo exige variables de entorno de la integración de
    // Meta que no hacen falta para probar este endpoint.
    const controller = require('../controllers/solicitudEliminacion.controller');
    app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.post('/api/meta/data-deletion-callback', controller.metaCallback);
  });

  afterAll(() => {
    process.env.FACEBOOK_APP_SECRET = secretoOriginal;
  });

  test('devuelve url y confirmation_code con un signed_request válido', async () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '1234567890' });

    const res = await request(app)
      .post('/api/meta/data-deletion-callback')
      .type('form')
      .send({ signed_request: signed });

    expect(res.status).toBe(200);
    // Meta exige exactamente estas dos claves en la respuesta.
    expect(Object.keys(res.body).sort()).toEqual(['confirmation_code', 'url']);
    expect(res.body.url).toContain(`/data-deletion/estado/${res.body.confirmation_code}`);
    expect(SolicitudEliminacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ origen: 'meta_callback', meta_user_id: '1234567890' })
    );
  });

  test('rechaza una firma inválida sin crear la solicitud', async () => {
    const signed = firmar({ algorithm: 'HMAC-SHA256', user_id: '1234567890' }, 'secreto-del-atacante');

    const res = await request(app)
      .post('/api/meta/data-deletion-callback')
      .type('form')
      .send({ signed_request: signed });

    expect(res.status).toBe(400);
    expect(SolicitudEliminacion.create).not.toHaveBeenCalled();
  });

  test('rechaza la solicitud sin signed_request', async () => {
    const res = await request(app).post('/api/meta/data-deletion-callback').type('form').send({});

    expect(res.status).toBe(400);
    expect(SolicitudEliminacion.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/publico/contacto', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = crearApp();
  });

  const mensajeValido = {
    area: 'privacidad',
    nombre: 'Ana Pérez',
    email: 'ana@example.com',
    asunto: 'Consulta sobre mis datos',
    mensaje: 'Quisiera saber qué datos tienen sobre mí y cómo los usan.',
  };

  test('registra el mensaje y devuelve la casilla a la que se deriva', async () => {
    const res = await request(app).post('/api/publico/contacto').send(mensajeValido);

    expect(res.status).toBe(201);
    expect(res.body.mensaje.derivado_a).toBe('contacto@gesicomm.com');
    expect(res.body.mensaje.area).toBe('privacidad');
    expect(MensajeContacto.create).toHaveBeenCalledTimes(1);
  });

  test('rechaza un área que no está en la lista permitida', async () => {
    const res = await request(app)
      .post('/api/publico/contacto')
      .send({ ...mensajeValido, area: 'inventada' });

    expect(res.status).toBe(400);
    expect(MensajeContacto.create).not.toHaveBeenCalled();
  });

  test('rechaza un mensaje demasiado corto', async () => {
    const res = await request(app)
      .post('/api/publico/contacto')
      .send({ ...mensajeValido, mensaje: 'hola' });

    expect(res.status).toBe(400);
    expect(MensajeContacto.create).not.toHaveBeenCalled();
  });
});

describe('Rutas internas de /api/publico/admin', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = crearApp();
  });

  test('el listado de solicitudes exige autenticación', async () => {
    const res = await request(app).get('/api/publico/admin/eliminacion-datos');

    expect([401, 403]).toContain(res.status);
    expect(SolicitudEliminacion.findAndCountAll).not.toHaveBeenCalled();
  });

  test('el listado de mensajes de contacto exige autenticación', async () => {
    const res = await request(app).get('/api/publico/admin/contacto');

    expect([401, 403]).toContain(res.status);
    expect(MensajeContacto.findAndCountAll).not.toHaveBeenCalled();
  });
});
