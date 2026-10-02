'use strict';
const crypto = require('crypto');
const events = require('../services/speedbox/events');
const { environment } = require('../services/speedbox/service');

async function webhook(req, res, next) {
  const expected = process.env.SPEEDBOX_WEBHOOK_TOKEN;
  const token = req.get('X-Speedbox-Webhook-Token') || req.query.token;
  if (!expected || expected.length < 32) return res.status(503).json({ error: 'Webhook Speedbox no configurado.' });
  if (typeof token !== 'string' || token.length > 512 || !crypto.timingSafeEqual(
    crypto.createHash('sha256').update(token).digest(), crypto.createHash('sha256').update(expected).digest())) {
    return res.status(401).json({ error: 'Webhook no autorizado.' });
  }
  if (req.query.environment !== environment()) return res.status(409).json({ error: 'Ambiente del webhook incorrecto.' });
  if (req.get('X-Speedbox-Event') && req.get('X-Speedbox-Event') !== req.body?.event) {
    return res.status(400).json({ error: 'El tipo de evento no coincide.' });
  }
  if (!req.body?.event_id || !req.body?.occurred_at) return res.status(400).json({ error: 'event_id y occurred_at son obligatorios.' });
  try { return res.status(200).json(await events.ingest(req.body, 'webhook')); }
  catch (error) { return next(error); }
}

module.exports = { webhook };
