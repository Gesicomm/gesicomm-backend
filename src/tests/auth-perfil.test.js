const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const mockUsuario = {
  id: 42,
  nombre: 'Usuario Prueba',
  correo_electronico: 'prueba@gesicomm.com',
  telefono: '0981123456',
  contrasena_hash: 'hash-actual',
  codigo_verificacion: null,
  codigo_verificacion_expira: null,
  inquilino_id: 1,
  update: jest.fn(async function update(datos) {
    Object.assign(this, datos);
    return this;
  }),
};

jest.mock('../models', () => ({
  Usuario: {
    findByPk: jest.fn(async (id) => {
      if (id === 42) return mockUsuario;
      return null;
    }),
    findOne: jest.fn(),
  },
  Inquilino: {},
  Rol: {},
  Permiso: {},
  Tienda: {
    findAll: jest.fn(async () => []),
    findOne: jest.fn(),
  },
  sequelize: {
    transaction: jest.fn(),
  },
}));

jest.mock('../services/email.service', () => ({
  enviarCodigoActualizacionPerfil: jest.fn(async () => ({ enviado: true, messageId: 'msg-otp-1' })),
  enviarCodigoVerificacionEmail: jest.fn(async () => ({ enviado: true })),
  enviarRecuperacionPassword: jest.fn(async () => ({ enviado: true })),
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
const authRoutes = require('../routes/auth');

function crearApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

function generarToken(payload = {}) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'secret-test-jwt';
  return jwt.sign(
    {
      id: 42,
      nombre: 'Usuario Prueba',
      email: 'prueba@gesicomm.com',
      rol: 'usuario',
      permisos: [],
      tenantId: 1,
      tiendaId: null,
      ...payload,
    },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

describe('Rutas de Perfil y OTP (/api/auth/perfil)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockUsuario, {
      id: 42,
      nombre: 'Usuario Prueba',
      correo_electronico: 'prueba@gesicomm.com',
      telefono: '0981123456',
      contrasena_hash: 'hash-actual',
      codigo_verificacion: null,
      codigo_verificacion_expira: null,
    });
    mockUsuario.update.mockClear();
    app = crearApp();
  });

  describe('GET /api/auth/perfil', () => {
    it('debe rechazar si no está autenticado', async () => {
      const res = await request(app).get('/api/auth/perfil');
      expect(res.status).toBe(401);
    });

    it('debe devolver los datos del usuario autenticado incluyendo teléfono', async () => {
      const token = generarToken();
      const res = await request(app)
        .get('/api/auth/perfil')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: 42,
        nombre: 'Usuario Prueba',
        email: 'prueba@gesicomm.com',
        telefono: '0981123456',
      });
    });
  });

  describe('POST /api/auth/perfil/solicitar-otp', () => {
    it('debe generar y enviar OTP al correo del usuario autenticado', async () => {
      const token = generarToken();
      const res = await request(app)
        .post('/api/auth/perfil/solicitar-otp')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('prueba@gesicomm.com');
      expect(mockUsuario.update).toHaveBeenCalled();
      expect(mockUsuario.codigo_verificacion).toMatch(/^\d{6}$/);
      expect(mockUsuario.codigo_verificacion_expira).toBeInstanceOf(Date);
      expect(EmailService.enviarCodigoActualizacionPerfil).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'prueba@gesicomm.com',
          codigo: mockUsuario.codigo_verificacion,
        })
      );
    });
  });

  describe('POST /api/auth/perfil', () => {
    it('debe rechazar si no se envía código OTP', async () => {
      const token = generarToken();
      const res = await request(app)
        .post('/api/auth/perfil')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: 'Nuevo Nombre' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/código OTP/i);
    });

    it('debe rechazar si el código OTP es incorrecto', async () => {
      mockUsuario.codigo_verificacion = '123456';
      mockUsuario.codigo_verificacion_expira = new Date(Date.now() + 10 * 60 * 1000);

      const token = generarToken();
      const res = await request(app)
        .post('/api/auth/perfil')
        .set('Authorization', `Bearer ${token}`)
        .send({
          codigo_otp: '654321',
          nombre: 'Nuevo Nombre',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/código.*incorrecto/i);
    });

    it('debe rechazar si el código OTP expiró', async () => {
      mockUsuario.codigo_verificacion = '123456';
      mockUsuario.codigo_verificacion_expira = new Date(Date.now() - 60 * 1000); // vencido hace 1 min

      const token = generarToken();
      const res = await request(app)
        .post('/api/auth/perfil')
        .set('Authorization', `Bearer ${token}`)
        .send({
          codigo_otp: '123456',
          nombre: 'Nuevo Nombre',
        });

      expect(res.status).toBe(410);
      expect(res.body.codigo_expirado).toBe(true);
    });

    it('debe actualizar nombre, teléfono y contraseña cuando el OTP es válido', async () => {
      mockUsuario.codigo_verificacion = '123456';
      mockUsuario.codigo_verificacion_expira = new Date(Date.now() + 10 * 60 * 1000);

      const token = generarToken();
      const res = await request(app)
        .post('/api/auth/perfil')
        .set('Authorization', `Bearer ${token}`)
        .send({
          codigo_otp: '123456',
          nombre: 'Martín Modificado',
          telefono: '0981999888',
          password: 'Password123',
        });

      expect(res.status).toBe(200);
      expect(res.body.usuario.nombre).toBe('Martín Modificado');
      expect(res.body.usuario.telefono).toBe('0981999888');
      expect(mockUsuario.codigo_verificacion).toBeNull();
      expect(mockUsuario.codigo_verificacion_expira).toBeNull();

      // Verificar que la contraseña fue hasheada
      const passValida = await bcrypt.compare('Password123', mockUsuario.contrasena_hash);
      expect(passValida).toBe(true);
    });

    it('debe rechazar contraseña si no cumple los requisitos (mínimo 8, mayúscula, número)', async () => {
      mockUsuario.codigo_verificacion = '123456';
      mockUsuario.codigo_verificacion_expira = new Date(Date.now() + 10 * 60 * 1000);

      const token = generarToken();
      const res = await request(app)
        .post('/api/auth/perfil')
        .set('Authorization', `Bearer ${token}`)
        .send({
          codigo_otp: '123456',
          password: 'debil',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/8 caracteres/i);
    });
  });
});
