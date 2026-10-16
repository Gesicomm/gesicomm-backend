/**
 * Feed CSV del catálogo para Meta (services/metaFeed.service.js).
 * Sin base: se cubren las funciones puras (formato de fila, dominio) —
 * filasFeed() en sí se prueba por separado con los modelos mockeados.
 */

jest.mock('../models', () => ({
  Producto: { findAll: jest.fn() },
  ProductoImagen: { findAll: jest.fn() },
  Marca: {},
  PrecioUsuario: { findAll: jest.fn() },
}));
jest.mock('../services/landing.service', () => ({ whereVisibleEnTienda: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/stockPorTienda.service', () => ({ ajustarStockALaTienda: jest.fn() }));

const { filaCsv, dominioDeTienda, CAMPOS_CSV } = require('../services/metaFeed.service');

describe('metaFeed.service', () => {
  describe('dominioDeTienda', () => {
    it('usa el dominio propio cuando está verificado y habilitado', () => {
      const tienda = {
        dominio_propio_verificado: true, dominio_propio_habilitado: true,
        dominio_propio: 'llevalofacil.shop', subdominio: 'llevalofacil',
      };
      expect(dominioDeTienda(tienda)).toBe('llevalofacil.shop');
    });

    it('cae al subdominio de gesicomm.com si el dominio propio no está activo', () => {
      const tienda = { dominio_propio_verificado: false, dominio_propio_habilitado: true, dominio_propio: 'x.com', subdominio: 'llevalofacil' };
      expect(dominioDeTienda(tienda)).toBe('llevalofacil.gesicomm.com');
    });
  });

  describe('filaCsv', () => {
    const base = () => ({
      id: 5,
      slug: null,
      nombre: 'Zapatilla "Pro", edición límite',
      descripcion: '<b>Cómoda</b>&nbsp;y liviana',
      cantidadDisponible: 3,
      imagenUrl: 'https://cdn.gesicomm.com/x.jpg',
      precioEfectivo: 150000.6,
      marca: 'Llévalo Fácil',
    });

    it('arma las columnas en el orden declarado', () => {
      const fila = filaCsv(base(), 'llevalofacil.shop');
      expect(fila.split(',').length).toBeGreaterThanOrEqual(CAMPOS_CSV.length);
    });

    it('usa producto-{id} como content_id cuando no hay slug — mismo criterio que metaCapi', () => {
      const fila = filaCsv(base(), 'llevalofacil.shop');
      expect(fila).toContain('producto-5');
      expect(fila).toContain('https://llevalofacil.shop/producto-5');
    });

    it('usa el slug como content_id cuando existe', () => {
      const fila = filaCsv({ ...base(), slug: 'zapatilla-pro' }, 'llevalofacil.shop');
      expect(fila).toContain('https://llevalofacil.shop/zapatilla-pro');
    });

    it('redondea el precio y lo manda en PYG sin decimales', () => {
      const fila = filaCsv(base(), 'llevalofacil.shop');
      expect(fila).toContain('150001 PYG');
    });

    it('in stock / out of stock según cantidadDisponible', () => {
      expect(filaCsv({ ...base(), cantidadDisponible: 0 }, 'x')).toContain('out of stock');
      expect(filaCsv({ ...base(), cantidadDisponible: 3 }, 'x')).toContain('in stock');
    });

    it('sin stock trackeado (null) siempre in stock', () => {
      expect(filaCsv({ ...base(), cantidadDisponible: null }, 'x')).toContain('in stock');
    });

    it('escapa comillas y comas (RFC 4180) en el título', () => {
      const fila = filaCsv(base(), 'x');
      expect(fila).toContain('"Zapatilla ""Pro"", edición límite"');
    });

    it('usa la marca resuelta tal cual se le pasa', () => {
      const fila = filaCsv({ ...base(), marca: 'Nike' }, 'x');
      expect(fila.endsWith(',Nike')).toBe(true);
    });

    it('despoja el HTML de la descripción', () => {
      const fila = filaCsv({ ...base(), descripcion: '<p>Hecho a mano</p>' }, 'x');
      expect(fila).toContain('Hecho a mano');
      expect(fila).not.toContain('<p>');
    });
  });
});
