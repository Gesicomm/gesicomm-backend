/**
 * Flujo end-to-end de una suscripción de Gesicomm:
 *   elegir plan -> pagar -> callback acredita -> token -> registro.
 *
 * El punto delicado que cubre: en el momento del pago NO existe Usuario, así
 * que la suscripción se identifica por email y el alta se habilita con un
 * token de un solo uso.
 */
const crypto = require('crypto');
const axios = require('axios');

jest.mock('axios');
jest.mock('../../services/parametros.service', () => ({
  obtenerVarios: jest.fn(),
  DEFINICIONES: [],
}));
jest.mock('../../models', () => {
  const mkModel = () => ({
    findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), findAll: jest.fn(), update: jest.fn(),
  });
  return {
    sequelize: { transaction: jest.fn(fn => fn('TRX')) },
    Plan: mkModel(),
    Suscripcion: mkModel(),
    PagoSuscripcion: mkModel(),
    Usuario: mkModel(),
  };
});

const SuscripcionService = require('../../services/suscripcion.service');
const ctrl = require('../../controllers/suscripciones.controller');
const { Plan, Suscripcion, PagoSuscripcion, Usuario, sequelize } = require('../../models');
const parametros = require('../../services/parametros.service');

const PRIVATE = 'private_sistema';
const PUBLIC = 'public_sistema';
const HASH = 'hash_de_pagopar_123';
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

const planPro = {
  id: 2, codigo: 'pro', nombre: 'Pro', precio: 250000,
  periodicidad: 'mensual', equivale_plan: 'pago', activo: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  parametros.obtenerVarios.mockResolvedValue({
    PAGOPAR_PUBLIC_KEY: PUBLIC,
    PAGOPAR_PRIVATE_KEY: PRIVATE,
  });
  // acreditarPago relee las filas con bloqueo, asi que la transaccion tiene
  // que exponer LOCK y findByPk devolver las MISMAS filas que findOne.
  sequelize.transaction.mockImplementation(fn => fn({ LOCK: { UPDATE: 'UPDATE' } }));
  PagoSuscripcion.findByPk.mockImplementation((...a) => PagoSuscripcion.findOne(...a));
});

describe('Credenciales del sistema', () => {
  it('falla claro si no estan cargadas en parametros', async () => {
    parametros.obtenerVarios.mockResolvedValue({ PAGOPAR_PUBLIC_KEY: null, PAGOPAR_PRIVATE_KEY: null });
    await expect(SuscripcionService.gatewayDeSistema()).rejects.toThrow(/credenciales de PagoPar/);
  });

  it('las lee de la tabla parametros, no del entorno', async () => {
    const g = await SuscripcionService.gatewayDeSistema();
    expect(parametros.obtenerVarios).toHaveBeenCalledWith(['PAGOPAR_PUBLIC_KEY', 'PAGOPAR_PRIVATE_KEY']);
    expect(g).toEqual({ public_key: PUBLIC, private_key: PRIVATE });
  });
});

