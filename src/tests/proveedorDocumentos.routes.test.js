jest.mock('../middleware/autenticacion', () => ({ verificarToken: (req, res, next) => {
  if (!req.headers['x-user-id']) return res.status(401).json({ message: 'Sin sesión' });
  req.usuario = { id: Number(req.headers['x-user-id']) }; next();
} }));
jest.mock('../services/proveedorPortal.service', () => ({ cuenta: jest.fn() }));
jest.mock('../services/proveedorDocumentos.service', () => ({ MAX_SIZE: 8 * 1024 * 1024, leerDocumento: jest.fn(), guardarDocumento: jest.fn() }));
jest.mock('../services/solicitudProveedor.service', () => ({ CATEGORIAS: { envios: 'Envíos' } }));
jest.mock('../utils/logger', () => ({ auditoria: jest.fn() }));

const express = require('express');
const request = require('supertest');
const Portal = require('../services/proveedorPortal.service');
const Documentos = require('../services/proveedorDocumentos.service');
const app = express();
app.use(express.json());
app.use('/api/proveedor', require('../routes/proveedorPortal'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));

beforeEach(() => {
  jest.clearAllMocks();
  Portal.cuenta.mockResolvedValue({ rolProveedor: true, postulacion: { id: 41 } });
  Documentos.leerDocumento.mockResolvedValue({ body: Buffer.from('foto'), mime: 'image/jpeg', nombre: 'cedula.jpg' });
});

test('el documento privado exige sesión, rol y postulación propia', async () => {
  const path = '/api/proveedor/documentos/cedula';
  expect((await request(app).get(path)).status).toBe(401);
  Portal.cuenta.mockResolvedValueOnce({ rolProveedor: false, postulacion: { id: 41 } });
  expect((await request(app).get(path).set('x-user-id', '7')).status).toBe(403);
  expect(Documentos.leerDocumento).not.toHaveBeenCalled();
  const respuesta = await request(app).get(path).set('x-user-id', '7');
  expect(respuesta.status).toBe(200);
  expect(Documentos.leerDocumento).toHaveBeenCalledWith(41, 'cedula');
  expect(respuesta.headers['cache-control']).toBe('private, no-store');
});
