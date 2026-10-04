const express = require('express');
const request = require('supertest');
jest.mock('../services/speedbox/events', () => ({ ingest: jest.fn() }));
jest.mock('../services/speedbox/service', () => ({ environment: () => 'sandbox' }));
const events = require('../services/speedbox/events');
const { webhook } = require('../controllers/speedboxWebhook.controller');
const app = express(); app.use(express.json()); app.post('/api/webhooks/speedbox', webhook);
const payload = { event: 'shipment.status_changed', event_id: 'evt-1', occurred_at: '2026-10-02T12:00:00Z', data: { order_id: '900000000123456', status: 'en_camino' } };
const token = 'private-webhook-token-at-least-32-characters';
beforeEach(() => { jest.clearAllMocks(); process.env.SPEEDBOX_WEBHOOK_TOKEN = token; events.ingest.mockResolvedValue({ ok: true, status: 'en_camino' }); });
it('rejects a missing token without processing the event', async () => {
  await request(app).post('/api/webhooks/speedbox').send(payload).expect(401);
  expect(events.ingest).not.toHaveBeenCalled();
});
it('accepts the portal URL token and returns HTTP 200', async () => {
  const response = await request(app).post(`/api/webhooks/speedbox?environment=sandbox&token=${token}`).set('X-Speedbox-Event', payload.event).send(payload).expect(200);
  expect(response.body).toEqual({ ok: true, status: 'en_camino' });
});
it('rejects events from a different environment', async () => {
  await request(app).post(`/api/webhooks/speedbox?environment=production&token=${token}`).send(payload).expect(409);
});
it('requires a matching event header and event identifier', async () => {
  await request(app).post(`/api/webhooks/speedbox?environment=sandbox&token=${token}`).set('X-Speedbox-Event', 'wallet.transaction').send(payload).expect(400);
  await request(app).post(`/api/webhooks/speedbox?environment=sandbox&token=${token}`).send({ ...payload, event_id: null }).expect(400);
});