describe('Checkout de un plan', () => {
  it('crea suscripcion pendiente, la cobra en PagoPar y guarda el hash', async () => {
    Plan.findOne.mockResolvedValue(planPro);
    Usuario.findOne.mockResolvedValue(null);
    Suscripcion.create.mockResolvedValue({ id: 55 });
    const pago = { id: 9, referencia: 'SUS55', update: jest.fn() };
    PagoSuscripcion.create.mockResolvedValue(pago);
    axios.post.mockResolvedValue({ data: { respuesta: true, resultado: [{ data: HASH }] } });

    const r = await SuscripcionService.iniciarCheckout({
      plan_codigo: 'pro', email: 'Nuevo@Cliente.com ', nombre: 'Ana',
    });

    // El correo se normaliza antes de guardarse
    expect(Suscripcion.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'nuevo@cliente.com', estado: 'pendiente_pago', usuario_id: null, precio_pagado: 250000 }),
      expect.anything(),
    );
    // La referencia es el unico id que generamos nosotros
    expect(PagoSuscripcion.create).toHaveBeenCalledWith(
      expect.objectContaining({ referencia: 'SUS55', monto: 250000 }),
      expect.anything(),
    );
    const body = axios.post.mock.calls[0][1];
    expect(body.id_pedido_comercio).toBe('SUS55');
    expect(body.token).toBe(sha1(PRIVATE + 'SUS55' + 250000));
    expect(body.public_key).toBe(PUBLIC);
    expect(pago.update).toHaveBeenCalledWith({ hash_pedido: HASH });
    expect(r.payment_url).toBe('https://www.pagopar.com/pagos/' + HASH);
  });

  it('rechaza un correo que ya tiene cuenta', async () => {
    Plan.findOne.mockResolvedValue(planPro);
    Usuario.findOne.mockResolvedValue({ id: 1 });
    await expect(SuscripcionService.iniciarCheckout({ plan_codigo: 'pro', email: 'ya@existe.com' }))
      .rejects.toThrow(/ya tiene una cuenta/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rechaza un correo invalido antes de tocar la base', async () => {
    await expect(SuscripcionService.iniciarCheckout({ plan_codigo: 'pro', email: 'no-es-mail' }))
      .rejects.toThrow(/correo válido/);
    expect(Plan.findOne).not.toHaveBeenCalled();
  });
});

