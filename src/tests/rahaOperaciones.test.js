jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(), query: jest.fn(), cast: require('sequelize').cast, col: require('sequelize').col },
  RahaDestino: { findAll: jest.fn(), findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
  RahaEnvioStock: { findOne: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn() },
  Deposito: { findOne: jest.fn(), findAll: jest.fn() }, Tienda: { findOne: jest.fn() }, Usuario: {},
  InventarioUbicacion: { findAll: jest.fn(), findAndCountAll: jest.fn() }, Producto: {}, ProductoVariante: {},
  SolicitudAbastecimiento: { findOne: jest.fn(), findAndCountAll: jest.fn() },
  SpeedboxPedido: {}, SpeedboxEvento: { findAll: jest.fn() },
}));
jest.mock('../services/raha/service', () => ({ conexionAprobada: jest.fn() }));
jest.mock('../services/speedbox/service', () => ({ environment: () => 'production' }));

const models = require('../models');
const raha = require('../services/raha/service');
const operaciones = require('../services/raha/operaciones');
const actor = { id: 7, tiendaId: 11 };
const datos = { deposito_origen_id: 6, destino_raha_id: 2, solicitud_key: '45c13ddf-9491-47c5-8a34-169d4af9df15',
  items: [{ producto_id: 3, variante_id: null, cantidad: 4 }], observacion: 'Coordinar por la mañana' };

function instancia(datosRegistro) {
  const registro = { ...datosRegistro };
  registro.update = jest.fn(async cambios => Object.assign(registro, cambios));
  registro.toJSON = () => Object.fromEntries(Object.entries(registro).filter(([, valor]) => typeof valor !== 'function'));
  return registro;
}

const catalogo = (filas = [{ producto_id: 3, variante_id: null, disponible: 10, stock_registrado: true,
  producto: { id: 3, nombre: 'Termo', sku: 'TRM' }, variante: null }]) => {
  models.sequelize.query.mockImplementation(async consulta => consulta.includes('WITH catalogo')
    ? [[{ total: filas.length, registros: filas }]] : [[]]);
};

beforeEach(() => {
  jest.clearAllMocks();
  models.sequelize.transaction.mockImplementation(accion => accion({ LOCK: { UPDATE: 'UPDATE' } }));
  catalogo();
  models.Tienda.findOne.mockResolvedValue({ id: 11, nombre: 'Tienda activa', inquilino_id: 2 });
  models.Deposito.findOne.mockResolvedValue({ id: 6, nombre: 'Depósito propio', ciudad: 'Luque', direccion: 'Calle 1' });
  models.RahaDestino.findOne.mockResolvedValue({ id: 2, nombre: 'Recepción RAHA', ciudad: 'Asunción', direccion: 'Calle 2' });
  models.RahaEnvioStock.findOne.mockResolvedValue(null);
  models.RahaEnvioStock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
  models.RahaEnvioStock.create.mockImplementation(async registro => instancia({ id: 15, ...registro }));
  models.InventarioUbicacion.findAll.mockResolvedValue([{ producto_id: 3, variante_id: null, cantidad_disponible: 10,
    Producto: { id: 3, nombre: 'Termo', sku: 'TRM' }, update: jest.fn() }]);
  raha.conexionAprobada.mockResolvedValue(true);
});

test('la solicitud toma productos y direcciones del servidor sin mover ni reservar inventario', async () => {
  const creado = await operaciones.crearEnvio(actor, datos);
  expect(models.Deposito.findOne.mock.calls[0][0].where).toMatchObject({ usuario_id: 7, tienda_id: 11, id: 6, alcance: 'PROPIO', activo: true });
  expect(models.sequelize.query.mock.calls.find(([consulta]) => consulta.includes('WITH catalogo'))[1].replacements)
    .toMatchObject({ usuarioId: 7, tiendaId: 11, inquilinoId: 2, depositoId: 6 });
  expect(creado).toMatchObject({ id: 15, estado: 'solicitada', tienda_id: 11,
    items: [{ producto_id: 3, variante_id: null, cantidad: 4, nombre: 'Termo', sku: 'TRM', variante: '' }],
    origen_snapshot: { nombre: 'Depósito propio' }, destino_snapshot: { nombre: 'Recepción RAHA' } });
  expect(creado.solicitud_key).toBeUndefined();
  expect(creado.solicitud_hash).toBeUndefined();
  expect(models.InventarioUbicacion.findAll).not.toHaveBeenCalled();
});

