const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const usuarioMock = {
  id: 7,
  nombre: 'Ana',
  correo_electronico: 'ana@example.com',
  contrasena_hash: 'hash-viejo',
  password_reset_token_hash: null,
  password_reset_expira: null,
  update: jest.fn(async function update(datos) {
    Object.assign(this, datos);
    return this;
  }),
};

jest.mock('../models', () => ({
  Usuario: {
    findOne: jest.fn(),
  },
  Inquilino: {},
  Rol: {},
  Permiso: {},
  sequelize: {
    transaction: jest.fn(),
  },
}));

jest.mock('../services/email.service', () => ({
  enviarRecuperacionPassword: jest.fn(async () => ({ enviado: true, messageId: 'msg-1' })),
}));

jest.mock('../services/authTracking.service', () => ({
  SESSION_COOKIE: 'authSessionId',
  registrarEvento: jest.fn(async () => ({ id: 1 })),
  registrarEventoConNotificacion: jest.fn(async () => ({ id: 1 })),
  iniciarSesion: jest.fn(async () => ({ id: 'sesion-1' })),
  marcarActividad: jest.fn(),
  cerrarSesion: jest.fn(),
}));

const { Usuario } = require('../models');
const EmailService = require('../services/email.service');
const AuthTracking = require('../services/authTracking.service');
const authRoutes = require('../routes/auth');

function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

function tokenEnviado() {
  const url = EmailService.enviarRecuperacionPassword.mock.calls[0][0].urlReset;
  return new URL(url).searchParams.get('token');
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(usuarioMock, {
    contrasena_hash: 'hash-viejo',
    password_reset_token_hash: null,
    password_reset_expira: null,
  });
  usuarioMock.update.mockClear();
  process.env.FRONTEND_URL = 'https://gesicomm.com';
});

describe('recuperación de contraseña', () => {
  test('solicita recuperación, guarda hash y envía email sin exponer el token crudo', async () => {
    Usuario.findOne.mockResolvedValue(usuarioMock);

    const res = await request(crearApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'Ana@Example.COM' })
      .expect(200);

    expect(res.body.message).toContain('Si el correo existe');
    expect(usuarioMock.update).toHaveBeenCalledWith(expect.objectContaining({
      password_reset_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      password_reset_expira: expect.any(Date),
    }));
    expect(tokenEnviado()).toMatch(/^[a-f0-9]{64}$/);
    expect(usuarioMock.password_reset_token_hash).not.toBe(tokenEnviado());
    expect(AuthTracking.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'password_reset_email_sent',
      usuario: usuarioMock,
    }));
  });

  test('mantiene respuesta genérica cuando el correo no existe y deja tracking', async () => {
    Usuario.findOne.mockResolvedValue(null);

    const res = await request(crearApp())
      .post('/api/auth/forgot-password')
      .send({ email: 'nadie@example.com' })
      .expect(200);

    expect(res.body.message).toContain('Si el correo existe');
    expect(EmailService.enviarRecuperacionPassword).not.toHaveBeenCalled();
    expect(AuthTracking.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'password_reset_email_skipped',
      resultado: 'fallo',
    }));
  });

  test('cambia la contraseña con token válido y lo invalida', async () => {
    Usuario.findOne.mockResolvedValueOnce(usuarioMock);
    await request(crearApp()).post('/api/auth/forgot-password').send({ email: 'ana@example.com' });
    const token = tokenEnviado();

    Usuario.findOne.mockResolvedValueOnce(usuarioMock);
    const res = await request(crearApp())
      .post('/api/auth/reset-password')
      .send({ token, password: 'NuevaClave1' })
      .expect(200);

    expect(res.body.message).toContain('Contraseña actualizada');
    expect(await bcrypt.compare('NuevaClave1', usuarioMock.contrasena_hash)).toBe(true);
    expect(usuarioMock.password_reset_token_hash).toBeNull();
    expect(usuarioMock.password_reset_expira).toBeNull();
    expect(AuthTracking.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'password_reset_completed',
      usuario: usuarioMock,
    }));
  });

  test('rechaza token inválido con tracking de fallo', async () => {
    Usuario.findOne.mockResolvedValue(null);

    await request(crearApp())
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: 'NuevaClave1' })
      .expect(400);

    expect(AuthTracking.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'password_reset_failed',
      resultado: 'fallo',
      metadata: { razon: 'token_invalido' },
    }));
  });

  test('rechaza token vencido, lo limpia y trackea el fallo', async () => {
    Usuario.findOne.mockResolvedValue({
      ...usuarioMock,
      password_reset_expira: new Date(Date.now() - 1000),
      update: usuarioMock.update,
    });

    await request(crearApp())
      .post('/api/auth/reset-password')
      .send({ token: 'b'.repeat(64), password: 'NuevaClave1' })
      .expect(410);

    expect(usuarioMock.update).toHaveBeenCalledWith({
      password_reset_token_hash: null,
      password_reset_expira: null,
    });
    expect(AuthTracking.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({
      tipo: 'password_reset_failed',
      resultado: 'fallo',
      metadata: { razon: 'token_expirado' },
    }));
  });
});
