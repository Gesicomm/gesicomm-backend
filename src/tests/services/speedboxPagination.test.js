'use strict';
const { Op } = require('sequelize');

jest.mock('../../models', () => {
  return {
    sequelize: {
      query: jest.fn(),
      transaction: jest.fn(),
    },
    Tienda: { findAll: jest.fn(), findOne: jest.fn() },
    Envio: { findAll: jest.fn(), findOne: jest.fn() },
    SpeedboxTienda: { findAll: jest.fn(), findOrCreate: jest.fn(), findOne: jest.fn() },
    SpeedboxPedido: { findAll: jest.fn(), findAndCountAll: jest.fn(), count: jest.fn() },
    SpeedboxEvento: { findAll: jest.fn(), findAndCountAll: jest.fn() },
    SolicitudAbastecimiento: { findAll: jest.fn(), findAndCountAll: jest.fn() },
  };
});

jest.mock('../../services/pedidoIdentificador.service', () => ({
  adjuntarIdentificadores: jest.fn(async envios => envios.map(e => ({ ...e, numero_pedido_visible: `SOM-${e.numero_pedido || e.id}` }))),
  numeroPedidoVisible: jest.fn(envio => `SOM-${envio.numero_pedido || envio.id}`),
  filtroNumeroPedidoVisible: jest.fn(texto => ({ numero_pedido: 1036 })),
}));

const models = require('../../models');
const {
  listarPedidosPaginados,
  listarImportesPaginados,
  listarCostosReposicionPaginados,
  listarMovimientosPaginados,
} = require('../../services/speedbox/service');

describe('Speedbox pagination & dynamic filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listarPedidosPaginados', () => {
    it('returns paginated orders with minimal payload and applied filters', async () => {
      models.SpeedboxPedido.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: 10,
            envio_id: 36,
            solicitud_abastecimiento_id: null,
            external_order_id: 'GESICOMM-sandbox-3-1040',
            order_id: '900000000275054',
            environment: 'sandbox',
            estado: 'enviado',
            status: 'pendiente_confirmacion',
            remote_http_status: 201,
            error: null,
            request_payload: { tienda_id: '67', store_name: 'sommix' },
            updated_at: '2026-10-18T10:00:00Z',
            envio: { id: 36, numero_pedido: 1036, tienda_id: 1, usuario_id: 3 },
          },
        ],
      });

      const res = await listarPedidosPaginados(3, {
        page: 2,
        limit: 10,
        ambiente: 'sandbox',
        estado: 'enviado',
        status: 'pendiente_confirmacion',
      });

      expect(models.SpeedboxPedido.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            usuario_id: 3,
            environment: 'sandbox',
            estado: 'enviado',
            status: 'pendiente_confirmacion',
          }),
          limit: 10,
          offset: 10,
        })
      );

      expect(res.paginacion).toEqual({
        page: 2,
        limit: 10,
        total: 1,
        totalPages: 1,
      });

      expect(res.items[0]).toEqual({
        id: 10,
        envio_id: 36,
        solicitud_abastecimiento_id: null,
        numero_pedido_visible: 'SOM-1036',
        environment: 'sandbox',
        raha_tienda_id: '67',
        raha_store_name: 'sommix',
        external_order_id: 'GESICOMM-sandbox-3-1040',
        order_id: '900000000275054',
        estado: 'enviado',
        status: 'pendiente_confirmacion',
        remote_http_status: 201,
        error: null,
        updated_at: '2026-10-18T10:00:00Z',
      });
      // request_payload should NOT be leaked in the minimal item
      expect(res.items[0].request_payload).toBeUndefined();
    });
  });

  describe('listarImportesPaginados', () => {
    it('returns minimal financial breakdown per order', async () => {
      models.SpeedboxPedido.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: 10,
            envio_id: 36,
            external_order_id: 'GESICOMM-sandbox-3-1040',
            updated_at: '2026-10-18T10:00:00Z',
            envio: {
              id: 36,
              numero_pedido: 1036,
              monto: 202963,
              costo_envio: 0,
              costo_fulfillment: 0,
              delivery_a_cargo: 'negocio',
              pago_anticipado: false,
              abastecimiento_estado: 'no_requiere',
              abastecimiento_costo: 0,
              abastecimiento_pagado_at: null,
              estado_financiero: 'pendiente_liquidacion',
            },
          },
        ],
      });

      const res = await listarImportesPaginados(3, {
        page: 1,
        limit: 10,
        cobro_cliente: 'contra_entrega',
        estado_financiero: 'pendiente_liquidacion',
      });

      expect(res.items[0]).toEqual({
        id: 10,
        envio_id: 36,
        numero_pedido_visible: 'SOM-1036',
        venta: 202963,
        envio_cliente: 0,
        delivery_a_cargo: 'negocio',
        fulfillment: 0,
        costo_abastecimiento: 0,
        pago_proveedor: 'no_requiere',
        cobro_cliente: 'contra_entrega',
        estado_financiero: 'pendiente_liquidacion',
      });
      expect(res.paginacion.total).toBe(1);
    });
  });

  describe('listarCostosReposicionPaginados', () => {
    it('filters replenishment costs by id and status', async () => {
      models.SolicitudAbastecimiento.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: 24,
            costo_producto: 55767,
            costo_logistico: 20000,
            estado: 'pendiente_pago',
            created_at: '2026-10-18T10:00:00Z',
          },
        ],
      });

      const res = await listarCostosReposicionPaginados(3, {
        page: 1,
        limit: 10,
        search: 'SOL-24',
        estado: 'pendiente_pago',
      });

      expect(models.SolicitudAbastecimiento.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            usuario_id: 3,
            id: 24,
            estado: 'pendiente_pago',
          }),
        })
      );
      expect(res.items[0]).toEqual({
        id: 24,
        costo_producto: 55767,
        costo_logistico: 20000,
        estado: 'pendiente_pago',
        created_at: '2026-10-18T10:00:00Z',
      });
    });
  });

  describe('listarMovimientosPaginados', () => {
    it('returns wallet transactions with minimal payload and conciliation status', async () => {
      models.SpeedboxEvento.findAndCountAll.mockResolvedValue({
        count: 1,
        rows: [
          {
            id: 5,
            event_key: 'id:evt-5',
            tipo: 'wallet.transaction',
            order_id: '900000000275054',
            occurred_at: '2026-10-18T10:00:00Z',
            estado: 'procesado',
            detalle: 'Pago recibido',
            payload: { data: { amount: 150000, direction: 'credit' } },
            conciliacion: null,
          },
        ],
      });

      const res = await listarMovimientosPaginados(3, {
        page: 1,
        limit: 10,
        movimiento: 'credit',
      });

      expect(res.items[0]).toEqual({
        id: 5,
        event_key: 'id:evt-5',
        occurred_at: '2026-10-18T10:00:00Z',
        direction: 'credit',
        amount: 150000,
        concepto: null,
        solicitud_id: null,
        envio_id: null,
        numero_pedido_visible: null,
        detalle: 'Pago recibido',
        puede_conciliar: true,
        raw_payload: { data: { amount: 150000, direction: 'credit' } },
      });
    });
  });
});
