'use strict';
const crypto = require('crypto');
const { IntegracionCredencial } = require('../models');

/**
 * Autenticación de la API de integraciones de productos (socios externos).
 * No hay sesión ni cookie: el sistema externo manda su API Key por
 * `Authorization: Bearer <key>`. Buscamos por el hash (no comparamos texto
 * plano con cada fila) porque la key tiene suficiente entropía como para
 * que la igualdad de hash sea segura — mismo criterio que un Personal
 * Access Token de GitHub.
 */
async function verificarApiKeyIntegracion(req, res, next) {
  const header = req.get('Authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!key) return res.status(401).json({ ok: false, codigo: 'API_KEY_FALTANTE', error: 'Mandá la API Key en el header Authorization: Bearer <key>.' });

  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const credencial = await IntegracionCredencial.findOne({ where: { api_key_hash: hash } });
  if (!credencial) return res.status(401).json({ ok: false, codigo: 'API_KEY_INVALIDA', error: 'API Key inválida.' });
  if (!credencial.activo) return res.status(403).json({ ok: false, codigo: 'INTEGRACION_INACTIVA', error: 'Esta API Key fue revocada.' });

  req.integracion = {
    id: credencial.id,
    inquilinoId: credencial.inquilino_id,
    tiendaId: credencial.tienda_id,
    usuarioId: credencial.usuario_id,
    codigo: credencial.codigo,
  };
  // No bloquea la respuesta: es solo informativo para el panel ("última actividad").
  credencial.update({ ultima_actividad_at: new Date() }).catch(() => {});
  next();
}

module.exports = { verificarApiKeyIntegracion };
