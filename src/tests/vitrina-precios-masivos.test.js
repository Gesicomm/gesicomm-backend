jest.mock('../models', () => ({
  sequelize: {
    query: jest.fn(),
    transaction: jest.fn(async (_options, fn) => fn('tx')),
    QueryTypes: { SELECT: 'SELECT' },
  },
  PrecioUsuario: { bulkCreate: jest.fn() },
}));
jest.mock('../services/precioUsuario.service', () => ({
  visibilidadCatalogoSql: jest.fn(admin => admin ? '' : 'AND p.creado_por IN (:usuario_id)'),
  visibilidadComboSql: jest.fn(admin => admin ? '' : 'AND c.creado_por IN (:usuario_id)'),
}));
jest.mock('../services/imagen.service', () => ({ serializar: f => ({ ...f, url: f.storage_key ? `https://media.test/${f.storage_key}` : f.url }) }));

const { sequelize, PrecioUsuario } = require('../models');
const Service = require('../services/precioUsuarioMasivo.service');
const fila = (props = {}) => ({ tipo: 'producto', id: 1, nombre: 'Producto', costo: '100000', precio_base: '150000', precio_actual: '200000', precio_usuario: '200000', precio_minimo: null, ...props });

beforeEach(() => { jest.clearAllMocks(); sequelize.query.mockResolvedValue([fila()]); });

test('calcula costo + 5%, en vez de aumentar el precio de venta existente', async () => {
  const resultado = await Service.actualizar(42, 7, false, { modo: 'reajuste', porcentaje: 5, seleccion: { todos: false, items: [{ tipo: 'producto', id: 1 }] } });
  expect(resultado).toEqual({ seleccionados: 1, actualizados: 1, sin_cambios: 0 });
  expect(PrecioUsuario.bulkCreate).toHaveBeenCalledWith([{ usuario_id: 42, inquilino_id: 7, tipo: 'producto', referencia_id: 1, precio: 105000 }], expect.objectContaining({ transaction: 'tx', updateOnDuplicate: ['precio', 'updated_at'] }));
});

test('todos usa filtros en el servidor y excluye filas desmarcadas de otras páginas', async () => {
  sequelize.query.mockResolvedValue([fila(), fila({ id: 2 }), fila({ tipo: 'combo', id: 1, costo: '100001' })]);
  const resultado = await Service.actualizar(42, 7, false, { modo: 'reajuste', porcentaje: 10, seleccion: { todos: true, filtros: { categoria: 'Hogar', busqueda: 'olla', page: 99, limit: 1 }, excluidos: [{ tipo: 'producto', id: 2 }] } });
  expect(resultado.seleccionados).toBe(2);
  const [sql, options] = sequelize.query.mock.calls[0];
  expect(sql).toContain('t.categoria = :categoria');
  expect(sql).not.toContain('LIMIT');
  expect(options.replacements).toEqual(expect.objectContaining({ categoria: 'Hogar', usuario_id: 42, inquilino_id: 7 }));
  expect(PrecioUsuario.bulkCreate.mock.calls[0][0].map(i => [i.tipo, i.precio])).toEqual([['producto', 110000], ['combo', 110001]]);
});

test('un mínimo incumplido rechaza TODO el lote antes de escribir', async () => {
  sequelize.query.mockResolvedValue([fila(), fila({ id: 2, precio_minimo: '120000' })]);
  await expect(Service.actualizar(42, 7, false, { modo: 'reajuste', porcentaje: 5, seleccion: { todos: true } })).rejects.toMatchObject({ status: 400, errores: [expect.objectContaining({ id: 2 })] });
  expect(PrecioUsuario.bulkCreate).not.toHaveBeenCalled();
});

test('no permite guardar una referencia ajena, eliminada o de otro inquilino', async () => {
  sequelize.query.mockResolvedValue([]);
  await expect(Service.actualizar(42, 7, false, { modo: 'manual', cambios: [{ tipo: 'producto', id: 10, precio: 110000 }] })).rejects.toMatchObject({ status: 400 });
  expect(PrecioUsuario.bulkCreate).not.toHaveBeenCalled();
  const [sql, options] = sequelize.query.mock.calls[0];
  expect(sql).toContain('p.inquilino_id = :inquilino_id');
  expect(sql).toContain('AND p.creado_por IN (:usuario_id)');
  expect(options.replacements.productos).toEqual([10]);
});

test.each([0, -1, null, '110000', Infinity, 10000000000, 110000.5])('edición manual rechaza precio inválido %p', async precio => {
  await expect(Service.actualizar(42, 7, false, { modo: 'manual', cambios: [{ tipo: 'producto', id: 1, precio }] })).rejects.toMatchObject({ status: 400 });
  expect(PrecioUsuario.bulkCreate).not.toHaveBeenCalled();
});

test('edición manual exige precio >= costo', async () => {
  await expect(Service.actualizar(42, 7, false, { modo: 'manual', cambios: [{ tipo: 'producto', id: 1, precio: 90000 }] })).rejects.toMatchObject({ status: 400 });
});

test.each([-1, 1001, NaN, '', null, '5'])('reajuste rechaza porcentaje inválido %p', async porcentaje => {
  await expect(Service.actualizar(42, 7, false, { modo: 'reajuste', porcentaje, seleccion: { todos: true } })).rejects.toMatchObject({ status: 400 });
  expect(sequelize.query).not.toHaveBeenCalled();
});

