/**
 * Calificación de clientes del Dashboard Operativo (Comportamiento e
 * Histórico): una devolución injustificada marca al cliente como
 * problemático aunque haya recibido otros pedidos; una justificada no lo
 * penaliza.
 */
jest.mock('../models', () => ({ Envio: {}, EnvioItem: {} }));

const ReporteService = require('../services/reporteService');

const historial = (extra) => ({ entregados: 0, devoluciones_injustificadas: 0, ...extra });

describe('ReporteService._calificarCliente', () => {
  test('sin entregas ni devoluciones', () => {
    expect(ReporteService._calificarCliente(historial())).toBe('sin_entregas');
  });

  test('una entrega = bueno, dos o más = recurrente', () => {
    expect(ReporteService._calificarCliente(historial({ entregados: 1 }))).toBe('bueno');
    expect(ReporteService._calificarCliente(historial({ entregados: 3 }))).toBe('recurrente');
  });

  test('la devolución justificada no penaliza', () => {
    expect(ReporteService._calificarCliente(historial({ entregados: 1, devoluciones_justificadas: 2 }))).toBe('bueno');
  });

  test('una injustificada pesa más que las entregas', () => {
    expect(ReporteService._calificarCliente(historial({ entregados: 5, devoluciones_injustificadas: 1 }))).toBe('problematico');
  });
});
