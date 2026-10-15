'use strict';

const McpService = require('../services/mcp.service');
const jwt = require('jsonwebtoken');

describe('McpService - Motor Comercial y Validaciones', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_mcp_12345';
  });

  describe('validarMotorComercial', () => {
    test('rechaza HTML que no tiene ningún botón de compra o agregar', () => {
      const html = '<div class="hero"><h1>Mi Tienda</h1><p>Bienvenido</p></div>';
      const res = McpService.validarMotorComercial(html, 'inicio');

      expect(res.valido).toBe(false);
      expect(res.errores.length).toBeGreaterThan(0);
      expect(res.errores[0]).toMatch(/Falta el botón de compra/);
    });

    test('acepta HTML que tiene data-gesicomm-comprar para carrito y píxel', () => {
      const html = `
        <div class="hero">
          <h1 data-gesicomm-bind="nombre">Producto</h1>
          <span data-gesicomm-bind="precio"></span>
          <button data-gesicomm-comprar>Comprar ahora</button>
        </div>
      `;
      const res = McpService.validarMotorComercial(html, 'inicio');

      expect(res.valido).toBe(true);
      expect(res.errores).toHaveLength(0);
    });

    test('acepta HTML que tiene data-gesicomm-agregar para catálogo', () => {
      const html = `
        <div class="card">
          <h2 data-gesicomm-bind="nombre">Item</h2>
          <button data-gesicomm-agregar>Agregar al carrito</button>
        </div>
      `;
      const res = McpService.validarMotorComercial(html, 'catalogo');

      expect(res.valido).toBe(true);
      expect(res.errores).toHaveLength(0);
    });

    test('advierte si se escribe lista ofertas_bump sin la casilla data-gesicomm-bump', () => {
      const html = `
        <div data-gesicomm-lista="ofertas_bump">
          <template>
            <div class="bump-card">
              <p data-gesicomm-bind="nombre"></p>
            </div>
          </template>
        </div>
        <button data-gesicomm-comprar>Comprar</button>
      `;
      const res = McpService.validarMotorComercial(html, 'producto');

      expect(res.valido).toBe(false);
      expect(res.errores.some(e => e.includes('data-gesicomm-bump'))).toBe(true);
    });
  });

  describe('generarTokenMCP', () => {
    test('genera un JWT válido con tiendaId y tipo mcp_access', () => {
      const usuario = {
        id: 15,
        nombre: 'Comerciante Test',
        email: 'test@gesicom.com',
        rol: 'admin',
        tenantId: 1,
      };
      const res = McpService.generarTokenMCP(usuario, 42);

      expect(res.token).toBeDefined();
      expect(res.tiendaId).toBe(42);
      expect(res.expiraEn).toBe('30d');

      const decodificado = jwt.verify(res.token, process.env.JWT_SECRET);
      expect(decodificado.id).toBe(15);
      expect(decodificado.tiendaId).toBe(42);
      expect(decodificado.tipo).toBe('mcp_access');
    });

    test('lanza error si no se proporciona tiendaId', () => {
      const usuario = { id: 15, tenantId: 1 };
      expect(() => McpService.generarTokenMCP(usuario, null)).toThrow(/Se requiere una tienda activa/);
    });
  });

  describe('guardarCodigo', () => {
    test('llama a buscarPropia y actualizarCodigo con el modelo Sequelize', async () => {
      const mockLanding = {
        id: 240,
        tienda_id: 1,
        content: {},
        changed: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };
      const LandingSimpleService = require('../services/landingSimple.service');
      jest.spyOn(LandingSimpleService, 'buscarPropia').mockResolvedValue(mockLanding);
      jest.spyOn(LandingSimpleService, 'actualizarCodigo').mockResolvedValue({ id: 240, content: {} });

      const html = '<button data-gesicomm-comprar>Comprar</button>';
      const res = await McpService.guardarCodigo(240, 1, 2, { vista: 'inicio', html });

      expect(LandingSimpleService.buscarPropia).toHaveBeenCalledWith(240, 1);
    });
  });

  describe('obtenerContextoComercial', () => {
    test('trae solo los productos de landing.items, toma precio_ancla y calcula descuento', async () => {
      const LandingSimpleService = require('../services/landingSimple.service');
      const { Producto, Tienda, Categoria } = require('../models');

      jest.spyOn(LandingSimpleService, 'obtener').mockResolvedValue({
        id: 240,
        titulo: 'sommix',
        slug: 'lienzo-sommix',
        activo: true,
        items: [
          { tipo: 'producto', referencia_id: 3355, precio_ancla: 605712, etiqueta: '30% OFF', mostrar_en_inicio: true, envio_incluido: false },
        ],
        content: {
          venta: {
            seleccion: 'todos',
            inicio: {
              banners: [{ id: 'b1', titulo: 'Promo', enlace: '/categoria/ofertas' }],
              secciones: [{ id: 's1', tipo: 'categoria', categoria: 'Accesorios Tech' }],
            },
            urgencia: { activo: true, titulo: 'Flash Sale' },
          },
        },
      });

      jest.spyOn(Tienda, 'findByPk').mockResolvedValue({ id: 1, inquilino_id: 2, nombre: 'Sommix' });
      jest.spyOn(Categoria, 'findAll').mockResolvedValue([]);
      jest.spyOn(Producto, 'findAll').mockResolvedValue([
        {
          id: 3355,
          nombre: '2 Sillas para Jardín',
          precio_base: 423998,
          precio_tachado: null,
          categoria: null,
          imagenes: [],
          ofertas: [],
          toJSON: () => ({ id: 3355, nombre: '2 Sillas para Jardín', precio_base: 423998, imagenes: [], ofertas: [] }),
        },
      ]);

      const res = await McpService.obtenerContextoComercial(240, 1);

      expect(res.productos).toHaveLength(1);
      expect(res.productos[0].id).toBe(3355);
      expect(res.productos[0].precio_venta_gs).toBe(423998);
      expect(res.productos[0].precio_antes_gs).toBe(605712);
      expect(res.productos[0].descuento_porcentaje).toBe(30);
      expect(res.configuracion_comercial.banners).toHaveLength(1);
      expect(res.configuracion_comercial.urgencia.titulo).toBe('Flash Sale');
      expect(res.contrato_motor_comercial.restriccion_estricta_productos).toBeDefined();
    });
  });
});
