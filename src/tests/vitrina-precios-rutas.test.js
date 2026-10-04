const request = require('supertest');
const express = require('express');

jest.mock('../middleware/autenticacion', () => ({ verificarToken: (req, res, next) => {
  const rol = req.headers['x-test-rol'];
  if (!rol) return res.status(401).json({ message: 'Sin sesión' });
  req.usuario = { id: 42, tenantId: 7, rol, permisos: req.headers['x-test-precios'] ? ['gestionar_precio_propio'] : [] };
  next();
} }));
jest.mock('../controllers/precioUsuario.controller', () => ({
  catalogo: jest.fn(), catalogoPaginado: jest.fn(), guardarPrecioProducto: jest.fn(), guardarPrecioCombo: jest.fn(), sensibilidadProducto: jest.fn(), sensibilidadCombo: jest.fn(),
}));
jest.mock('../services/precioUsuarioMasivo.service', () => ({ buscar: jest.fn(), actualizar: jest.fn() }));
const service = require('../services/precioUsuarioMasivo.service');
const app = express();
app.use(express.json());
app.use('/vitrina', require('../routes/vitrina'));

beforeEach(() => { jest.clearAllMocks(); service.buscar.mockResolvedValue({ items: [], total: 0 }); service.actualizar.mockResolvedValue({ actualizados: 1 }); });

test('requiere sesión en búsquedas y modificaciones', async () => {
  for (const path of ['/buscar', '/actualizar']) expect((await request(app).post('/vitrina/precios' + path).send({})).status).toBe(401);
  expect(service.buscar).not.toHaveBeenCalled();
  expect(service.actualizar).not.toHaveBeenCalled();
});
test('búsqueda toma identidad del token, nunca del body', async () => {
  const body = { usuario_id: 99, inquilino_id: 88, page: 2, limit: 25, categoria: 'Hogar' };
  expect((await request(app).post('/vitrina/precios/buscar').set('x-test-rol', 'usuario').send(body)).status).toBe(200);
  expect(service.buscar).toHaveBeenCalledWith(42, 7, false, body);
});
test('no modifica sin gestionar_precio_propio', async () => {
  expect((await request(app).post('/vitrina/precios/actualizar').set('x-test-rol', 'usuario').send({ modo: 'manual' })).status).toBe(403);
  expect(service.actualizar).not.toHaveBeenCalled();
});
test('permite modificar con gestionar_precio_propio', async () => {
  const body = { modo: 'manual', cambios: [{ tipo: 'producto', id: 1, precio: 105000 }] };
  expect((await request(app).post('/vitrina/precios/actualizar').set('x-test-rol', 'usuario').set('x-test-precios', 'si').send(body)).status).toBe(200);
  expect(service.actualizar).toHaveBeenCalledWith(42, 7, false, body);
});
test('el administrador sigue las reglas de acceso de su rol', async () => {
  expect((await request(app).post('/vitrina/precios/actualizar').set('x-test-rol', 'administrador').send({ modo: 'reajuste' })).status).toBe(200);
  expect(service.actualizar).toHaveBeenCalledWith(42, 7, true, { modo: 'reajuste' });
});
test('devuelve errores por fila y respuesta 400 para validación', async () => {
  service.actualizar.mockRejectedValue(Object.assign(new Error('Precio inválido'), { status: 400, errores: [{ tipo: 'producto', id: 1, motivo: 'Menor al mínimo' }] }));
  const res = await request(app).post('/vitrina/precios/actualizar').set('x-test-rol', 'administrador').send({});
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ message: 'Precio inválido', errores: [{ id: 1 }] });
});
test('elimina los antiguos endpoints de Excel', async () => {
  expect((await request(app).get('/vitrina/precios/exportar').set('x-test-rol', 'administrador')).status).toBe(404);
  expect((await request(app).post('/vitrina/precios/importar').set('x-test-rol', 'administrador')).status).toBe(404);
});
