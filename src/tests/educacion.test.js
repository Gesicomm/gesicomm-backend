const educacionController = require('../controllers/educacionController');
const adminEducacionController = require('../controllers/adminEducacionController');
const { ModuloEducacion, Examen, PreguntaExamen, ProgresoUsuarioModulo, Usuario, Inquilino } = require('../models');
const { Op } = require('sequelize');

describe('Education & LMS Module Unit Tests', () => {
  jest.setTimeout(60000);
  let testUsuarioId = null;

  const cleanTestData = async () => {
    try {
      await ModuloEducacion.destroy({
        where: {
          titulo: {
            [Op.like]: 'TEST_EDU_%',
          },
        },
      });
      if (testUsuarioId) {
        await ProgresoUsuarioModulo.destroy({
          where: {
            usuario_id: testUsuarioId,
          },
        });
      }
    } catch (err) {
      console.error('Error cleaning test education data:', err);
    }
  };

  beforeAll(async () => {
    let user = await Usuario.findOne();
    if (!user) {
      let inq = await Inquilino.findOne();
      if (!inq) {
        inq = await Inquilino.create({ nombre_empresa: 'Test Tenant' });
      }
      user = await Usuario.create({
        inquilino_id: inq.id,
        nombre: 'Test User Edu',
        correo_electronico: 'test_edu@example.com',
        contrasena_hash: 'hash123',
      });
    }
    testUsuarioId = user.id;
  });

  beforeEach(async () => {
    await cleanTestData();
  });

  afterEach(async () => {
    await cleanTestData();
  });

  test('should create modules with integer IDs and test sequential unlocking and quiz grading', async () => {
    const reqCreateMod1 = {
      usuario: { id: testUsuarioId, tenantId: null },
      body: {
        titulo: 'TEST_EDU_MODULO_1: Introducción',
        descripcion: 'Primer módulo introductorio',
        orden: 1,
        video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        duracion_minutos: 10,
        menu_desbloqueado: 'mis-anuncios',
        activo: true,
        examen: {
          titulo: 'Examen de Introducción',
          descripcion: 'Evalúa tus conocimientos básicos',
          puntaje_minimo: 70,
          preguntas: [
            {
              pregunta: '¿Cuál es la capital de Paraguay?',
              tipo: 'opcion_multiple',
              opciones: [
                { id: '1', texto: 'Asunción' },
                { id: '2', texto: 'Encarnación' },
                { id: '3', texto: 'Ciudad del Este' }
              ],
              respuesta_correcta: '1',
              explicacion: 'Asunción es la capital de la República del Paraguay.',
              orden: 1,
            },
            {
              pregunta: '¿Gesicomm permite gestionar couriers?',
              tipo: 'verdadero_falso',
              opciones: [
                { id: 'V', texto: 'Verdadero' },
                { id: 'F', texto: 'Falso' }
              ],
              respuesta_correcta: 'V',
              explicacion: 'Gesicomm cuenta con un módulo logístico integral.',
              orden: 2,
            }
          ]
        }
      }
    };

    let resCreateMod1Data = null;
    const resCreateMod1 = {
      status(code) { this.statusCode = code; return this; },
      json(data) { resCreateMod1Data = data; return this; }
    };

    await adminEducacionController.createModulo(reqCreateMod1, resCreateMod1);
    expect(resCreateMod1.statusCode).toBe(201);
    expect(resCreateMod1Data.modulo).toBeDefined();
    expect(typeof resCreateMod1Data.modulo.id).toBe('number'); // No UUID
    const mod1Id = resCreateMod1Data.modulo.id;

    // 2. Admin creates Module 2
    const reqCreateMod2 = {
      usuario: { id: 1, tenantId: null },
      body: {
        titulo: 'TEST_EDU_MODULO_2: Campañas Avanzadas',
        descripcion: 'Segundo módulo de nivel intermedio',
        orden: 2,
        video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        duracion_minutos: 15,
        activo: true,
      }
    };

    let resCreateMod2Data = null;
    const resCreateMod2 = {
      status(code) { this.statusCode = code; return this; },
      json(data) { resCreateMod2Data = data; return this; }
    };

    await adminEducacionController.createModulo(reqCreateMod2, resCreateMod2);
    expect(resCreateMod2.statusCode).toBe(201);
    const mod2Id = resCreateMod2Data.modulo.id;

    // 3. User lists modules -> Modulo 1 should be unlocked, Modulo 2 locked
    const reqUserList = { usuario: { id: testUsuarioId } };
    let resUserListData = null;
    const resUserList = {
      json(data) { resUserListData = data; return this; },
      status(code) { this.statusCode = code; return this; }
    };

    await educacionController.getModulos(reqUserList, resUserList);
    const m1 = resUserListData.modulos.find(m => m.id === mod1Id);
    const m2 = resUserListData.modulos.find(m => m.id === mod2Id);

    expect(m1.desbloqueado).toBe(true);
    expect(m1.completado).toBe(false);
    expect(m2.desbloqueado).toBe(false);

    // 4. User views video of Module 1
    const reqVideo = { params: { id: mod1Id }, usuario: { id: testUsuarioId } };
    let resVideoData = null;
    const resVideo = {
      json(data) { resVideoData = data; return this; },
      status(code) { this.statusCode = code; return this; }
    };

    await educacionController.marcarVideoVisto(reqVideo, resVideo);
    expect(resVideoData.progreso.video_completado).toBe(true);
    expect(resVideoData.progreso.completado).toBe(false); // Has exam pending

    // 5. User submits failing exam (0%)
    const mod1Full = await ModuloEducacion.findByPk(mod1Id, {
      include: [{ model: Examen, as: 'examen', include: [{ model: PreguntaExamen, as: 'preguntas' }] }]
    });
    const preg1Id = mod1Full.examen.preguntas[0].id;
    const preg2Id = mod1Full.examen.preguntas[1].id;

    const reqFailExam = {
      params: { id: mod1Id },
      usuario: { id: testUsuarioId },
      body: {
        respuestas: {
          [preg1Id]: '999', // Incorrect
          [preg2Id]: 'F',   // Incorrect
        }
      }
    };
    let resFailExamData = null;
    const resFailExam = {
      json(data) { resFailExamData = data; return this; },
      status(code) { this.statusCode = code; return this; }
    };

    await educacionController.enviarExamen(reqFailExam, resFailExam);
    expect(resFailExamData.aprobado).toBe(false);
    expect(resFailExamData.puntaje).toBe(0);
    expect(resFailExamData.completado).toBe(false);

    // 6. User submits passing exam (100%)
    const reqPassExam = {
      params: { id: mod1Id },
      usuario: { id: testUsuarioId },
      body: {
        respuestas: {
          [preg1Id]: '1', // Correct
          [preg2Id]: 'V', // Correct
        }
      }
    };
    let resPassExamData = null;
    const resPassExam = {
      json(data) { resPassExamData = data; return this; },
      status(code) { this.statusCode = code; return this; }
    };

    await educacionController.enviarExamen(reqPassExam, resPassExam);
    expect(resPassExamData.aprobado).toBe(true);
    expect(resPassExamData.puntaje).toBe(100);
    expect(resPassExamData.completado).toBe(true);
    expect(resPassExamData.menu_desbloqueado).toBe('mis-anuncios');

    // 7. User lists modules again -> Modulo 2 should now be unlocked!
    await educacionController.getModulos(reqUserList, resUserList);
    const m1After = resUserListData.modulos.find(m => m.id === mod1Id);
    const m2After = resUserListData.modulos.find(m => m.id === mod2Id);

    expect(m1After.completado).toBe(true);
    expect(m2After.desbloqueado).toBe(true);

    // 8. Check sidebar progression status
    let resSidebarData = null;
    const resSidebar = {
      json(data) { resSidebarData = data; return this; },
      status(code) { this.statusCode = code; return this; }
    };
    await educacionController.getProgresoSidebar(reqUserList, resSidebar);
    expect(resSidebarData.menusDesbloqueados).toContain('mis-anuncios');
  });
});
