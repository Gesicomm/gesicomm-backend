jest.mock('../services/tutorialSistema.service', () => ({ listar: jest.fn(), guardar: jest.fn() }));
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const Tutoriales = require('../services/tutorialSistema.service');
process.env.JWT_SECRET = 'tutoriales-test-secret';
const app = express();
app.use(express.json());
app.use('/api/tutoriales', require('../routes/tutorialesSistema'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
const token = rol => `Bearer ${jwt.sign({ id: 31, rol }, process.env.JWT_SECRET)}`;

beforeEach(() => { jest.clearAllMocks(); Tutoriales.listar.mockResolvedValue({ secciones: [], videos: {} }); Tutoriales.guardar.mockResolvedValue({ clave: 'ecommerce.inicio', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }); });

test('usuario autenticado puede leer, solo admin puede guardar', async () => {
  await request(app).get('/api/tutoriales').expect(401);
  await request(app).get('/api/tutoriales').set('Authorization', token('usuario')).expect(200);
  await request(app).put('/api/tutoriales/ecommerce.inicio').set('Authorization', token('usuario')).send({ url: 'https://youtu.be/dQw4w9WgXcQ' }).expect(403);
  expect(Tutoriales.guardar).not.toHaveBeenCalled();
  await request(app).put('/api/tutoriales/ecommerce.inicio').set('Authorization', token('administrador')).send({ url: 'https://youtu.be/dQw4w9WgXcQ' }).expect(200);
  expect(Tutoriales.guardar).toHaveBeenCalledWith('ecommerce.inicio', 'https://youtu.be/dQw4w9WgXcQ', 31);
});

test('el cuerpo del guardado debe incluir una URL de texto', async () => {
  await request(app).put('/api/tutoriales/ecommerce.inicio').set('Authorization', token('administrador')).send({ url: 3 }).expect(400);
  expect(Tutoriales.guardar).not.toHaveBeenCalled();
});
