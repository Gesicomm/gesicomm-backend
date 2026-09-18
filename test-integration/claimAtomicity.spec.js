'use strict';

/**
 * Contra Postgres real (no mocks): las garantías de atomicidad, rollback,
 * Recovery Path, ambigüedad y replay que en suscripcionFlujo.test.js se
 * verifican con modelos mockeados. Acá lo que se comprueba es que
 * PostgreSQL efectivamente se comporta como esos mocks asumen.
 */
const crypto = require('crypto');
const SuscripcionService = require('../src/services/suscripcion.service');
const AuthTracking = require('../src/services/authTracking.service');
const {
  sequelize, Usuario, Suscripcion, PagoSuscripcion, AuthEvent, AuthNotification,
  correoUnico, crearUsuarioNoVerificado, crearSuscripcionPagada, getInquilinoId,
} = require('./helpers');

afterAll(async () => { await sequelize.close(); });

describe('1) Concurrent Claim — dos transacciones reclamando la misma Suscripcion por token', () => {
  it('exactamente una gana; la otra recibe reclamada=false; al final hay un solo usuario_id', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const email = correoUnico('claim');
    const { suscripcion } = await crearSuscripcionPagada({
      email, tokenRegistro: token, tokenExpira: new Date(Date.now() + 3600 * 1000),
    });
    const usuarioA = await crearUsuarioNoVerificado();
    const usuarioB = await crearUsuarioNoVerificado();

    const intentar = usuarioId => sequelize.transaction(t => (
      SuscripcionService.vincularUsuario(suscripcion, usuarioId, token, t)
    ));

    const [rA, rB] = await Promise.all([intentar(usuarioA.id), intentar(usuarioB.id)]);

    expect([rA.reclamada, rB.reclamada].filter(Boolean)).toHaveLength(1);

    const fresca = await Suscripcion.findByPk(suscripcion.id);
    const ganador = rA.reclamada ? usuarioA.id : usuarioB.id;
    expect(fresca.usuario_id).toBe(ganador);
    expect(fresca.token_registro).toBeNull();
  });
});

describe('2) Dos registros concurrentes con el mismo correo', () => {
  it('el UNIQUE real de usuarios.correo_electronico deja pasar una sola fila, sin estado parcial', async () => {
    const email = correoUnico('dup');
    const inquilinoId = await getInquilinoId();

    const intentar = () => Usuario.create({
      inquilino_id: inquilinoId,
      nombre: 'Doble Submit',
      correo_electronico: email,
      contrasena_hash: 'hash',
      email_verificado: false,
    }).then(u => ({ ok: true, id: u.id })).catch(err => ({ ok: false, err }));

    const [r1, r2] = await Promise.all([intentar(), intentar()]);
    const exitosos = [r1, r2].filter(r => r.ok);
    const fallidos = [r1, r2].filter(r => !r.ok);

    expect(exitosos).toHaveLength(1);
    expect(fallidos).toHaveLength(1);
    // Es el error específico que auth.js ahora atrapa para devolver 400 en
    // vez de un 500 crudo (ver el catch de POST /register).
    expect(fallidos[0].err.name).toBe('SequelizeUniqueConstraintError');

    const filas = await Usuario.findAll({ where: { correo_electronico: email } });
    expect(filas).toHaveLength(1);
  });
});

describe('3) Rollback transaccional', () => {
  it('si el reclamo de la suscripción falla dentro de la transacción, el Usuario creado en la misma transacción tampoco queda persistido', async () => {
    const email = correoUnico('rollback');
    const inquilinoId = await getInquilinoId();
    let usuarioIdCreado;

    await expect(sequelize.transaction(async (t) => {
      const usuario = await Usuario.create({
        inquilino_id: inquilinoId,
        nombre: 'Rollback Test',
        correo_electronico: email,
        contrasena_hash: 'hash',
        email_verificado: false,
      }, { transaction: t });
      usuarioIdCreado = usuario.id;

      // Mismo patrón que vincularUsuario: un UPDATE condicional que no
      // matchea ninguna fila (id inexistente) se trata como fallo de
      // reclamo, igual que en auth.js cuando `reclamada === false`.
      const [filas] = await Suscripcion.update(
        { usuario_id: usuario.id },
        { where: { id: -1, usuario_id: null }, transaction: t },
      );
      if (filas !== 1) throw new Error('reclamo fallido, forzando rollback');
    })).rejects.toThrow('reclamo fallido');

    const usuarioPostRollback = await Usuario.findByPk(usuarioIdCreado);
    expect(usuarioPostRollback).toBeNull();
  });
});

describe('4) Recovery Path — feliz', () => {
  it('Suscripcion activa + usuario_id null se vincula recién tras el OTP, y queda vinculada exactamente una vez', async () => {
    const email = correoUnico('recovery');
    const { suscripcion } = await crearSuscripcionPagada({ email });
    const usuario = await crearUsuarioNoVerificado({ email });

    let fresca = await Suscripcion.findByPk(suscripcion.id);
    expect(fresca.usuario_id).toBeNull(); // antes del OTP: sin vincular, sostenido indefinidamente

    const resultado = await sequelize.transaction(t => (
      SuscripcionService.reclamarPorEmailVerificado({ usuarioId: usuario.id, email, transaction: t })
    ));

    expect(resultado.resultado).toBe('reclamada');

    fresca = await Suscripcion.findByPk(suscripcion.id);
    expect(fresca.usuario_id).toBe(usuario.id);

    const usuarioFresco = await Usuario.findByPk(usuario.id);
    expect(usuarioFresco.plan).toBe('pago');
  });
});

