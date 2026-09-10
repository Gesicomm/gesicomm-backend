/**
 * Educación / LMS — desbloqueo secuencial, corrección de exámenes y menús.
 *
 * Antes esto era un único test end-to-end contra Postgres: buscaba o creaba
 * un usuario e inquilino reales, creaba módulos "TEST_EDU_*" y los borraba
 * en cada beforeEach/afterEach. Esa base es la de PRODUCCIÓN detrás de un
 * túnel (ver src/config/database): con el túnel abajo fallaba entera, y con
 * el túnel arriba escribía y borraba filas reales — incluso creaba un
 * usuario si no encontraba ninguno.
 *
 * Ahora los modelos se simulan y cada caso stubbea solo lo que ese
 * controller lee. Eso permitió además partir el test en casos separados y
 * cubrir reglas que el original no llegaba a tocar: la penalización por 3
 * intentos fallidos, el bloqueo de 4 horas, que se conserve el mejor
 * puntaje y que la respuesta nunca filtre las respuestas correctas.
 */

const mockTransaccion = { commit: jest.fn(), rollback: jest.fn() };

jest.mock('../models', () => ({
  sequelize: { transaction: jest.fn(async () => mockTransaccion) },
  ModuloEducacion: { findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn(), max: jest.fn(), update: jest.fn() },
  LeccionEducacion: { bulkCreate: jest.fn() },
  Examen: { create: jest.fn(), findOne: jest.fn() },
  PreguntaExamen: { bulkCreate: jest.fn(), destroy: jest.fn() },
  ProgresoUsuarioModulo: { findOrCreate: jest.fn(), destroy: jest.fn() },
  ProgresoUsuarioLeccion: { findAll: jest.fn(async () => []), findOrCreate: jest.fn() },
}));

const educacionController = require('../controllers/educacionController');
const adminEducacionController = require('../controllers/adminEducacionController');
const {
  ModuloEducacion, Examen, PreguntaExamen, ProgresoUsuarioModulo, ProgresoUsuarioLeccion,
} = require('../models');

const USUARIO = 42;

/** Doble de `res` que registra estado y cuerpo. */
const respuesta = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(data) { this.body = data; return this; },
});

/** Progreso con .save(), como la instancia de Sequelize. */
const progresoFalso = (datos = {}) => ({
  usuario_id: USUARIO,
  modulo_id: 1,
  video_completado: false,
  completado: false,
  examen_aprobado: false,
  intentos: 0,
  intentos_fallidos: 0,
  puntaje_obtenido: null,
  bloqueado_hasta: null,
  fecha_completado: null,
  save: jest.fn(async function guardar() { return this; }),
  ...datos,
});

const examenDeDosPreguntas = (extra = {}) => ({
  id: 100,
  puntaje_minimo: 70,
  activo: true,
  preguntas: [
    { id: 1, pregunta: '¿Capital de Paraguay?', respuesta_correcta: '1', explicacion: 'Asunción.' },
    { id: 2, pregunta: '¿Gesicomm gestiona couriers?', respuesta_correcta: 'V', explicacion: 'Sí.' },
  ],
  ...extra,
});

const modulo = (datos = {}) => ({
  id: 1,
  titulo: 'Introducción',
  orden: 1,
  duracion_minutos: 10,
  menu_desbloqueado: 'mis-anuncios',
  activo: true,
  lecciones: [],
  examen: null,
  progresos: [],
  ...datos,
});

beforeEach(() => {
  jest.clearAllMocks();
  ProgresoUsuarioLeccion.findAll.mockResolvedValue([]);
});

