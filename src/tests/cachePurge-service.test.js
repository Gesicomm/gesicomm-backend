jest.mock('axios', () => ({ get: jest.fn().mockResolvedValue({ status: 200 }) }));
const axios = require('axios');
const CachePurgeService = require('../services/cachePurge.service');

describe('CachePurgeService.purgarLanding', () => {
  beforeEach(() => jest.clearAllMocks());

  test('purga /api/l/ y /api/l/<slug> por subdominio y dominio propio en una landing es_home', async () => {
    const tienda = { subdominio: 'sommix', dominio_propio: 'cogymtraining.com', dominio_propio_habilitado: true };
    const landing = { slug: 'lienzo-en-blanco-58c649', es_home: true };

    await CachePurgeService.purgarLanding(tienda, landing);

    const urls = axios.get.mock.calls.map(c => `${c[1].headers.Host} ${c[0]}`);
    expect(urls).toContain('sommix.gesicomm.com http://127.0.0.1/purgar-cache/api/l/');
    expect(urls).toContain('sommix.gesicomm.com http://127.0.0.1/purgar-cache/api/l/lienzo-en-blanco-58c649');
    expect(urls).toContain('cogymtraining.com http://127.0.0.1/purgar-cache/api/l/');
    expect(urls).toContain('cogymtraining.com http://127.0.0.1/purgar-cache/api/l/lienzo-en-blanco-58c649');
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  test('una landing que no es home solo purga por su slug, nunca /api/l/', async () => {
    const tienda = { subdominio: 'sommix', dominio_propio: null, dominio_propio_habilitado: false };
    const landing = { slug: 'otra-landing', es_home: false };

    await CachePurgeService.purgarLanding(tienda, landing);

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledWith(
      'http://127.0.0.1/purgar-cache/api/l/otra-landing',
      expect.objectContaining({ headers: { Host: 'sommix.gesicomm.com' } }),
    );
  });

  test('dominio propio sin habilitar no se purga', async () => {
    const tienda = { subdominio: 'sommix', dominio_propio: 'otrodominio.com', dominio_propio_habilitado: false };
    const landing = { slug: 'x', es_home: false };

    await CachePurgeService.purgarLanding(tienda, landing);

    expect(axios.get.mock.calls.every(c => c[1].headers.Host !== 'otrodominio.com')).toBe(true);
  });

  test('un error de axios no se propaga (mejor esfuerzo)', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const tienda = { subdominio: 'sommix' };
    const landing = { slug: 'x', es_home: false };

    await expect(CachePurgeService.purgarLanding(tienda, landing)).resolves.toBeUndefined();
  });

  test('sin tienda o sin landing no hace nada', async () => {
    await CachePurgeService.purgarLanding(null, { slug: 'x' });
    await CachePurgeService.purgarLanding({ subdominio: 'sommix' }, null);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
