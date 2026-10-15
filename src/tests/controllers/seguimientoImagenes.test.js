'use strict';

const express = require('express');
const request = require('supertest');
jest.mock('../../models', () => ({
  Envio: { findOne: jest.fn() }, SpeedboxPedido: { findOne: jest.fn(async () => null) },
  EnvioItem: { name: 'EnvioItem' }, Producto: { name: 'Producto' }, ProductoImagen: { name: 'ProductoImagen' }, Oferta: { name: 'Oferta' },
}));
jest.mock('../../services/seguimiento/flujo.service', () => ({ asegurarFlujosBase: jest.fn(), estadoFlujosDelPedido: jest.fn() }));
jest.mock('../../services/seguimiento/pendientesSeguimiento.service', () => ({ FASE_COMPLETADA: 'CONFIRMADO_POR_OPERADOR' }));
jest.mock('../../services/queue/seguimientoQueue', () => ({ encolarRecordatorio: jest.fn() }));
jest.mock('../../utils/historial', () => ({ registrarHistorial: jest.fn() }));
jest.mock('../../services/pedidoIdentificador.service', () => ({ referenciaPedido: jest.fn(async () => 'MIT-1001') }));
jest.mock('../../services/seguimiento/imagenesPedido.service', () => ({
  ...jest.requireActual('../../services/seguimiento/imagenesPedido.service'), imagenParaCopiar: jest.fn(async () => Buffer.from('png')),
}));

const { Envio } = require('../../models');
const flujoService = require('../../services/seguimiento/flujo.service');
const { imagenParaCopiar } = require('../../services/seguimiento/imagenesPedido.service');
const controller = require('../../controllers/envioSeguimientoController');
const app = express();
app.use((req, res, next) => { req.usuario = { id: 7, tiendaId: 9, rol: 'usuario' }; next(); });
app.get('/envios/:id/flujos', controller.flujosDelPedido);
app.get('/envios/:id/imagenes/:itemId', controller.copiarImagenProducto);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

beforeEach(() => {
  jest.clearAllMocks();
  Envio.findOne.mockResolvedValue({ id: 50, usuario_id: 7, estado: 'Pendiente', nombre_cliente: 'María', items: [
    { id: 20, nombre_producto: 'Camisa', Producto: { imagenes: [{ id: 1, url: '/uploads/camisa.webp', storage_key: 'products/1/camisa.webp' }] } },
  ] });
  flujoService.estadoFlujosDelPedido.mockResolvedValue([{ tipo: 'CONFIRMACION_PEDIDO_WEB', fases: [
    { id: 101, mensaje: 'Hola {cliente_nombre}' }, { id: 102, mensaje: 'Recordatorio {pedido_id}' },
  ] }]);
});

test('cada fase incluye las imágenes del pedido y mantiene el mensaje resuelto', async () => {
  const res = await request(app).get('/envios/50/flujos');
  expect(res.status).toBe(200);
  expect(res.body[0].fases.map(f => f.mensaje_resuelto)).toEqual(['Hola María', 'Recordatorio MIT-1001']);
  for (const fase of res.body[0].fases) expect(fase.imagenes_productos).toEqual([{ item_id: 20, nombre: 'Camisa', url: '/uploads/camisa.webp' }]);
  const consulta = Envio.findOne.mock.calls[0][0];
  expect(consulta.where).toEqual({ id: '50', usuario_id: 7, tienda_id: 9 });
  expect(consulta.include[0].include[0].include[0].as).toBe('imagenes');
});

test('la copia entrega PNG privado y solo acepta un ítem perteneciente al pedido autorizado', async () => {
  const res = await request(app).get('/envios/50/imagenes/20');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('image/png');
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(imagenParaCopiar).toHaveBeenCalledWith(expect.objectContaining({ item_id: 20 }));
  imagenParaCopiar.mockClear();
  expect((await request(app).get('/envios/50/imagenes/999')).status).toBe(404);
  Envio.findOne.mockResolvedValue(null);
  expect((await request(app).get('/envios/51/imagenes/20')).status).toBe(404);
  expect(imagenParaCopiar).not.toHaveBeenCalled();
});
