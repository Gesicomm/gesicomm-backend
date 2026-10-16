jest.mock('../models', () => ({ Landing: { findOne: jest.fn() } }));
for (const modulo of [
  '../services/pricing.service', '../services/tarifaDelivery.service', '../services/fulfillment.service',
  '../services/payments/paymentService', '../services/canalVenta.service', '../services/cupon.service',
  '../services/pedidoNumeracion.service', '../services/metaCapi.service', '../services/imagen.service',
  '../utils/rangoFechas', '../utils/historial',
]) jest.mock(modulo, () => ({}));

const LandingService = require('../services/landing.service');
const { Landing } = require('../models');
const PaymentService = require('../services/payments/paymentService');
const StockPorTienda = require('../services/stockPorTienda.service');
const TypographyService = require('../services/typography.service');

describe('configuración del lienzo en el catálogo público', () => {
  const codigo = { html: '<header>Encabezado propio</header>', css: '.brand{color:green}', js: '' };
  const venta = { inicio: {
    encabezado: { mostrar_nombre: false, logo_tamano: 100 },
    menu_links: ['Inicio', 'Productos', 'Promociones', 'Nosotros', 'Contacto'].map(texto => ({ texto, destino: '/' })),
  } };
  const vistas = {
    catalogo: { html: '<main>Catálogo propio</main>' },
    categoria: { html: '<main>Categoría propia</main>' },
    checkout: { html: '<main>Checkout propio</main>' },
    producto: { html: '<main>Ficha general</main>' },
    productos: { privado: { html: '<main>Ficha de otro producto</main>' } },
  };

  it('envía el nombre oculto, los cinco enlaces y el diseño guardado sin exponer overrides ni otras fichas', () => {
    const content = LandingService.contentCatalogoPublico({
      template: { kind: 'codigo' },
      content: { codigo, vistas, venta, overrides_producto: { privado: 'borrador' } },
    });
    expect(content.venta.inicio.encabezado.mostrar_nombre).toBe(false);
    expect(content.venta.inicio.menu_links.map(item => item.texto)).toEqual(['Inicio', 'Productos', 'Promociones', 'Nosotros', 'Contacto']);
    expect(content.codigo).toEqual(codigo);
    expect(content.vistas).toEqual({ catalogo: vistas.catalogo });
    expect(content.vistas).not.toHaveProperty('productos');
    expect(content).not.toHaveProperty('overrides_producto');
  });

  it('incluye las vistas de tienda en la portada aunque no haya ficha de producto', () => {
    expect(LandingService.vistasPublicas({ vistas: { catalogo: vistas.catalogo, categoria: vistas.categoria, checkout: vistas.checkout } }))
      .toEqual({ catalogo: vistas.catalogo, categoria: vistas.categoria, checkout: vistas.checkout });
  });

  it('conserva el catálogo liviano de las plantillas rígidas', () => {
    expect(LandingService.contentCatalogoPublico({ template: { kind: 'rigido' }, content: { codigo, venta } }))
      .toEqual({ ofertas_carrito: [] });
  });

  it.each([false, true])('la respuesta real del catálogo conserva el encabezado en modo preview=%s', async preview => {
    const landing = { id: 140, activo: true, tipo_pagina: 'inicio', template: { kind: 'codigo' }, content: { codigo, vistas, venta } };
    Landing.findOne.mockResolvedValue(landing);
    const items = jest.spyOn(LandingService, 'itemsDelLienzo').mockResolvedValue([]);
    const visibles = jest.spyOn(LandingService, 'whereVisibleEnTienda').mockResolvedValue({});
    const stock = jest.spyOn(StockPorTienda, 'ajustarStockALaTienda').mockResolvedValue();
    const typography = jest.spyOn(TypographyService, 'resolver').mockResolvedValue({});
    PaymentService.getPublicGateways = jest.fn().mockResolvedValue([]);
    try {
      const res = await LandingService.obtenerCatalogoPublico({ id: 69, activo: true, Usuario: { activo: true } }, null, preview);
      expect(res.disponible).toBe(true);
      expect(res.content.venta.inicio.encabezado.mostrar_nombre).toBe(false);
      expect(res.content.venta.inicio.menu_links).toHaveLength(5);
      expect(res.content.codigo).toEqual(codigo);
      expect(res.content.vistas.catalogo).toEqual(vistas.catalogo);
    } finally {
      items.mockRestore(); visibles.mockRestore(); stock.mockRestore(); typography.mockRestore();
    }
  });
});
