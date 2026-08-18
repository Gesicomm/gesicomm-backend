const { Op } = require('sequelize');
const landingTemplateCtrl = require('../controllers/landing-template.controller');
const landingCtrl = require('../controllers/landing.controller');
const { LandingTemplate, Tienda, Producto, Landing, Inquilino } = require('../models');

jest.setTimeout(30000);

describe('Funnels & Landing Templates Unit Tests', () => {

  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  const mockNext = jest.fn();

  let testInquilinoId;
  let testTiendaId;
  let testProductoId;
  let testTemplateId;

  beforeAll(async () => {
    // 1. Crear Inquilino de prueba
    const inq = await Inquilino.create({
      nombre: 'TEST_JEST_INQ',
      subdominio: 'test-jest-' + Date.now(),
      activo: true,
    });
    testInquilinoId = inq.id;

    const { Usuario } = require('../models');

    // 1.5 Crear Usuario de prueba
    const user = await Usuario.create({
      inquilino_id: testInquilinoId,
      nombre: 'Test User',
      correo_electronico: 'test' + Date.now() + '@jest.com',
      contrasena_hash: '123',
    });

    // 2. Crear Tienda de prueba
    const tienda = await Tienda.create({
      inquilino_id: testInquilinoId,
      usuario_id: user.id,
      nombre: 'Test Tienda',
      subdominio: 'tienda' + Date.now(),
      moneda: 'PYG',
    });
    testTiendaId = tienda.id;

    // 3. Crear Producto de prueba
    const prod = await Producto.create({
      inquilino_id: testInquilinoId,
      nombre: 'Producto Test Funnel',
      slug: 'producto-test-funnel-' + Date.now(),
      tipo_producto: 'fisico',
      precio: 100,
      stock: 10,
    });
    testProductoId = prod.id;

    // 4. Crear Template de prueba
    const tpl = await LandingTemplate.create({
      name: 'TEST_JEST_FUNNEL',
      slug: 'test-jest-' + Date.now(),
      funnel_type: 'direct_sale',
      status: 'published',
      schema: [{ id: 'header', type: 'header' }]
    });
    testTemplateId = tpl.id;
  });

  afterAll(async () => {
    // Limpiar base de datos
    await Landing.destroy({ where: { inquilino_id: testInquilinoId } }).catch(()=>null);
    if (testProductoId) await Producto.destroy({ where: { id: testProductoId } }).catch(()=>null);
    if (testTiendaId) await Tienda.destroy({ where: { id: testTiendaId } }).catch(()=>null);
    const { Usuario } = require('../models');
    await Usuario.destroy({ where: { inquilino_id: testInquilinoId } }).catch(()=>null);
    if (testInquilinoId) await Inquilino.destroy({ where: { id: testInquilinoId } }).catch(()=>null);
    if (testTemplateId) await LandingTemplate.destroy({ where: { id: testTemplateId } }).catch(()=>null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should list all published templates', async () => {
    const req = {};
    const res = mockRes();

    await landingTemplateCtrl.listar(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    const data = res.json.mock.calls[0][0];
    
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data.some(t => t.id === testTemplateId)).toBe(true);
  });

  test('should fail to instantiate if templateId is missing', async () => {
    const req = {
      inquilino: { id: testInquilinoId },
      params: { id: testProductoId },
      body: {} // Missing templateId
    };
    const res = mockRes();

    await landingCtrl.instanciarLanding(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Se requiere el ID del template.' });
  });

  test('should successfully instantiate a landing from a template (flujo normal)', async () => {
    const req = {
      inquilino: { id: testInquilinoId },
      params: { id: testProductoId },
      body: { templateId: testTemplateId }
    };
    const res = mockRes();

    await landingCtrl.instanciarLanding(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    
    const responseData = res.json.mock.calls[0][0];
    expect(responseData).toHaveProperty('message', 'Funnel configurado con éxito');
    expect(responseData).toHaveProperty('landing_id');
    expect(responseData).toHaveProperty('slug');
    expect(responseData.template_id).toBe(testTemplateId);

    // Verificar en BD
    const landing = await Landing.findByPk(responseData.landing_id);
    expect(landing).not.toBeNull();
    expect(landing.producto_id).toBe(testProductoId);
    expect(landing.template_id).toBe(testTemplateId);
    expect(landing.tipo_pagina).toBe('funnel');
  });

  test('should be idempotent (update existing landing) if called again (caso borde)', async () => {
    // Creamos un segundo template para simular el cambio de funnel
    const tpl2 = await LandingTemplate.create({
      name: 'TEST_JEST_FUNNEL_2',
      slug: 'test-jest-2-' + Date.now(),
      funnel_type: 'educational',
      status: 'published',
      schema: [{ id: 'hero', type: 'hero' }]
    });

    const req = {
      inquilino: { id: testInquilinoId },
      params: { id: testProductoId },
      body: { templateId: tpl2.id }
    };
    const res = mockRes();

    await landingCtrl.instanciarLanding(req, res, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    
    // Debería existir solo 1 landing asociada a este producto y esta tienda
    const landings = await Landing.findAll({
      where: { tienda_id: testTiendaId, producto_id: testProductoId }
    });

    expect(landings.length).toBe(1);
    expect(landings[0].template_id).toBe(tpl2.id); // template cambiado
    expect(landings[0].content).toEqual({}); // se limpió el contenido porque cambió de template

    await LandingTemplate.destroy({ where: { id: tpl2.id } });
  });

  test('should fail if product does not exist or belongs to another inquilino (caso borde)', async () => {
    const req = {
      inquilino: { id: testInquilinoId },
      params: { id: 999999 }, // No existe
      body: { templateId: testTemplateId }
    };
    const res = mockRes();

    await landingCtrl.instanciarLanding(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled(); // Se llamó a next(error)
    const err = mockNext.mock.calls[0][0];
    expect(err.message).toBe('Producto no encontrado.');
  });
});
