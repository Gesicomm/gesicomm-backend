const { Envio, Courier, MetaCampanaLead } = require('../models');
const { getResumenFunnel, getCouriersAnalytics, getProductosAnalytics } = require('../services/pedidosAnalyticsService');

const canales = [{ id: 1, slug: 'web', nombre: 'Web' }, { id: 2, slug: 'whatsapp', nombre: 'WhatsApp' }];

describe('Dashboard: un mismo universo de pedidos', () => {
  afterEach(() => jest.restoreAllMocks());

  async function embudo(envios) {
    jest.spyOn(Envio, 'findAll').mockResolvedValue(envios.map((e, i) => ({
      id: i + 1, origen: 'WEB', es_lead: false, ...e,
    })));
    jest.spyOn(MetaCampanaLead, 'findAll').mockResolvedValue([]);
    return getResumenFunnel({}, canales);
  }

  it('cuenta despacho por estado operativo o logístico, sin inferirlo del courier', async () => {
    const resultado = await embudo([
      { estado: 'Pendiente', courier_id: 10 },
      { estado: 'Confirmado', courier_id: 10 },
      { estado: 'En tránsito' },
      { estado: 'Entregado' },
      { estado: 'Reprogramado' },
      { estado: 'Devuelto' },
      { estado: 'Pendiente', estado_logistico: 'asignado' },
    ]);
    expect(resultado.despachados).toBe(5);
  });

  it('separa leads y usa el estado operativo para entregados', async () => {
    const resultado = await embudo([
      { estado: 'Entregado' },
      { estado: 'Confirmado', estado_logistico: 'entregado' },
      { estado: 'Confirmado', es_lead: true },
    ]);
    expect(resultado.total_creados).toBe(2);
    expect(resultado.confirmados).toBe(2);
    expect(resultado.entregados).toBe(1);
    expect(resultado.tasa_confirmacion).toBe(100);
    expect(Object.values(resultado.por_estado_actual).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('excluye leads de los pedidos contados por courier', async () => {
    jest.spyOn(Courier, 'findAll').mockResolvedValue([]);
    const buscarPedidos = jest.spyOn(Envio, 'findAll').mockResolvedValue([
      { id: 1, courier_id: null, estado: 'Pendiente', costo_envio: 0 },
      { id: 2, courier_id: null, estado: 'Confirmado', costo_envio: 0 },
    ]);
    const filas = await getCouriersAnalytics({ usuario_id: 7 }, 7);
    expect(buscarPedidos).toHaveBeenCalledWith(expect.objectContaining({
      where: { usuario_id: 7, es_lead: false },
    }));
    expect(filas).toHaveLength(1);
    expect(filas[0].total_asignados).toBe(2);
  });

  it('no convierte la atribución publicitaria de un checkout web en lead', async () => {
    const resultado = await embudo([
      { estado: 'Pendiente', origen: 'LANDING' },
      { estado: 'Pendiente', origen: 'WHATSAPP', es_lead: true, lead_tipo_manual: 'organico' },
    ]);
    expect(resultado.canales.web.lead_campana).toBe(0);
    expect(resultado.canales.web.organico.total).toBe(0);
    expect(resultado.canales.whatsapp.organico.total).toBe(1);
  });

  it('cuenta por producto solo los leads registrados en Comercial', () => {
    const item = { producto_id: 10, nombre_producto: 'Producto', cantidad: 1, precio_unitario: 100000, subtotal: 100000 };
    const productos = getProductosAnalytics([
      { estado: 'Pendiente', origen: 'WHATSAPP', es_lead: true, items: [item] },
      { estado: 'Confirmado', origen: 'WHATSAPP', es_lead: false, lead_tipo_manual: 'organico', items: [item] },
      { estado: 'Pendiente', origen: 'LANDING', es_lead: false, items: [item] },
    ]);
    expect(productos[0].leads_registrados).toBe(2);
    expect(productos[0].leads_confirmados).toBe(1);
  });
});
