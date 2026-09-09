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
 *  - que un dominio propio se verifique contra el DNS real y no contra
 *    ningún proveedor externo.
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

jest.mock('../utils/dominios', () => ({
  ...jest.requireActual('../utils/dominios'),
  apuntaANuestroServidor: jest.fn(),
  sirvePorHttps: jest.fn(),
}));

const { BuilderDomain, BuilderPage, BuilderFunnel, Tienda } = require('../models');
const { apuntaANuestroServidor, sirvePorHttps } = require('../utils/dominios');
const BuilderDomainService = require('../services/builderDomain.service');

const CONTEXTO = { usuario_id: 1, inquilino_id: 2 };

beforeEach(() => {
  jest.clearAllMocks();
  Tienda.count.mockResolvedValue(0);
  BuilderDomain.count.mockResolvedValue(0);
  BuilderDomain.create.mockImplementation(async (datos) => ({ id: 50, ...datos }));
  BuilderPage.findOne.mockResolvedValue({ id: 10, usuario_id: 1, funnel_id: null });
  BuilderFunnel.findOne.mockResolvedValue({ id: 7, usuario_id: 1 });
  apuntaANuestroServidor.mockResolvedValue({ apunta: true, detalle: null, ips: ['155.117.43.52'] });
  sirvePorHttps.mockResolvedValue(true);
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

  test('lo registra y devuelve el registro A que hay que cargar en el DNS', async () => {
    const creado = await BuilderDomainService.crearDominioPropio(CONTEXTO, {
      dominio: 't2e.com.py', pagina_id: 10,
    });

    expect(creado.hostname).toBe('t2e.com.py');
    expect(creado.tipo).toBe('dominio_propio');
    expect(creado.activo).toBe(false); // todavía no
    // Un solo registro y sin TXT de validación: apuntar el A es la prueba
    // de titularidad y el disparador del certificado a la vez.
    expect(creado.registros).toEqual([
      { tipo: 'A', nombre: '@', valor: process.env.ORIGIN_IP, obligatorio: true },
      { tipo: 'A', nombre: 'www', valor: process.env.ORIGIN_IP, obligatorio: false },
    ]);
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

  function filaPendiente() {
    return {
      id: 50, usuario_id: 1, tipo: 'dominio_propio', hostname: 't2e.com.py',
      pagina_id: 10, funnel_id: null, es_principal: true,
      estado_verificacion: 'pendiente', estado_ssl: 'pendiente',
      save: jest.fn(),
    };
  }

  test('verificar() lo marca activo cuando el DNS apunta aca y ya hay certificado', async () => {
    const fila = filaPendiente();
    BuilderDomain.findOne.mockResolvedValue(fila);

    const res = await BuilderDomainService.verificar(50, 1);

    expect(res.estado_verificacion).toBe('verificado');
    expect(res.estado_ssl).toBe('activo');
    expect(res.activo).toBe(true);
    expect(fila.save).toHaveBeenCalled();
  });

  test('verificar() deja el SSL en emitiendo mientras Caddy no emitio todavia', async () => {
    // El certificado sale en la primera visita al dominio, asi que un
    // dominio recien verificado no lo tiene: es un estado esperado, no un error.
    const fila = filaPendiente();
    BuilderDomain.findOne.mockResolvedValue(fila);
    sirvePorHttps.mockResolvedValue(false);

    const res = await BuilderDomainService.verificar(50, 1);

    expect(res.estado_verificacion).toBe('verificado');
    expect(res.estado_ssl).toBe('emitiendo');
    expect(res.activo).toBe(false);
  });

  test('verificar() lo deja pendiente si el DNS todavia no apunta aca', async () => {
    const fila = filaPendiente();
    BuilderDomain.findOne.mockResolvedValue(fila);
    apuntaANuestroServidor.mockResolvedValue({
      apunta: false, ips: ['1.2.3.4'], detalle: 'El dominio apunta a 1.2.3.4',
    });

    const res = await BuilderDomainService.verificar(50, 1);

    expect(res.estado_verificacion).toBe('pendiente');
    expect(res.activo).toBe(false);
  });

  test('un hostname deshabilitado no cuenta como activo', async () => {
    // Sigue cargado y verificado: lo unico que cambia es que no se sirve.
    const fila = filaPendiente();
    fila.habilitado = false;
    fila.estado_verificacion = 'verificado';
    fila.estado_ssl = 'activo';
    BuilderDomain.findOne.mockResolvedValue(fila);

    const res = await BuilderDomainService.cambiarHabilitacion(50, 1, false);

    expect(res.habilitado).toBe(false);
    expect(res.activo).toBe(false);
    expect(fila.save).toHaveBeenCalled();
  });

  test('no se le emite certificado a un hostname deshabilitado', async () => {
    BuilderDomain.count.mockResolvedValue(0);

    const permitido = await BuilderDomainService.hostnameHabilitadoParaCertificado('t2e.com.py');

    expect(permitido).toBe(false);
    expect(BuilderDomain.count).toHaveBeenCalledWith({
      where: {
        hostname: 't2e.com.py',
        tipo: 'dominio_propio',
        estado_verificacion: 'verificado',
        habilitado: true,
      },
    });
  });

  test('verificar() sobre un subdominio no consulta el DNS', async () => {
    BuilderDomain.findOne.mockResolvedValue({
      id: 51, usuario_id: 1, tipo: 'subdominio', hostname: 'calcula.gesicomm.com',
      estado_verificacion: 'verificado', estado_ssl: 'activo', pagina_id: 10, funnel_id: null,
    });

    const res = await BuilderDomainService.verificar(51, 1);

    expect(res.activo).toBe(true);
    expect(apuntaANuestroServidor).not.toHaveBeenCalled();
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