test('rechaza selección vacía, IDs inválidos y duplicados', async () => {
  for (const cambios of [[], [{ tipo: 'producto', id: -1, precio: 110000 }], [{ tipo: 'x', id: 1, precio: 110000 }], [{ tipo: 'producto', id: 1, precio: 110000 }, { tipo: 'producto', id: 1, precio: 120000 }]]) {
    await expect(Service.actualizar(42, 7, false, { modo: 'manual', cambios })).rejects.toMatchObject({ status: 400 });
  }
  expect(PrecioUsuario.bulkCreate).not.toHaveBeenCalled();
});

test('si no cambia un precio propio no escribe', async () => {
  const resultado = await Service.actualizar(42, 7, false, { modo: 'manual', cambios: [{ tipo: 'producto', id: 1, precio: 200000 }] });
  expect(resultado.sin_cambios).toBe(1);
  expect(PrecioUsuario.bulkCreate).not.toHaveBeenCalled();
});

test('upsert en lotes de 1000 dentro de una sola transacción', async () => {
  sequelize.query.mockResolvedValue(Array.from({ length: 2501 }, (_, i) => fila({ id: i + 1 })));
  const resultado = await Service.actualizar(42, 7, false, { modo: 'reajuste', porcentaje: 5, seleccion: { todos: true } });
  expect(resultado.actualizados).toBe(2501);
  expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  expect(PrecioUsuario.bulkCreate.mock.calls.map(c => c[0].length)).toEqual([1000, 1000, 501]);
  expect(PrecioUsuario.bulkCreate.mock.calls.every(c => c[1].transaction === 'tx')).toBe(true);
});

test('costo inválido no se reajusta', async () => {
  sequelize.query.mockResolvedValue([fila({ costo: null })]);
  await expect(Service.actualizar(42, 7, false, { modo: 'reajuste', porcentaje: 5, seleccion: { todos: true } })).rejects.toMatchObject({ status: 400 });
  expect(PrecioUsuario.bulkCreate).not.toHaveBeenCalled();
});

test('búsqueda pagina en SQL y devuelve catálogos para filtros', async () => {
  sequelize.query.mockImplementation(async sql => {
    if (sql.startsWith('SELECT COUNT')) return [{ total: '80' }];
    if (sql.startsWith('SELECT DISTINCT categoria')) return [{ nombre: 'Hogar' }];
    if (sql.startsWith('SELECT DISTINCT proveedor')) return [{ nombre: 'Proveedor' }];
    if (sql.includes('FROM producto_imagenes')) return [{ producto_id: 1, url: '/uploads/olla.jpg' }];
    return [fila()];
  });
  const resultado = await Service.buscar(42, 7, false, { page: 2, limit: 25, busqueda: "50% ' OR 1=1", tipo: 'producto', orden: 'precio-desc' });
  expect(resultado).toMatchObject({ page: 2, totalPages: 4, total: 80, categorias: ['Hogar'], proveedores: ['Proveedor'] });
  expect(resultado.items[0].imagen).toBe('/uploads/olla.jpg');
  const [sql, opts] = sequelize.query.mock.calls[1];
  expect(sql).toContain('LIMIT :limit OFFSET :offset');
  expect(sql).not.toContain("' OR 1=1");
  expect(opts.replacements).toMatchObject({ offset: 25, limit: 25, busqueda: "%50\\% ' OR 1=1%" });
});

test('miniaturas por página: imagen del combo primero, luego producto principal y fallback vacío', async () => {
  sequelize.query.mockImplementation(async sql => sql.includes('FROM producto_combo_imagenes')
    ? [{ combo_id: 10, url: '/uploads/pack.jpg', storage_key: 'combos/pack.webp' }]
    : [{ producto_id: 1, url: '/uploads/producto.jpg' }, { producto_id: 2, url: '/uploads/padre.jpg' }]);
  const fotos = await Service.imagenes([
    fila({ producto_id: 1 }), fila({ tipo: 'combo', id: 10, producto_id: 2 }),
    fila({ tipo: 'combo', id: 11, producto_id: 2 }), fila({ id: 3, producto_id: 3 }),
  ], 7);
  expect(fotos.get('producto:1')).toBe('/uploads/producto.jpg');
  expect(fotos.get('combo:10')).toBe('https://media.test/combos/pack.webp');
  expect(fotos.get('combo:11')).toBe('/uploads/padre.jpg');
  expect(fotos.get('producto:3')).toBeNull();
  expect(sequelize.query).toHaveBeenCalledTimes(2);
  expect(sequelize.query.mock.calls[0][1].replacements).toEqual({ inquilino_id: 7, productos: [1, 2, 3] });
  expect(sequelize.query.mock.calls[1][1].replacements).toEqual({ inquilino_id: 7, combos: [10, 11] });
  expect(sequelize.query.mock.calls[0][0]).toContain('(variante_id IS NOT NULL) ASC');
});

test.each([{ page: 0 }, { limit: 10000 }, { page: 1.5 }, { tipo: 'otro' }, { orden: 'toString' }, { busqueda: {} }])('rechaza filtros/paginación inválidos %p', async body => {
  await expect(Service.buscar(42, 7, false, body)).rejects.toMatchObject({ status: 400 });
});