describe('createModulo', () => {
  it('crea el módulo con su examen y preguntas, y confirma la transacción', async () => {
    ModuloEducacion.max.mockResolvedValue(0);
    ModuloEducacion.create.mockResolvedValue({ id: 7, titulo: 'TEST_EDU_MODULO_1' });
    Examen.create.mockResolvedValue({ id: 100 });

    const req = {
      usuario: { id: USUARIO, tenantId: null },
      body: {
        titulo: 'TEST_EDU_MODULO_1: Introducción',
        descripcion: 'Primer módulo introductorio',
        orden: 1,
        duracion_minutos: 10,
        menu_desbloqueado: 'mis-anuncios',
        activo: true,
        examen: {
          titulo: 'Examen de Introducción',
          puntaje_minimo: 70,
          preguntas: [
            { pregunta: '¿Capital de Paraguay?', opciones: [{ id: '1', texto: 'Asunción' }], respuesta_correcta: '1' },
            { pregunta: '¿Gesicomm gestiona couriers?', opciones: [{ id: 'V', texto: 'Verdadero' }], respuesta_correcta: 'V' },
          ],
        },
      },
    };
    const res = respuesta();

    await adminEducacionController.createModulo(req, res);

    expect(res.statusCode).toBe(201);
    // Los ids son enteros, no UUID.
    expect(typeof res.body.modulo.id).toBe('number');

    expect(Examen.create.mock.calls[0][0]).toMatchObject({ modulo_id: 7, puntaje_minimo: 70 });
    const [preguntas] = PreguntaExamen.bulkCreate.mock.calls[0];
    expect(preguntas).toHaveLength(2);
    expect(preguntas[0]).toMatchObject({ examen_id: 100, respuesta_correcta: '1', orden: 1 });
    expect(mockTransaccion.commit).toHaveBeenCalled();
    expect(mockTransaccion.rollback).not.toHaveBeenCalled();
  });

  it('sin título rechaza y revierte', async () => {
    const res = respuesta();
    await adminEducacionController.createModulo({ usuario: { id: USUARIO }, body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(mockTransaccion.rollback).toHaveBeenCalled();
    expect(ModuloEducacion.create).not.toHaveBeenCalled();
  });

  it('pone el módulo al final de la ruta si no se pide un orden', async () => {
    ModuloEducacion.max.mockResolvedValue(4);
    ModuloEducacion.create.mockResolvedValue({ id: 8 });

    await adminEducacionController.createModulo(
      { usuario: { id: USUARIO }, body: { titulo: 'TEST_EDU_SIN_ORDEN' } },
      respuesta(),
    );

    expect(ModuloEducacion.create.mock.calls[0][0].orden).toBe(5);
  });
});

describe('getModulos — desbloqueo secuencial', () => {
  it('deja el primero abierto y el segundo cerrado', async () => {
    ModuloEducacion.findAll.mockResolvedValue([
      modulo({ id: 1, orden: 1, examen: examenDeDosPreguntas() }),
      modulo({ id: 2, orden: 2, titulo: 'Campañas Avanzadas', menu_desbloqueado: null, examen: examenDeDosPreguntas({ id: 200 }) }),
    ]);

    const res = respuesta();
    await educacionController.getModulos({ usuario: { id: USUARIO } }, res);

    const m1 = res.body.modulos.find((m) => m.id === 1);
    const m2 = res.body.modulos.find((m) => m.id === 2);

    expect(m1).toMatchObject({ desbloqueado: true, completado: false, tiene_examen: true, total_preguntas: 2 });
    expect(m2.desbloqueado).toBe(false);
  });

  it('aprobar el primero abre el segundo', async () => {
    ModuloEducacion.findAll.mockResolvedValue([
      modulo({ id: 1, orden: 1, examen: examenDeDosPreguntas(), progresos: [{ completado: true, examen_aprobado: true, puntaje_obtenido: 100 }] }),
      modulo({ id: 2, orden: 2, menu_desbloqueado: null, examen: examenDeDosPreguntas({ id: 200 }) }),
    ]);

    const res = respuesta();
    await educacionController.getModulos({ usuario: { id: USUARIO } }, res);

    expect(res.body.modulos.find((m) => m.id === 1)).toMatchObject({ completado: true, examen_aprobado: true, puntaje_obtenido: 100 });
    expect(res.body.modulos.find((m) => m.id === 2).desbloqueado).toBe(true);
    expect(res.body.estadisticas.modulos_completados).toBe(1);
  });

  it('un módulo sin examen se aprueba con solo mirar sus clases', async () => {
    ModuloEducacion.findAll.mockResolvedValue([
      modulo({ id: 1, orden: 1, examen: null, lecciones: [{ id: 11, titulo: 'Clase 1', orden: 1, duracion_min: 5 }] }),
      modulo({ id: 2, orden: 2, menu_desbloqueado: null, examen: examenDeDosPreguntas({ id: 200 }) }),
    ]);
    ProgresoUsuarioLeccion.findAll.mockResolvedValue([{ leccion_id: 11 }]);

    const res = respuesta();
    await educacionController.getModulos({ usuario: { id: USUARIO } }, res);

    const m1 = res.body.modulos.find((m) => m.id === 1);
    expect(m1).toMatchObject({ videos_completados: true, total_lecciones: 1, lecciones_completadas: 1 });
    expect(res.body.modulos.find((m) => m.id === 2).desbloqueado).toBe(true);
  });
});

describe('marcarVideoVisto', () => {
  it('marca el video pero no completa el módulo si tiene examen pendiente', async () => {
    ModuloEducacion.findByPk.mockResolvedValue(modulo({ examen: examenDeDosPreguntas() }));
    const progreso = progresoFalso();
    ProgresoUsuarioModulo.findOrCreate.mockResolvedValue([progreso, true]);

    const res = respuesta();
    await educacionController.marcarVideoVisto({ params: { id: 1 }, usuario: { id: USUARIO } }, res);

    expect(res.body.progreso.video_completado).toBe(true);
    expect(res.body.progreso.completado).toBe(false);
  });

  it('sin examen, ver el video completa el módulo', async () => {
    ModuloEducacion.findByPk.mockResolvedValue(modulo({ examen: null }));
    ProgresoUsuarioModulo.findOrCreate.mockResolvedValue([progresoFalso(), true]);

    const res = respuesta();
    await educacionController.marcarVideoVisto({ params: { id: 1 }, usuario: { id: USUARIO } }, res);

    expect(res.body.progreso.completado).toBe(true);
    expect(res.body.progreso.fecha_completado).toBeTruthy();
  });

  it('devuelve 404 si el módulo no existe', async () => {
    ModuloEducacion.findByPk.mockResolvedValue(null);

    const res = respuesta();
    await educacionController.marcarVideoVisto({ params: { id: 999 }, usuario: { id: USUARIO } }, res);

    expect(res.statusCode).toBe(404);
  });
});

describe('enviarExamen — corrección', () => {
  const enviar = async (respuestas, progreso = progresoFalso()) => {
    ModuloEducacion.findByPk.mockResolvedValue(modulo({ examen: examenDeDosPreguntas() }));
    ProgresoUsuarioModulo.findOrCreate.mockResolvedValue([progreso, false]);
    const res = respuesta();
    await educacionController.enviarExamen(
      { params: { id: 1 }, usuario: { id: USUARIO }, body: { respuestas } },
      res,
    );
    return { res, progreso };
  };

  it('reprueba con todo mal', async () => {
    const { res } = await enviar({ 1: '999', 2: 'F' });

    expect(res.body).toMatchObject({ aprobado: false, puntaje: 0, correctas: 0, completado: false });
    expect(res.body.menu_desbloqueado).toBeNull();
  });

  it('aprueba con todo bien y desbloquea el menú', async () => {
    const { res } = await enviar({ 1: '1', 2: 'V' });

    expect(res.body).toMatchObject({
      aprobado: true, puntaje: 100, correctas: 2, completado: true, menu_desbloqueado: 'mis-anuncios',
    });
  });

  it('reprueba por debajo del puntaje mínimo', async () => {
    // 1 de 2 = 50%, y el mínimo del examen es 70.
    const { res } = await enviar({ 1: '1', 2: 'F' });

    expect(res.body).toMatchObject({ puntaje: 50, aprobado: false, puntaje_minimo: 70 });
  });

  it('normaliza la respuesta: mayúsculas, espacios y varias opciones', async () => {
    ModuloEducacion.findByPk.mockResolvedValue(modulo({
      examen: examenDeDosPreguntas({
        preguntas: [{ id: 1, pregunta: 'Elegí dos', respuesta_correcta: 'a,b' }],
      }),
    }));
    ProgresoUsuarioModulo.findOrCreate.mockResolvedValue([progresoFalso(), false]);

    const res = respuesta();
    await educacionController.enviarExamen(
      { params: { id: 1 }, usuario: { id: USUARIO }, body: { respuestas: { 1: [' B ', 'a'] } } },
      res,
    );

    // El orden y la caja no importan; el contenido sí.
    expect(res.body).toMatchObject({ puntaje: 100, aprobado: true });
  });

  it('nunca devuelve las respuestas correctas ni las explicaciones', async () => {
    const { res } = await enviar({ 1: '999', 2: 'F' });

    const serializado = JSON.stringify(res.body);
    expect(serializado).not.toContain('respuesta_correcta');
    expect(serializado).not.toContain('explicacion');
    expect(serializado).not.toContain('Asunción');
  });

  it('conserva el mejor puntaje entre intentos', async () => {
    const progreso = progresoFalso({ puntaje_obtenido: 100, intentos: 1 });
    await enviar({ 1: '999', 2: 'F' }, progreso);

    // Reprobar después de haber aprobado no puede borrar el mejor puntaje.
    expect(progreso.puntaje_obtenido).toBe(100);
    expect(progreso.intentos).toBe(2);
  });

  it('al tercer intento fallido bloquea el examen por 4 horas', async () => {
    const progreso = progresoFalso({ intentos_fallidos: 2 });
    const { res } = await enviar({ 1: '999', 2: 'F' }, progreso);

    expect(res.body.bloqueado).toBe(true);
    expect(res.body.intentos_restantes).toBe(0);
    expect(res.body.segundos_restantes).toBe(4 * 60 * 60);
    expect(progreso.bloqueado_hasta).toBeInstanceOf(Date);
  });

  it('mientras está bloqueado no corrige y responde 403', async () => {
    const enUnaHora = new Date(Date.now() + 60 * 60 * 1000);
    const progreso = progresoFalso({ intentos_fallidos: 3, bloqueado_hasta: enUnaHora });
    const { res } = await enviar({ 1: '1', 2: 'V' }, progreso);

    expect(res.statusCode).toBe(403);
    expect(res.body.bloqueado).toBe(true);
    expect(progreso.save).not.toHaveBeenCalled();
  });

  it('cuando el bloqueo vence, se reinician los intentos fallidos', async () => {
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
    const progreso = progresoFalso({ intentos_fallidos: 3, bloqueado_hasta: haceUnaHora });
    const { res } = await enviar({ 1: '999', 2: 'F' }, progreso);

    expect(res.statusCode).toBe(200);
    // El contador arranca de cero: este fallo es el primero de la nueva tanda.
    expect(res.body.intentos_fallidos).toBe(1);
    expect(res.body.bloqueado).toBe(false);
  });

  it('devuelve 404 si el módulo no tiene examen activo', async () => {
    ModuloEducacion.findByPk.mockResolvedValue(modulo({ examen: null }));

    const res = respuesta();
    await educacionController.enviarExamen(
      { params: { id: 1 }, usuario: { id: USUARIO }, body: { respuestas: {} } },
      res,
    );

    expect(res.statusCode).toBe(404);
  });
});

describe('getProgresoSidebar', () => {
  it('desbloquea el menú del módulo aprobado y deja bloqueado el resto', async () => {
    ModuloEducacion.findAll.mockResolvedValue([
      modulo({ id: 1, orden: 1, menu_desbloqueado: 'mis-anuncios', progresos: [{ examen_aprobado: true }] }),
      modulo({ id: 2, orden: 2, titulo: 'Couriers', menu_desbloqueado: 'mis-pedidos', progresos: [] }),
    ]);

    const res = respuesta();
    await educacionController.getProgresoSidebar({ usuario: { id: USUARIO } }, res);

    expect(res.body.menusDesbloqueados).toContain('mis-anuncios');
    expect(res.body.menusDesbloqueados).not.toContain('mis-pedidos');
    expect(res.body.menusBloqueados['mis-pedidos']).toMatchObject({ modulo_id: 2, modulo_titulo: 'Couriers' });
  });

  it('ignora los módulos que no desbloquean ningún menú', async () => {
    ModuloEducacion.findAll.mockResolvedValue([
      modulo({ id: 1, menu_desbloqueado: null, progresos: [{ examen_aprobado: true }] }),
    ]);

    const res = respuesta();
    await educacionController.getProgresoSidebar({ usuario: { id: USUARIO } }, res);

    expect(res.body.menusDesbloqueados).toEqual([]);
    expect(res.body.menusBloqueados).toEqual({});
  });
});
