/**
 * solicitudAbastecimiento.service#cotizar — abastecerse del catálogo
 * Gesicomm/Raha tiene que exigir que la conexión con Raha esté aprobada.
 * Sin esa validación, un comercio podía pedir (y terminar vendiendo)
 * productos de Raha sin tener la conexión activa.
 */

jest.mock('../models', () => ({
  sequelize: {},
  SolicitudAbastecimiento: {},
  HistorialSolicitudAbastecimiento: {},
  Producto: { findByPk: jest.fn() },
  ProductoVariante: { count: jest.fn(async () => 0), findOne: jest.fn() },
  Deposito: {},
  Usuario: {},
  Rol: {},
}));

jest.mock('../services/abastecimiento/estadoMachine', () => ({
  ACTORES: { USUARIO: 'USUARIO', ADMIN: 'ADMIN' },
  validarTransicion: jest.fn(),
  resolverSiguienteEstadoUnico: jest.fn(),
  ESTADOS_FINALES: [],
  errorHttp: (mensaje, status = 400) => Object.assign(new Error(mensaje), { status }),
}));

jest.mock('../services/tarifaDelivery.service', () => ({}));
jest.mock('../services/proveedorLogistico.service', () => ({ centrosActivos: jest.fn(async () => []) }));
jest.mock('../services/comprobante.service', () => ({}));
jest.mock('../services/parametros.service', () => ({}));
jest.mock('../services/inventarioUbicacion.service', () => ({}));
jest.mock('../services/producto.service', () => ({}));
jest.mock('../controllers/envioController', () => ({
  costoParaComerciante: jest.fn(() => 40000),
  esProductoCargadoPorAdmin: jest.fn(() => true),
}));
jest.mock('../services/raha/service', () => ({ conexionAprobada: jest.fn() }));

const { Producto } = require('../models');
const RahaService = require('../services/raha/service');
const SolicitudAbastecimientoService = require('../services/solicitudAbastecimiento.service');

const PRODUCTO = { id: 1, creado_por: null, Creador: null };

describe('cotizar — conexión Raha requerida', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Producto.findByPk.mockResolvedValue(PRODUCTO);
  });

  test('rechaza si la solicitud Raha del usuario no está aprobada', async () => {
    RahaService.conexionAprobada.mockResolvedValue(false);

    await expect(SolicitudAbastecimientoService.cotizar({
      usuario_id: 7, producto_id: 1, cantidad: 2, tipoLogistica: 'GESICOMM',
    })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('conexión con Raha') });

    expect(RahaService.conexionAprobada).toHaveBeenCalledWith(7);
  });

  test('deja pasar la cotización cuando la conexión está aprobada', async () => {
    RahaService.conexionAprobada.mockResolvedValue(true);

    const cotizacion = await SolicitudAbastecimientoService.cotizar({
      usuario_id: 7, producto_id: 1, cantidad: 2, tipoLogistica: 'GESICOMM',
    });

    expect(cotizacion).toMatchObject({ costoProducto: 80000, costoLogistico: 0, cubierto: true });
  });
});