describe('5) Ambigüedad — dos compras PAID sin reclamar para el mismo email', () => {
  it('no vincula ninguna, y genera AuthEvent + AuthNotification persistentes con las referencias de pago', async () => {
    const email = correoUnico('ambiguo');
    const { pago: pago1, suscripcion: s1 } = await crearSuscripcionPagada({ email });
    const { pago: pago2, suscripcion: s2 } = await crearSuscripcionPagada({ email });
    const usuario = await crearUsuarioNoVerificado({ email });

    const resultado = await sequelize.transaction(t => (
      SuscripcionService.reclamarPorEmailVerificado({ usuarioId: usuario.id, email, transaction: t })
    ));

    expect(resultado.resultado).toBe('ambigua');
    expect(resultado.pagos.map(p => p.referencia).sort())
      .toEqual([pago1.referencia, pago2.referencia].sort());

    const [s1Fresca, s2Fresca] = await Promise.all([
      Suscripcion.findByPk(s1.id), Suscripcion.findByPk(s2.id),
    ]);
    expect(s1Fresca.usuario_id).toBeNull();
    expect(s2Fresca.usuario_id).toBeNull();

    // Lo mismo que hace auth.js en la rama 'ambigua' de /verify-email.
    await AuthTracking.registrarEventoConNotificacion({
      tipo: 'subscription_claim_ambiguous',
      req: { headers: {}, ip: '127.0.0.1' },
      usuario,
      email,
      metadata: {
        suscripcion_ids: [s1.id, s2.id],
        cantidad: 2,
        pagos: resultado.pagos.map(p => ({ referencia: p.referencia, hash_pedido: p.hash_pedido, monto: p.monto })),
      },
    });

    const evento = await AuthEvent.findOne({
      where: { tipo: 'subscription_claim_ambiguous', usuario_id: usuario.id },
      order: [['id', 'DESC']],
    });
    expect(evento).not.toBeNull();
    expect(evento.metadata.pagos.map(p => p.referencia).sort())
      .toEqual([pago1.referencia, pago2.referencia].sort());

    const notificacion = await AuthNotification.findOne({
      where: { tipo: 'subscription_claim_ambiguous', usuario_id: usuario.id },
      order: [['id', 'DESC']],
    });
    expect(notificacion).not.toBeNull(); // trazable para soporte, no solo un push efímero
    expect(notificacion.metadata.pagos.map(p => p.referencia).sort())
      .toEqual([pago1.referencia, pago2.referencia].sort());
  });
});

describe('7) Replay', () => {
  it('reclamar una suscripción ya vinculada es un no-op: nunca cambia de dueño', async () => {
    const email = correoUnico('replay');
    const { suscripcion } = await crearSuscripcionPagada({ email });
    const usuarioOriginal = await crearUsuarioNoVerificado({ email });
    const usuarioAtacante = await crearUsuarioNoVerificado();

    const primero = await sequelize.transaction(t => (
      SuscripcionService.reclamarPorEmailVerificado({ usuarioId: usuarioOriginal.id, email, transaction: t })
    ));
    expect(primero.resultado).toBe('reclamada');

    // Replay/otro intento con el mismo correo pero apuntando a otro usuario.
    const segundo = await sequelize.transaction(t => (
      SuscripcionService.reclamarPorEmailVerificado({ usuarioId: usuarioAtacante.id, email, transaction: t })
    ));
    expect(segundo.resultado).toBe('ninguna'); // ya no hay candidatas

    const fresca = await Suscripcion.findByPk(suscripcion.id);
    expect(fresca.usuario_id).toBe(usuarioOriginal.id);
  });

  it('vincularUsuario con un token ya consumido no reclama de nuevo', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const email = correoUnico('replaytoken');
    const { suscripcion } = await crearSuscripcionPagada({
      email, tokenRegistro: token, tokenExpira: new Date(Date.now() + 3600 * 1000),
    });
    const usuarioOriginal = await crearUsuarioNoVerificado({ email });
    const usuarioReplay = await crearUsuarioNoVerificado();

    const primero = await sequelize.transaction(t => (
      SuscripcionService.vincularUsuario(suscripcion, usuarioOriginal.id, token, t)
    ));
    expect(primero.reclamada).toBe(true);

    const replay = await sequelize.transaction(t => (
      SuscripcionService.vincularUsuario(suscripcion, usuarioReplay.id, token, t)
    ));
    expect(replay.reclamada).toBe(false); // el WHERE ya no matchea: usuario_id no es null

    const fresca = await Suscripcion.findByPk(suscripcion.id);
    expect(fresca.usuario_id).toBe(usuarioOriginal.id);
  });
});