describe('Callback acredita la suscripcion', () => {
  function armarPago() {
    return { id: 9, suscripcion_id: 55, monto: 250000, estado: 'PENDING', update: jest.fn() };
  }
  function armarSuscripcion(extra) {
    return Object.assign({ id: 55, plan_id: 2, usuario_id: null, update: jest.fn() }, extra || {});
  }

  it('valida la firma contra la private key DEL SISTEMA y emite el token', async () => {
    const pago = armarPago();
    const susc = armarSuscripcion();
    PagoSuscripcion.findOne.mockResolvedValue(pago);
    Suscripcion.findByPk.mockResolvedValue(susc);
    Plan.findByPk.mockResolvedValue(planPro);

    const req = { body: { pagado: true, hash_pedido: HASH, monto: '250000.00', token: sha1(PRIVATE + HASH) } };
    const r = res();
    await ctrl.webhookSuscripciones(req, r);

    expect(pago.update).toHaveBeenCalledWith(expect.objectContaining({ estado: 'PAID' }), expect.anything());
    const cambios = susc.update.mock.calls[0][0];
    expect(cambios.estado).toBe('activa');
    expect(cambios.token_registro).toHaveLength(64);
    expect(cambios.periodo_fin).toBeInstanceOf(Date);
    expect(r.json).toHaveBeenCalledWith([expect.objectContaining({ hash_pedido: HASH })]);
  });

  it('rechaza una firma invalida sin acreditar nada', async () => {
    const pago = armarPago();
    PagoSuscripcion.findOne.mockResolvedValue(pago);

    const req = { body: { pagado: true, hash_pedido: HASH, monto: '250000.00', token: sha1('otra_key' + HASH) } };
    const r = res();
    await ctrl.webhookSuscripciones(req, r);

    expect(r.status).toHaveBeenCalledWith(400);
    expect(pago.update).not.toHaveBeenCalled();
  });

  it('es idempotente: un segundo aviso no vuelve a emitir token', async () => {
    const pago = armarPago();
    pago.estado = 'PAID';
    PagoSuscripcion.findOne.mockResolvedValue(pago);
    Suscripcion.findByPk.mockResolvedValue(armarSuscripcion());

    const req = { body: { pagado: true, hash_pedido: HASH, monto: '250000.00', token: sha1(PRIVATE + HASH) } };
    const r = res();
    await ctrl.webhookSuscripciones(req, r);

    expect(pago.update).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith([expect.objectContaining({ hash_pedido: HASH })]);
  });

  it('con pagado:false no acredita', async () => {
    const pago = armarPago();
    PagoSuscripcion.findOne.mockResolvedValue(pago);

    const req = { body: { pagado: false, hash_pedido: HASH, monto: '250000.00', token: sha1(PRIVATE + HASH) } };
    const r = res();
    await ctrl.webhookSuscripciones(req, r);

    expect(pago.update).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith([expect.objectContaining({ hash_pedido: HASH })]);
  });

  it('404 si el hash no corresponde a ninguna suscripcion', async () => {
    PagoSuscripcion.findOne.mockResolvedValue(null);
    const r = res();
    await ctrl.webhookSuscripciones({ body: { pagado: true, hash_pedido: 'desconocido', token: 'x' } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});

describe('Token de registro', () => {
  const futuro = new Date(Date.now() + 3600 * 1000);

  it('acepta un token vigente sin usuario asociado', async () => {
    Suscripcion.findOne.mockResolvedValue({ id: 55, usuario_id: null, token_registro_expira: futuro });
    const s = await SuscripcionService.suscripcionPorToken('t'.repeat(64));
    expect(s).not.toBeNull();
  });

  it('rechaza un token ya usado (suscripcion con usuario)', async () => {
    Suscripcion.findOne.mockResolvedValue({ id: 55, usuario_id: 7, token_registro_expira: futuro });
    expect(await SuscripcionService.suscripcionPorToken('t'.repeat(64))).toBeNull();
  });

  it('rechaza un token vencido', async () => {
    Suscripcion.findOne.mockResolvedValue({ id: 55, usuario_id: null, token_registro_expira: new Date(Date.now() - 1000) });
    expect(await SuscripcionService.suscripcionPorToken('t'.repeat(64))).toBeNull();
  });

  it('lo quema al vincular el usuario con un UPDATE condicional atómico', async () => {
    Suscripcion.update.mockResolvedValue([1]);
    const r = await SuscripcionService.vincularUsuario({ id: 55 }, 42, 'TOKEN123', 'TRX');
    expect(Suscripcion.update).toHaveBeenCalledWith(
      { usuario_id: 42, token_registro: null, token_registro_expira: null },
      { where: { id: 55, token_registro: 'TOKEN123', usuario_id: null }, transaction: 'TRX' },
    );
    expect(r).toEqual({ reclamada: true });
  });

  it('Concurrent Claim: si el UPDATE afecta 0 filas (otro registro ganó la carrera), no reclama', async () => {
    // La fila la reclamó otro request entre que se validó el token y que se
    // corrió este UPDATE — el WHERE (token + usuario_id IS NULL) ya no matchea.
    Suscripcion.update.mockResolvedValue([0]);
    const r = await SuscripcionService.vincularUsuario({ id: 55 }, 42, 'TOKEN123', 'TRX');
    expect(r).toEqual({ reclamada: false });
  });
});

describe('Recovery Path — reclamar por email verificado', () => {
  const planFounders = { id: 1, codigo: 'founders', nombre: 'Fundadores', equivale_plan: 'pago' };

  it('0 candidatas: no hay nada para reclamar', async () => {
    Suscripcion.findAll.mockResolvedValue([]);
    const r = await SuscripcionService.reclamarPorEmailVerificado({
      usuarioId: 9, email: 'nadie@x.com', transaction: { LOCK: { UPDATE: 'UPDATE' } },
    });
    expect(r).toEqual({ resultado: 'ninguna' });
    expect(Suscripcion.update).not.toHaveBeenCalled();
  });

  it('1 candidata: la reclama atómicamente y activa el plan', async () => {
    const susc = { id: 55, Plan: planFounders };
    Suscripcion.findAll.mockResolvedValue([susc]);
    Suscripcion.update.mockResolvedValue([1]);
    Usuario.update.mockResolvedValue([1]);

    const r = await SuscripcionService.reclamarPorEmailVerificado({
      usuarioId: 9, email: 'una@x.com', transaction: { LOCK: { UPDATE: 'UPDATE' } },
    });

    expect(Suscripcion.update).toHaveBeenCalledWith(
      { usuario_id: 9 },
      expect.objectContaining({ where: { id: 55, usuario_id: null } }),
    );
    expect(Usuario.update).toHaveBeenCalledWith(
      { plan: 'pago' },
      expect.objectContaining({ where: { id: 9 } }),
    );
    expect(r.resultado).toBe('reclamada');
    expect(r.suscripcion).toBe(susc);
  });

  it('1 candidata pero la pierde en la carrera (0 filas afectadas): no reclama, no rompe', async () => {
    Suscripcion.findAll.mockResolvedValue([{ id: 55, Plan: planFounders }]);
    Suscripcion.update.mockResolvedValue([0]);

    const r = await SuscripcionService.reclamarPorEmailVerificado({
      usuarioId: 9, email: 'una@x.com', transaction: { LOCK: { UPDATE: 'UPDATE' } },
    });

    expect(r).toEqual({ resultado: 'ninguna' });
    expect(Usuario.update).not.toHaveBeenCalled();
  });

  it('N candidatas (>1): ambigüedad financiera, NO elige "la más reciente" — no vincula ninguna, y trae las referencias de pago', async () => {
    const candidatas = [
      { id: 55, Plan: planFounders },
      { id: 56, Plan: planFounders },
    ];
    const pagos = [
      { id: 1, suscripcion_id: 55, referencia: 'SUS55', hash_pedido: 'h55', monto: 47, pagado_en: new Date() },
      { id: 2, suscripcion_id: 56, referencia: 'SUS56', hash_pedido: 'h56', monto: 47, pagado_en: new Date() },
    ];
    Suscripcion.findAll.mockResolvedValue(candidatas);
    PagoSuscripcion.findAll.mockResolvedValue(pagos);

    const r = await SuscripcionService.reclamarPorEmailVerificado({
      usuarioId: 9, email: 'dos@x.com', transaction: { LOCK: { UPDATE: 'UPDATE' } },
    });

    expect(r.resultado).toBe('ambigua');
    expect(r.pagos).toEqual(pagos);
    expect(PagoSuscripcion.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ suscripcion_id: [55, 56], estado: 'PAID' }),
    }));
    expect(r.candidatas).toEqual(candidatas);
    expect(Suscripcion.update).not.toHaveBeenCalled();
    expect(Usuario.update).not.toHaveBeenCalled();
  });

  it('bloquea las candidatas con FOR UPDATE OF Suscripcion (no a secas: rompe contra Postgres real con el include de Plan)', async () => {
    Suscripcion.findAll.mockResolvedValue([]);
    await SuscripcionService.reclamarPorEmailVerificado({
      usuarioId: 9, email: 'x@x.com', transaction: { LOCK: { UPDATE: 'UPDATE' } },
    });
    expect(Suscripcion.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: 'x@x.com', estado: 'activa', usuario_id: null },
      lock: { level: 'UPDATE', of: Suscripcion },
    }));
  });
});

