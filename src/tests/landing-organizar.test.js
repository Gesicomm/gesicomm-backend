const { normalizarPedido, organizar } = require('../services/landingOrganizar.service');

const manana = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const fila = (id, extra = {}) => ({
  tipo: 'producto', referencia_id: id, etiqueta: null, precio_ancla: null, precio: 100000, precio_tachado: null, content_id: `p${id}`, ...extra,
});

describe('landingOrganizar.normalizarPedido', () => {
  test('rechaza acciones, descuentos y fechas inválidos', () => {
    expect(() => normalizarPedido({ accion: 'borrar_base' })).toThrow('Acción no válida.');
    expect(() => normalizarPedido({ accion: 'oferta', pct: 99 })).toThrow(/entre 1% y 94%/);
    expect(() => normalizarPedido({ accion: 'oferta', fin_at: '2020-01-01T00:00:00Z' })).toThrow(/futura/);
    expect(() => normalizarPedido({ accion: 'coleccion', coleccion: ' , ' })).toThrow(/colección/);
  });

  test('limpia el nombre de la colección (sin comas, que separan etiquetas)', () => {
    expect(normalizarPedido({ accion: 'coleccion', coleccion: '  Día,  de la madre ' }).coleccion).toBe('Día de la madre');
  });
});

describe('landingOrganizar.organizar', () => {
  test('oferta: precio tachado por %, badge y contador con título', () => {
    const fin = manana();
    const r = organizar([fila(1), fila(2, { precio: 80000 })], { urgencia: { activo: false, productos: [] } }, normalizarPedido({
      accion: 'oferta', pct: 20, badge: 'Solo por hoy', fin_at: fin, titulo: 'Ofertas del día',
    }));
    expect(r.items.map(i => i.precio_ancla)).toEqual([125000, 100000]);
    expect(r.venta.presentacion_productos['producto:1']).toEqual({ v: 2, insignia_principal: 'Solo por hoy' });
    expect(r.venta.urgencia).toMatchObject({ activo: true, estado: 'confirmado', productos: ['p1', 'p2'], titulo: 'Ofertas del día', fin_at: fin });
  });

  test('oferta: respeta el tope de 12 del contador y avisa cuántos quedaron afuera', () => {
    const lleno = Array.from({ length: 11 }, (_, i) => `x${i}`);
    const r = organizar([fila(1), fila(2)], { urgencia: { activo: true, productos: lleno } }, normalizarPedido({ accion: 'oferta', pct: 10, fin_at: manana() }));
    expect(r.venta.urgencia.productos).toHaveLength(12);
    expect(r.contador_lleno).toBe(1);
  });

  test('oferta: no marca como v2 una presentación vieja (cambiaría sus otros textos vacíos)', () => {
    const venta = { presentacion_productos: { 'producto:1': { titulo_comercial: '', insignia_principal: 'Nuevo' } } };
    const r = organizar([fila(1)], venta, normalizarPedido({ accion: 'oferta', badge: 'Oferta' }));
    expect(r.venta.presentacion_productos['producto:1']).toEqual({ titulo_comercial: '', insignia_principal: 'Oferta' });
  });

  test('quitar oferta: con precio tachado propio fija el ancla al precio; saca "Oferta", el badge de oferta y el contador', () => {
    const venta = {
      urgencia: { activo: true, productos: ['p1', 'p2'] },
      presentacion_productos: { 'producto:1': { v: 2, insignia_principal: 'Solo por hoy' }, 'producto:2': { v: 2, insignia_principal: 'Nuevo' } },
    };
    const r = organizar([
      fila(1, { precio_ancla: 150000, precio_tachado: 130000, etiqueta: 'Oferta, Novedades' }),
      fila(2, { precio_ancla: 150000 }),
    ], venta, normalizarPedido({ accion: 'quitar_oferta' }));
    expect(r.items[0]).toMatchObject({ precio_ancla: 100000, etiqueta: 'Novedades' });
    expect(r.items[1]).toMatchObject({ precio_ancla: null });
    expect(r.venta.presentacion_productos['producto:1'].insignia_principal).toBe('');
    expect(r.venta.presentacion_productos['producto:2'].insignia_principal).toBe('Nuevo');
    expect(r.venta.urgencia.productos).toEqual([]);
  });

  test('colección: agrega sin duplicar y no pasa los 50 caracteres de la columna', () => {
    const r = organizar([
      fila(1, { etiqueta: 'novedades' }),
      fila(2, { etiqueta: 'Una colección con un nombre muy largo, Otra más' }),
    ], {}, normalizarPedido({ accion: 'coleccion', coleccion: 'Novedades' }));
    expect(r.items[0].etiqueta).toBe('novedades');
    expect(r.items[1].etiqueta).toBe('Una colección con un nombre muy largo, Otra más');
    expect(r.sin_lugar).toEqual(['producto:2']);
  });

  test('quitar de colección y quitar todo', () => {
    const quitar = organizar([fila(1, { etiqueta: 'Novedades, Día de la madre' })], {}, normalizarPedido({ accion: 'quitar_coleccion', coleccion: 'día de la madre' }));
    expect(quitar.items[0].etiqueta).toBe('Novedades');
    const todo = organizar([fila(1, { etiqueta: 'Novedades', precio_ancla: 150000 })], {
      urgencia: { activo: true, productos: ['p1'] }, presentacion_productos: { 'producto:1': { v: 2, insignia_principal: 'Nuevo' } },
    }, normalizarPedido({ accion: 'quitar_todo' }));
    expect(todo.items[0]).toMatchObject({ etiqueta: null, precio_ancla: null });
    expect(todo.venta.presentacion_productos['producto:1'].insignia_principal).toBe('');
    expect(todo.venta.urgencia.productos).toEqual([]);
  });
});

describe('limpiarVenta: bloque Colecciones del inicio', () => {
  const LandingCodigoService = require('../services/landingCodigo.service');
  const limpiar = colecciones => LandingCodigoService.limpiarVenta({ inicio: { colecciones } }).inicio.colecciones;

  test('guarda modo, cuáles, por fila y total; corrige valores fuera de rango', () => {
    expect(limpiar({ modo: 'colecciones', items: ['Novedades', '', 'Novedades', 'Ofertas del día'], columnas: 3, limite: 6 }))
      .toEqual({ modo: 'colecciones', items: ['Novedades', 'Ofertas del día'], columnas: 3, limite: 6 });
    expect(limpiar({ modo: 'raro', columnas: 9, limite: 0 })).toEqual({ modo: 'categorias', items: [], columnas: 4, limite: 4 });
  });

  test('sin configurar no inventa la clave (la landing se ve como siempre)', () => {
    expect(LandingCodigoService.limpiarVenta({ inicio: { menu_links: [] } }).inicio).not.toHaveProperty('colecciones');
  });
});
