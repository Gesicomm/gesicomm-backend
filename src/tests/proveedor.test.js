const ProveedorService = require('../services/proveedor.service');
const { Proveedor } = require('../models');

jest.mock('../models', () => ({
  Proveedor: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

describe('ProveedorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('serializar', () => {
    test('incluye precio_dolar en el objeto serializado', () => {
      const proveedor = {
        id: 1,
        nombre: 'WINNINGSTAR',
        activo: true,
        precio_dolar: 1200.50,
      };

      const result = ProveedorService.serializar(proveedor);

      expect(result).toEqual({
        id: 1,
        nombre: 'WINNINGSTAR',
        activo: true,
        precio_dolar: 1200.50,
      });
    });

    test('serializa correctamente si precio_dolar es null', () => {
      const proveedor = {
        id: 2,
        nombre: 'Otro Proveedor',
        activo: false,
        precio_dolar: null,
      };

      const result = ProveedorService.serializar(proveedor);

      expect(result).toEqual({
        id: 2,
        nombre: 'Otro Proveedor',
        activo: false,
        precio_dolar: null,
      });
    });
  });

  describe('crear', () => {
    test('crea un proveedor con precio_dolar', async () => {
      const usuario_id = 1;
      const datos = {
        nombre: 'WINNINGSTAR',
        precio_dolar: 1200.50,
      };

      const proveedorCreado = {
        id: 1,
        usuario_id,
        nombre: 'WINNINGSTAR',
        precio_dolar: 1200.50,
        activo: true,
      };

      Proveedor.findOne.mockResolvedValue(null); // No existe
      Proveedor.create.mockResolvedValue(proveedorCreado);

      const result = await ProveedorService.crear(datos, usuario_id);

      expect(Proveedor.create).toHaveBeenCalledWith({
        usuario_id,
        nombre: 'WINNINGSTAR',
        precio_dolar: 1200.50,
      });
      expect(result).toEqual({
        id: 1,
        nombre: 'WINNINGSTAR',
        activo: true,
        precio_dolar: 1200.50,
      });
    });

    test('retorna el existente si ya existe el nombre sin crear uno nuevo', async () => {
      const existente = {
        id: 5,
        nombre: 'Existente',
        precio_dolar: null,
        activo: true,
      };
      Proveedor.findOne.mockResolvedValue(existente);

      const result = await ProveedorService.crear({ nombre: 'Existente', precio_dolar: 1200 }, 1);

      expect(Proveedor.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 5,
        nombre: 'Existente',
        activo: true,
        precio_dolar: null,
      });
    });
  });

  describe('actualizar', () => {
    test('actualiza el precio_dolar de un proveedor existente', async () => {
      const proveedor = {
        id: 1,
        nombre: 'WINNINGSTAR',
        activo: true,
        precio_dolar: 1000,
        save: jest.fn().mockResolvedValue(true),
      };

      Proveedor.findOne.mockResolvedValue(proveedor);

      const datos = {
        precio_dolar: 1300,
      };

      const result = await ProveedorService.actualizar(1, datos, 1);

      expect(proveedor.precio_dolar).toBe(1300);
      expect(proveedor.save).toHaveBeenCalled();
      expect(result).toEqual({
        id: 1,
        nombre: 'WINNINGSTAR',
        activo: true,
        precio_dolar: 1300,
      });
    });

    test('no actualiza campos no proporcionados', async () => {
      const proveedor = {
        id: 1,
        nombre: 'WINNINGSTAR',
        activo: true,
        precio_dolar: 1000,
        save: jest.fn().mockResolvedValue(true),
      };

      Proveedor.findOne.mockResolvedValue(proveedor);

      const datos = {
        nombre: 'NUEVO NOMBRE',
      };

      const result = await ProveedorService.actualizar(1, datos, 1);

      expect(proveedor.nombre).toBe('NUEVO NOMBRE');
      expect(proveedor.precio_dolar).toBe(1000); // Se mantiene igual
      expect(proveedor.activo).toBe(true);
      expect(proveedor.save).toHaveBeenCalled();
    });
  });
});