describe('Estado publico del pago', () => {
  it('entrega el token solo si esta pagado y sin usar', async () => {
    PagoSuscripcion.findOne.mockResolvedValue({ suscripcion_id: 55, estado: 'PAID', monto: 250000 });
    Suscripcion.findByPk.mockResolvedValue({
      estado: 'activa', email: 'a@b.com', usuario_id: null,
      token_registro: 'z'.repeat(64), Plan: planPro,
    });
    const e = await SuscripcionService.estadoPorHash(HASH);
    expect(e.token_registro).toHaveLength(64);
    expect(e.plan.codigo).toBe('pro');
  });

  it('NO entrega el token si la suscripcion ya tiene usuario', async () => {
    PagoSuscripcion.findOne.mockResolvedValue({ suscripcion_id: 55, estado: 'PAID', monto: 250000 });
    Suscripcion.findByPk.mockResolvedValue({
      estado: 'activa', email: 'a@b.com', usuario_id: 7,
      token_registro: 'z'.repeat(64), Plan: planPro,
    });
    const e = await SuscripcionService.estadoPorHash(HASH);
    expect(e.token_registro).toBeNull();
  });

  it('NO entrega el token si el pago sigue pendiente', async () => {
    PagoSuscripcion.findOne.mockResolvedValue({ suscripcion_id: 55, estado: 'PENDING', monto: 250000 });
    Suscripcion.findByPk.mockResolvedValue({
      estado: 'pendiente_pago', email: 'a@b.com', usuario_id: null,
      token_registro: null, Plan: planPro,
    });
    const e = await SuscripcionService.estadoPorHash(HASH);
    expect(e.token_registro).toBeNull();
  });
});