test('el mismo reintento devuelve la solicitud existente; reutilizar la clave con otros datos falla', async () => {
  await operaciones.crearEnvio(actor, datos);
  const persistido = await models.RahaEnvioStock.create.mock.results[0].value;
  models.RahaEnvioStock.findOne.mockResolvedValue(persistido);
  expect((await operaciones.crearEnvio(actor, datos)).id).toBe(15);
  expect(models.RahaEnvioStock.create).toHaveBeenCalledTimes(1);
  await expect(operaciones.crearEnvio(actor, { ...datos, items: [{ ...datos.items[0], cantidad: 5 }] })).rejects.toMatchObject({ status: 409 });
});

test('rechaza depósitos de otra tienda, destinos inactivos y cantidades superiores al disponible', async () => {
  models.Deposito.findOne.mockResolvedValueOnce(null);
  await expect(operaciones.crearEnvio(actor, datos)).rejects.toMatchObject({ status: 404 });
  models.RahaDestino.findOne.mockResolvedValueOnce(null);
  await expect(operaciones.crearEnvio(actor, datos)).rejects.toMatchObject({ status: 409 });
  await expect(operaciones.crearEnvio(actor, { ...datos, items: [{ ...datos.items[0], cantidad: 11 }] })).rejects.toThrow('Stock insuficiente');
  expect(models.RahaEnvioStock.create).not.toHaveBeenCalled();
});

test('rechaza variantes inactivas y productos duplicados sin crear una solicitud', async () => {
  await expect(operaciones.crearEnvio(actor, { ...datos, items: [datos.items[0], datos.items[0]] })).rejects.toThrow('No repitas');
  catalogo([]);
  await expect(operaciones.crearEnvio(actor, { ...datos, items: [{ producto_id: 3, variante_id: 9, cantidad: 1 }] })).rejects.toThrow('no disponible');
  expect(models.RahaEnvioStock.create).not.toHaveBeenCalled();
});

test('exige conexión aprobada y no acepta snapshots ni propietarios proporcionados por el cliente', async () => {
  raha.conexionAprobada.mockResolvedValueOnce(false);
  await expect(operaciones.crearEnvio(actor, datos)).rejects.toMatchObject({ status: 409 });
  await expect(operaciones.crearEnvio(actor, { ...datos, usuario_id: 99 })).rejects.toThrow('Datos inválidos');
  await expect(operaciones.crearEnvio(actor, { ...datos, items: [{ ...datos.items[0], nombre: 'Nombre falso' }] })).rejects.toThrow('Datos inválidos');
  expect(models.RahaEnvioStock.create).not.toHaveBeenCalled();
});

test('los listados del comercio siempre filtran usuario y tienda autenticados', async () => {
  await operaciones.listarEnvios(actor, { usuario_id: 99, tienda_id: 88, portal: true, page: 2, limit: 10 });
  expect(models.RahaEnvioStock.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
    where: { usuario_id: 7, tienda_id: 11 }, limit: 10, offset: 10,
  }));
  await expect(operaciones.detalleEnvio(actor, 999)).rejects.toMatchObject({ status: 404 });
  expect(models.RahaEnvioStock.findOne.mock.calls.at(-1)[0].where).toEqual({ id: 999, usuario_id: 7, tienda_id: 11 });
});

test('aceptar en RAHA registra autor e historial bajo bloqueo y rechaza versiones desactualizadas', async () => {
  const registro = instancia({ id: 15, estado: 'solicitada', version: 2, historial: [{ estado: 'solicitada' }] });
  models.RahaEnvioStock.findOne.mockResolvedValue(registro);
  const operador = { id: 5, nombre: 'Operador' };
  await operaciones.resolverEnvio(operador, 15, { estado: 'aceptada', version: 2, comentario: 'Recepción el martes' }, true);
  expect(models.RahaEnvioStock.findOne.mock.calls[0][0].lock).toBe('UPDATE');
  expect(registro.estado).toBe('aceptada');
  expect(registro.historial.at(-1)).toMatchObject({ raha_portal_usuario_id: 5, autor: 'RAHA · Operador', comentario: 'Recepción el martes' });
  await expect(operaciones.resolverEnvio(operador, 15, { estado: 'rechazada', version: 2 }, true)).rejects.toThrow('La solicitud cambió');
  expect(registro.update).toHaveBeenCalledTimes(1);
});

test('el comercio no puede aceptar y RAHA debe justificar observaciones o rechazo', async () => {
  models.RahaEnvioStock.findOne.mockResolvedValue(instancia({ estado: 'solicitada', version: 0, historial: [] }));
  await expect(operaciones.resolverEnvio(actor, 15, { estado: 'aceptada', version: 0 })).rejects.toMatchObject({ status: 409 });
  await expect(operaciones.resolverEnvio({ id: 5 }, 15, { estado: 'observada', version: 0 }, true)).rejects.toThrow('Indicá el motivo');
  const cancelada = await operaciones.resolverEnvio(actor, 15, { estado: 'cancelada', version: 0 });
  expect(cancelada.estado).toBe('cancelada');
});

