/**
 * Page Builder — hostnames: dónde se publica cada página o funnel.
 *
 *   calcula.gesicomm.com · t2e.gesicomm.com · t2e.com.py
 *
 * Lo que importa verificar acá:
 *  - que el namespace de subdominios NO choque con el de las tiendas
 *    (comparten *.gesicomm.com y Postgres no puede imponerlo solo);
 *  - que un subdominio de la plataforma quede publicable en el momento y
 *    un dominio propio no;
 *  - que el alta de un dominio propio no reviente si Cloudflare no está
 *    configurado en el entorno.
 */

jest.mock('../models', () => ({
  BuilderDomain: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  BuilderPage: { findOne: jest.fn() },
  BuilderFunnel: { findOne: jest.fn() },
  Tienda: { count: jest.fn() },
}));

jest.mock('../services/cloudflare.service', () => ({
  crearCustomHostname: jest.fn(),
  verificarEstado: jest.fn(),
}));

const { BuilderDomain, BuilderPage, BuilderFunnel, Tienda } = require('../models');
const CloudflareService = require('../services/cloudflare.service');
const BuilderDomainService = require('../services/builderDomain.service');

const CONTEXTO = { usuario_id: 1, inquilino_id: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  Tienda.count.mockResolvedValue(0);
  BuilderDomain.count.mockResolvedValue(0);
  BuilderDomain.create.mockImplementation(async (datos) => ({ id: 50, ...datos }));
  BuilderPage.findOne.mockResolvedValue({ id: 10, usuario_id: 1, funnel_id: null });
  BuilderFunnel.findOne.mockResolvedValue({ id: 7, usuario_id: 1 });
});

