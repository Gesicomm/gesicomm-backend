const express = require('express');
const request = require('supertest');

// Mocks
jest.mock('../middleware/autorizacion', () => ({
  verificarPermiso: () => (req, res, next) => {
    req.usuario = { tenantId: 1 };
    next();
  }
}));

jest.mock('../services/oferta.service', () => ({
  actualizar: jest.fn().mockResolvedValue({ id: 99, nombre: 'Oferta Actualizada' }),
  eliminar: jest.fn().mockResolvedValue(),
  listarPorProducto: jest.fn().mockResolvedValue([]),
  crear: jest.fn().mockResolvedValue({ id: 99, nombre: 'Oferta Nueva' }),
}));

jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn().mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() }) },
}));

const OfertaService = require('../services/oferta.service');
const ofertaRouter = require('../routes/ofertas');

describe('Ofertas Routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Se monta igual que en app:
    app.use('/api/productos/:productoId/ofertas', ofertaRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT /api/productos/:productoId/ofertas/:id', () => {
    it('debería actualizar la oferta llamando al servicio con los parámetros correctos', async () => {
      const response = await request(app)
        .put('/api/productos/42/ofertas/99')
        .send({ nombre: 'Nuevo Nombre', precio: 1000 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id: 99, nombre: 'Oferta Actualizada' });
      expect(OfertaService.actualizar).toHaveBeenCalledWith(
        99,
        { nombre: 'Nuevo Nombre', precio: 1000 },
        1,
        expect.any(Object)
      );
    });

    it('debería fallar si el servicio tira error (ej. 404)', async () => {
      OfertaService.actualizar.mockRejectedValueOnce(new Error('Oferta no encontrada.'));
      
      const response = await request(app)
        .put('/api/productos/42/ofertas/99')
        .send({ nombre: 'Nuevo Nombre' });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Oferta no encontrada.');
    });
  });

  describe('DELETE /api/productos/:productoId/ofertas/:id', () => {
    it('debería eliminar lógicamente la oferta llamando al servicio', async () => {
      const response = await request(app)
        .delete('/api/productos/42/ofertas/99');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(OfertaService.eliminar).toHaveBeenCalledWith(
        99,
        1,
        expect.any(Object)
      );
    });
  });
});
