const { quitarOfertaFlashVencida } = require('../utils/ofertaFlash');

const ahora = Date.parse('2026-10-20T12:00:00Z');
const config = { activo: true, productos: ['freidora'], fin_at: new Date(ahora).toISOString() };
const producto = () => ({ content_id: 'freidora', precio: 100000, precio_antes: 150000, descuento_pct: 33, etiqueta: 'Oferta, Cocina', insignia_principal: 'Oferta', insignia_secundaria: 'Nuevo' });

test('al llegar la fecha fin elimina la presentación de oferta y conserva el precio de venta y otras etiquetas', () => {
  expect(quitarOfertaFlashVencida(config, producto(), ahora)).toMatchObject({ precio: 100000, precio_antes: null, descuento_pct: 0, etiqueta: 'Cocina', insignia_principal: '', insignia_secundaria: 'Nuevo' });
});

test.each([
  [{ ...config, renovar_cada_visita: true }, ahora],
  [config, ahora - 1],
  [{ ...config, productos: ['otro-producto'] }, ahora],
  [{ ...config, activo: false }, ahora],
])('conserva ofertas renovables, vigentes, ajenas o sin campaña activa', (urgencia, fecha) => {
  const item = producto();
  expect(quitarOfertaFlashVencida(urgencia, item, fecha)).toEqual(producto());
});

test('admite la selección heredada de un producto y campañas sin selección explícita', () => {
  for (const urgencia of [{ ...config, productos: [], producto_id: 'freidora' }, { ...config, productos: [] }]) {
    expect(quitarOfertaFlashVencida(urgencia, producto(), ahora).descuento_pct).toBe(0);
  }
});

test('una campaña renovable confirmada se puede publicar sin fecha fija', () => {
  const validator = require('../services/aiCodeValidator.service');
  const html = '<div data-gesicomm-countdown></div>';
  expect(validator.detectarBloquesSinConfirmar(html, { urgencia: { activo: true, renovar_cada_visita: true, estado: 'confirmado' } })).toEqual([]);
  expect(validator.detectarBloquesSinConfirmar(html, { urgencia: { activo: true, renovar_cada_visita: false, estado: 'confirmado' } })).toEqual(['urgencia']);
});