// ───────────────────────────────────────────────────────────────────────
describe('Subdominio de la plataforma', () => {

  test('arma el hostname y queda publicable en el momento', async () => {
    const creado = await BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'calcula', pagina_id: 10,
    });

    expect(creado.hostname).toBe('calcula.gesicomm.com');
    expect(creado.url).toBe('https://calcula.gesicomm.com');
    // No hay DNS que esperar ni certificado que emitir: *.gesicomm.com ya
    // tiene wildcard de DNS y de certificado.
    expect(creado.activo).toBe(true);
    expect(creado.estado_verificacion).toBe('verificado');
    expect(creado.estado_ssl).toBe('activo');
  });

  test('el primero de un target queda como URL canónica', async () => {
    BuilderDomain.count.mockResolvedValue(0);
    const creado = await BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 't2e', pagina_id: 10,
    });
    expect(creado.es_principal).toBe(true);
  });

  test('el segundo NO: cambiar la URL canónica es una decisión explícita', async () => {
    // disponible() consulta count y devuelve 0; el conteo de hostnames
    // del target devuelve 1 (ya tiene uno).
    BuilderDomain.count
      .mockResolvedValueOnce(0)  // ¿subdominio libre?
      .mockResolvedValueOnce(1); // ¿el target ya tiene hostnames?

    const creado = await BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'otro', pagina_id: 10,
    });
    expect(creado.es_principal).toBe(false);
  });

  test('rechaza un subdominio reservado', async () => {
    for (const reservado of ['www', 'api', 'app', 'admin']) {
      await expect(BuilderDomainService.crearSubdominio(CONTEXTO, {
        subdominio: reservado, pagina_id: 10,
      })).rejects.toMatchObject({ status: 422 });
    }
  });

  test('rechaza formatos que rompen DNS', async () => {
    for (const malo of ['ab', '-arranca', 'termina-', 'go--ogle', 'xn--algo', 'CON MAYUS Y ESPACIOS']) {
      await expect(BuilderDomainService.crearSubdominio(CONTEXTO, {
        subdominio: malo, pagina_id: 10,
      })).rejects.toMatchObject({ status: 422 });
    }
  });

  test('NO deja pisar el subdominio de una TIENDA', async () => {
    // El namespace de *.gesicomm.com es compartido: si "somnix" ya es una
    // tienda, no puede ser además una página del builder.
    Tienda.count.mockResolvedValue(1);

    await expect(BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'somnix', pagina_id: 10,
    })).rejects.toMatchObject({ status: 409 });

    expect(BuilderDomain.create).not.toHaveBeenCalled();
  });

  test('NO deja repetir el subdominio de otra página', async () => {
    BuilderDomain.count.mockResolvedValue(1);
    await expect(BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'calcula', pagina_id: 10,
    })).rejects.toMatchObject({ status: 409 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Target', () => {

  test('exige exactamente uno: página o funnel', async () => {
    await expect(BuilderDomainService.crearSubdominio(CONTEXTO, { subdominio: 'x1y' }))
      .rejects.toMatchObject({ status: 422 });
    await expect(BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'x1y', pagina_id: 10, funnel_id: 7,
    })).rejects.toMatchObject({ status: 422 });
  });

  test('una página que es paso de un funnel no puede tener hostname propio', async () => {
    // El hostname va en el funnel; la página se sirve como un path suyo.
    BuilderPage.findOne.mockResolvedValue({ id: 11, usuario_id: 1, funnel_id: 7 });

    await expect(BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'oferta', pagina_id: 11,
    })).rejects.toMatchObject({ status: 409 });
  });

  test('un funnel sí puede', async () => {
    const creado = await BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'creatina', funnel_id: 7,
    });
    expect(creado.funnel_id).toBe(7);
    expect(creado.pagina_id).toBeNull();
  });

  test('un target de otro usuario da 404', async () => {
    BuilderPage.findOne.mockResolvedValue(null);
    await expect(BuilderDomainService.crearSubdominio(CONTEXTO, {
      subdominio: 'ajeno', pagina_id: 999,
    })).rejects.toMatchObject({ status: 404 });
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('Dominio propio', () => {

  beforeEach(() => {
    CloudflareService.crearCustomHostname.mockResolvedValue({
      id: 'cf-abc', estado: 'pending',
      ownershipVerification: { type: 'txt', name: '_cf.t2e.com.py', value: 'token123' },
    });
  });

  test('lo registra y devuelve el TXT que hay que cargar en el DNS', async () => {
    const creado = await BuilderDomainService.crearDominioPropio(CONTEXTO, {
      dominio: 't2e.com.py', pagina_id: 10,
    });

    expect(creado.hostname).toBe('t2e.com.py');
    expect(creado.tipo).toBe('dominio_propio');
    expect(creado.activo).toBe(false); // todavía no
    expect(creado.verificacion_dns).toMatchObject({
      tipo: 'TXT', nombre: '_cf.t2e.com.py', valor: 'token123',
    });
  });

  test('acepta varios niveles y normaliza el punto final', async () => {
    const creado = await BuilderDomainService.crearDominioPropio(CONTEXTO, {
      dominio: 'WWW.T2E.COM.PY.', pagina_id: 10,
    });
    expect(creado.hostname).toBe('www.t2e.com.py');
  });

  test('rechaza que le peguen una URL en vez de un dominio', async () => {
    for (const malo of ['https://t2e.com.py', 't2e.com.py/algo', 'sinpunto', '']) {
      await expect(BuilderDomainService.crearDominioPropio(CONTEXTO, {
        dominio: malo, pagina_id: 10,
      })).rejects.toMatchObject({ status: 422 });
    }
  });

  test('manda a usar la opción de subdominio si escriben algo.gesicomm.com', async () => {
    await expect(BuilderDomainService.crearDominioPropio(CONTEXTO, {
      dominio: 'calcula.gesicomm.com', pagina_id: 10,
    })).rejects.toMatchObject({ status: 422 });
  });

  test('si Cloudflare no está configurado, guarda igual y avisa', async () => {
    // Sin CF_ZONE_ID/CF_API_TOKEN el alta no puede reventar entera: el
    // usuario ya cargó su dominio y eso no se pierde.
    CloudflareService.crearCustomHostname.mockRejectedValue(
      new Error('Cloudflare no está configurado (faltan CF_ZONE_ID / CF_API_TOKEN en el entorno).'),
    );

    const creado = await BuilderDomainService.crearDominioPropio(CONTEXTO, {
      dominio: 't2e.com.py', pagina_id: 10,
    });

    expect(creado.hostname).toBe('t2e.com.py');
    expect(creado.estado_ssl).toBe('pendiente');
    expect(creado.aviso).toMatch(/proveedor de certificados/i);
  });

  test('verificar() marca activo cuando Cloudflare emitió el certificado', async () => {
    const fila = {
      id: 50, usuario_id: 1, tipo: 'dominio_propio', hostname: 't2e.com.py',
      cf_hostname_id: 'cf-abc', pagina_id: 10, funnel_id: null, es_principal: true,
      estado_verificacion: 'pendiente', estado_ssl: 'emitiendo',
      save: jest.fn(),
    };
    BuilderDomain.findOne.mockResolvedValue(fila);
    CloudflareService.verificarEstado.mockResolvedValue({
      estado: 'active', sslEstado: 'active', activo: true, ownershipVerification: null,
    });

    const res = await BuilderDomainService.verificar(50, 1);

    expect(res.estado_verificacion).toBe('verificado');
    expect(res.estado_ssl).toBe('activo');
    expect(res.activo).toBe(true);
    expect(fila.save).toHaveBeenCalled();
  });

  test('verificar() sobre un subdominio no llama a Cloudflare', async () => {
    BuilderDomain.findOne.mockResolvedValue({
      id: 51, usuario_id: 1, tipo: 'subdominio', hostname: 'calcula.gesicomm.com',
      estado_verificacion: 'verificado', estado_ssl: 'activo', pagina_id: 10, funnel_id: null,
    });

    const res = await BuilderDomainService.verificar(51, 1);

    expect(res.activo).toBe(true);
    expect(CloudflareService.verificarEstado).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────
describe('URL canónica', () => {

  test('definirPrincipal apaga la anterior antes de prender la nueva', async () => {
    const fila = {
      id: 52, usuario_id: 1, pagina_id: 10, funnel_id: null, tipo: 'dominio_propio',
      hostname: 't2e.com.py', es_principal: false,
      estado_verificacion: 'verificado', estado_ssl: 'activo',
      save: jest.fn(),
    };
    BuilderDomain.findOne.mockResolvedValue(fila);

    await BuilderDomainService.definirPrincipal(52, 1);

    // Los índices parciales de es_principal no son deferrables: si se
    // prendiera primero la nueva, habría dos canónicas a la vez.
    expect(BuilderDomain.update).toHaveBeenCalledWith(
      { es_principal: false },
      expect.objectContaining({ where: expect.objectContaining({ pagina_id: 10 }) }),
    );
    expect(fila.es_principal).toBe(true);
  });

  test('urlPrincipal devuelve null si el target todavía no tiene hostname', async () => {
    BuilderDomain.findOne.mockResolvedValue(null);
    expect(await BuilderDomainService.urlPrincipal({ pagina_id: 10 })).toBeNull();
  });

  test('urlPrincipal arma la URL con https', async () => {
    BuilderDomain.findOne.mockResolvedValue({ hostname: 'calcula.gesicomm.com' });
    expect(await BuilderDomainService.urlPrincipal({ pagina_id: 10 }))
      .toBe('https://calcula.gesicomm.com');
  });
});
