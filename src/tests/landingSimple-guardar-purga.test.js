// Prueba end-to-end (con modelos mockeados) del flujo real de "Guardar" del
// editor: payload con codigo+venta+generado_por_ia/origen/bloques, tal cual
// lo manda LandingCodigoEditor.jsx#guardar(). Objetivo puntual: confirmar
// que agregar la purga de cache (CachePurgeService, ver landingSimple.
// service.js#actualizarCodigo) no rompe el guardado real, ni cuando la
// purga sale bien ni cuando falla.
jest.mock('../models', () => {
  const modelos = {};
  for (const nombre of ['Landing', 'LandingItem', 'LandingTemplate', 'LandingSeccion', 'Producto', 'ProductoCombo', 'ProductoImagen', 'ProductoVariante', 'ProductoFaq', 'ProductoOpcion', 'PrecioUsuario', 'Oferta', 'Tienda', 'Usuario']) {
    modelos[nombre] = { findOne: jest.fn(), findByPk: jest.fn(), findAll: jest.fn().mockResolvedValue([]), destroy: jest.fn(), bulkCreate: jest.fn() };
  }
  return modelos;
});
jest.mock('../services/stockPorTienda.service', () => ({ ajustarStockALaTienda: jest.fn().mockResolvedValue() }));
jest.mock('../services/typography.service', () => ({ resolver: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/paymentLogo.service', () => ({ guardarVisibilidadLanding: jest.fn().mockResolvedValue() }));
jest.mock('axios');

const axios = require('axios');
const { Landing, Tienda } = require('../models');
const Simple = require('../services/landingSimple.service');

const tienda = { id: 69, subdominio: 'sommix', dominio_propio: null, dominio_propio_habilitado: false, inquilino_id: 1 };

function landingBase() {
  return {
    id: 240, tienda_id: 69, slug: 'lienzo-en-blanco-58c649', es_home: true, activo: true,
    content: { codigo: { html: 'viejo', css: '', js: '', generado_por_mcp: true }, origen: 'mcp', generado_por_ia: true, bloques_inicio_bloqueados: true },
    save: jest.fn().mockResolvedValue(),
    changed: jest.fn(),
  };
}

// El payload real que manda guardar() en LandingCodigoEditor.jsx al tocar
// "Guardar" después de resetear la página a la plantilla por defecto.
const payloadGuardar = {
  codigo: { html: '<main>Plantilla por defecto</main>', css: '', js: '' },
  venta: { configurado: true, seleccion: 'manual' },
  generado_por_ia: false,
  bloques_inicio_bloqueados: false,
  origen: 'plantilla',
};

beforeEach(() => {
  jest.clearAllMocks();
  Tienda.findByPk.mockResolvedValue(tienda);
  jest.spyOn(Simple, 'obtener').mockResolvedValue({ id: 240, content: {} });
});
afterEach(() => jest.restoreAllMocks());

test('el guardado real se completa y dispara la purga cuando nginx responde bien', async () => {
  axios.get.mockResolvedValue({ status: 200 });
  const landing = landingBase();

  const resultado = await Simple.actualizarCodigo(landing, 69, 1, payloadGuardar);

  expect(landing.save).toHaveBeenCalledTimes(1);
  expect(landing.content.origen).toBe('plantilla');
  expect(landing.content.generado_por_ia).toBe(false);
  expect(landing.content.bloques_inicio_bloqueados).toBe(false);
  // El codigo.generado_por_mcp viejo no sobrevive: se reconstruye desde cero.
  expect(landing.content.codigo.generado_por_mcp).toBeUndefined();
  expect(resultado).toMatchObject({ id: 240 });

  // Deja que el fire-and-forget de la purga corra antes de verificar.
  await new Promise(r => setImmediate(r));
  expect(axios.get).toHaveBeenCalledWith(
    'http://127.0.0.1/purgar-cache/api/l/',
    expect.objectContaining({ headers: { Host: 'sommix.gesicomm.com' } }),
  );
  expect(axios.get).toHaveBeenCalledWith(
    'http://127.0.0.1/purgar-cache/api/l/lienzo-en-blanco-58c649',
    expect.objectContaining({ headers: { Host: 'sommix.gesicomm.com' } }),
  );
});

test('si nginx no responde (purga falla) el guardado igual se completa normal', async () => {
  axios.get.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:80'));
  const landing = landingBase();

  const resultado = await Simple.actualizarCodigo(landing, 69, 1, payloadGuardar);

  expect(landing.save).toHaveBeenCalledTimes(1);
  expect(resultado).toMatchObject({ id: 240 });
  await new Promise(r => setImmediate(r));
  expect(axios.get).toHaveBeenCalled(); // se intentó, pero no rompió nada arriba
});

test('un guardado de solo items (sin venta ni codigo) tambien busca la tienda para purgar', async () => {
  const landing = landingBase();
  axios.get.mockResolvedValue({ status: 200 });

  await Simple.actualizarCodigo(landing, 69, 1, { items: [] });

  expect(landing.save).toHaveBeenCalledTimes(1);
  expect(Tienda.findByPk).toHaveBeenCalledWith(69);
});