test('preparado y enviado corresponden al comercio; recibido solo a RAHA y después del envío', async () => {
  const registro = instancia({ estado: 'solicitada', version: 0, historial: [] });
  models.RahaEnvioStock.findOne.mockResolvedValue(registro);
  await expect(operaciones.resolverEnvio(actor, 15, { estado: 'enviado', version: 0 })).rejects.toMatchObject({ status: 409 });
  await expect(operaciones.resolverEnvio({ id: 5 }, 15, { estado: 'recibido', version: 0 }, true)).rejects.toMatchObject({ status: 409 });
  await operaciones.resolverEnvio(actor, 15, { estado: 'preparado', version: 0 });
  await operaciones.resolverEnvio(actor, 15, { estado: 'enviado', version: 1 });
  await expect(operaciones.resolverEnvio(actor, 15, { estado: 'recibido', version: 2 })).rejects.toMatchObject({ status: 409 });
  await operaciones.resolverEnvio({ id: 5, nombre: 'Recepción' }, 15, { estado: 'recibido', version: 2 }, true);
  expect(registro.historial.map(evento => evento.estado)).toEqual(['preparado', 'enviado', 'recibido']);
  await expect(operaciones.resolverEnvio(actor, 15, { estado: 'cancelada', version: 3 })).rejects.toMatchObject({ status: 409 });
});

test('el catálogo sin ubicación permite cantidades declaradas pero no stock registrado insuficiente', async () => {
  catalogo([{ producto_id: 3, variante_id: null, disponible: 0, stock_registrado: false,
    producto: { id: 3, nombre: 'Termo', sku: 'TRM' }, variante: null }]);
  expect((await operaciones.crearEnvio(actor, datos)).items[0]).toMatchObject({ cantidad: 4, stock_registrado: false });
  catalogo([{ producto_id: 3, variante_id: null, disponible: 0, stock_registrado: true,
    producto: { id: 3, nombre: 'Termo', sku: 'TRM' }, variante: null }]);
  await expect(operaciones.crearEnvio(actor, datos)).rejects.toMatchObject({ status: 409 });
});

test('el catálogo pagina en servidor conservando el aislamiento de tienda, propietario e inquilino', async () => {
  const listado = await operaciones.stock(actor, { deposito_origen_id: 6, page: 2, limit: 10, texto: 'Termo%' });
  expect(listado.total).toBe(1);
  const [consulta, opciones] = models.sequelize.query.mock.calls[0];
  expect(consulta).toContain('p.inquilino_id = :inquilinoId');
  expect(consulta).toContain('p.creado_por = :usuarioId AND p.tienda_id = :tiendaId');
  expect(opciones.replacements).toMatchObject({ usuarioId: 7, tiendaId: 11, inquilinoId: 2, depositoId: 6, limite: 10, desplazamiento: 10, texto: 'Termo\\%' });
});

test('RAHA solo consulta abastecimientos vinculados a la integración y no recibe payloads privados', async () => {
  models.SolicitudAbastecimiento.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
  await operaciones.abastecimientos({ estado: 'en_camino', page: 3, limit: 10 });
  const consulta = models.SolicitudAbastecimiento.findAndCountAll.mock.calls[0][0];
  expect(consulta.where.tipo_logistica).toBe('PROPIA');
  expect(consulta.include[0]).toMatchObject({ as: 'pedidoRaha', required: true, where: { environment: 'production' } });
  expect(consulta.include[0].attributes).not.toContain('request_payload');
  expect(consulta.include[0].attributes).not.toContain('error');
  expect(consulta).toMatchObject({ limit: 10, offset: 20 });
  models.SolicitudAbastecimiento.findOne.mockResolvedValue(null);
  await expect(operaciones.detalleAbastecimiento(999)).rejects.toMatchObject({ status: 404 });
});

test('valida fechas reales y solo publica destinos activos al comercio', async () => {
  await expect(operaciones.listarEnvios(actor, { desde: '2026-02-31' })).rejects.toThrow('Fecha inválida');
  await expect(operaciones.listarEnvios(actor, { desde: '2026-10-19', hasta: '2026-10-01' })).rejects.toThrow('invertido');
  await operaciones.destinos();
  expect(models.RahaDestino.findAll.mock.calls[0][0].where).toEqual({ activo: true });
  await operaciones.destinos(true);
  expect(models.RahaDestino.findAll.mock.calls[1][0].where).toEqual({});
  await expect(operaciones.guardarDestino({ id: 5 }, { nombre: 'Centro', ciudad: 'Luque', direccion: 'Calle', activo: 'true' })).rejects.toThrow('Datos inválidos');
});
