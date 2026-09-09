/**
 * Dominio propio de una tienda: los registros que se le muestran al cliente
 * y el cálculo del estado.
 *
 * Lo que estos tests protegen, y por qué:
 *
 *  - QUE LOS REGISTROS SIEMPRE VIAJEN. Una config incompleta del servidor
 *    (faltaba ORIGIN_IP) hacía que el chequeo de DNS lanzara, el endpoint
 *    devolviera 500 y la pantalla dibujara las tres casillas del registro
 *    vacías, sin decir por qué. El cliente veía "Tipo / Nombre / Valor" en
 *    blanco y el botón de copiar le ponía "undefined" en el portapapeles.
 *
 *  - Que el estado se calcule contra el DNS real y no contra nada guardado.
 *
 *  - Que un dominio deshabilitado ni siquiera consulte el DNS.
 */

// whois-json es ESM y jest no lo puede transformar. No participa de nada
// de lo que se prueba acá: solo lo usa la detección del proveedor de DNS.
jest.mock('whois-json', () => jest.fn());

jest.mock('../models', () => ({
  Tienda: { findOne: jest.fn() },
  Usuario: { findByPk: jest.fn() },
  ProveedorDns: { findAll: jest.fn() },
}));

jest.mock('../utils/dominios', () => ({
  ...jest.requireActual('../utils/dominios'),
  apuntaANuestroServidor: jest.fn(),
  sirvePorHttps: jest.fn(),
}));

const { Tienda } = require('../models');
const { apuntaANuestroServidor, sirvePorHttps } = require('../utils/dominios');
const TiendaService = require('../services/tienda.service');

const IP = '155.117.43.52';

function tiendaMock(extra = {}) {
  return {
    id: 1,
    usuario_id: 7,
    dominio_propio: 'mitienda.com.py',
    dominio_propio_verificado: false,
    dominio_propio_habilitado: true,
    activo: true,
    save: jest.fn(),
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ORIGIN_IP = IP;
  apuntaANuestroServidor.mockResolvedValue({ apunta: true, detalle: null, ips: [IP] });
  sirvePorHttps.mockResolvedValue(true);
});

// ───────────────────────────────────────────────────────────────────────
describe('Los registros que ve el cliente', () => {

  test('un dominio raíz lleva dos registros A, la raíz y el www', async () => {
    Tienda.findOne.mockResolvedValue(tiendaMock());

    const res = await TiendaService.verificarDominioPropio(7);

    expect(res.registros).toEqual([
      { tipo: 'A', nombre: '@', valor: IP, obligatorio: true },
      { tipo: 'A', nombre: 'www', valor: IP, obligatorio: false },
    ]);
  });

  test('un subdominio lleva un solo registro, con su etiqueta', async () => {
    Tienda.findOne.mockResolvedValue(tiendaMock({ dominio_propio: 'tienda.mitienda.com.py' }));

    const res = await TiendaService.verificarDominioPropio(7);

    expect(res.registros).toEqual([
      { tipo: 'A', nombre: 'tienda', valor: IP, obligatorio: true },
    ]);
  });

  test('si el servidor está mal configurado, los registros VIAJAN IGUAL y se explica el problema', async () => {
    // Este es el caso que rompía la pantalla: la excepción se propagaba,
    // el endpoint daba 500 y el frontend mostraba las casillas vacías.
    Tienda.findOne.mockResolvedValue(tiendaMock());
    apuntaANuestroServidor.mockRejectedValue(new Error('Falta ORIGIN_IP en el entorno del servidor.'));

    const res = await TiendaService.verificarDominioPropio(7);

    expect(res.estado).toBe('pendiente');
    expect(res.registros).toHaveLength(2);
    expect(res.detalle).toMatch(/ORIGIN_IP/);
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Estado del dominio', () => {

  test('apunta acá y ya sirve por HTTPS → activo', async () => {
    Tienda.findOne.mockResolvedValue(tiendaMock());

    const res = await TiendaService.verificarDominioPropio(7);

    expect(res.estado).toBe('activo');
    expect(res.verificado).toBe(true);
  });

  test('apunta acá pero todavía sin certificado → verificado', async () => {
    // El certificado lo emite Caddy en la primera visita: es una espera
    // normal, no un error.
    Tienda.findOne.mockResolvedValue(tiendaMock());
    sirvePorHttps.mockResolvedValue(false);

    const res = await TiendaService.verificarDominioPropio(7);

    expect(res.estado).toBe('verificado');
  });

  test('no apunta acá → pendiente, y el detalle dice a dónde apunta', async () => {
    const tienda = tiendaMock({ dominio_propio_verificado: true });
    Tienda.findOne.mockResolvedValue(tienda);
    apuntaANuestroServidor.mockResolvedValue({
      apunta: false, ips: ['104.21.47.254'],
      detalle: 'El dominio apunta a 104.21.47.254 en lugar de 155.117.43.52.',
    });

    const res = await TiendaService.verificarDominioPropio(7);

    expect(res.estado).toBe('pendiente');
    // Y se corrige lo que decía la base: ya no apunta acá.
    expect(tienda.dominio_propio_verificado).toBe(false);
    expect(tienda.save).toHaveBeenCalled();
    expect(res.detalle).toMatch(/104\.21\.47\.254/);
  });

  test('deshabilitado ni siquiera consulta el DNS', async () => {
    Tienda.findOne.mockResolvedValue(tiendaMock({ dominio_propio_habilitado: false }));

    const res = await TiendaService.verificarDominioPropio(7);

    expect(res.estado).toBe('deshabilitado');
    expect(res.registros).toHaveLength(2);
    expect(apuntaANuestroServidor).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Autorización para emitir certificado', () => {

  test('solo si está cargado, verificado y habilitado', async () => {
    Tienda.findOne.mockResolvedValue({ id: 1 });

    expect(await TiendaService.dominioHabilitadoParaCertificado('mitienda.com.py')).toBe(true);
    expect(Tienda.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        dominio_propio_verificado: true,
        dominio_propio_habilitado: true,
        activo: true,
      }),
    }));
  });

  test('un dominio que no es de nadie se rechaza', async () => {
    Tienda.findOne.mockResolvedValue(null);
    expect(await TiendaService.dominioHabilitadoParaCertificado('ajeno.com')).toBe(false);
  });

  test('el www del dominio también se autoriza: Caddy pide certificado para los dos', async () => {
    Tienda.findOne.mockResolvedValue({ id: 1 });

    await TiendaService.dominioHabilitadoParaCertificado('www.mitienda.com.py');

    const where = Tienda.findOne.mock.calls[0][0].where;
    const buscados = where.dominio_propio[Object.getOwnPropertySymbols(where.dominio_propio)[0]]
      || Object.values(where.dominio_propio)[0];
    expect(buscados).toEqual(['www.mitienda.com.py', 'mitienda.com.py']);
  });
});
