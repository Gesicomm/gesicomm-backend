const express = require('express');
const crypto = require('crypto');
const { verificarToken } = require('../middleware/autenticacion');
const { MetaIntegration } = require('../models');
const { auditoria } = require('../utils/logger');
const EncryptionService = require('../utils/EncryptionService');

const router = express.Router();

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const FB_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;
const FB_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v23.0';

// Helper for Meta API calls
const fetchMeta = async (url) => {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Error en Facebook API');
    return data;
};

// GET /api/meta/connect -> Inicia el flujo OAuth
router.get('/connect', verificarToken, (req, res) => {
    if (!FB_APP_ID || !FB_REDIRECT_URI) {
        return res.status(500).json({ message: 'Configuración de Meta ausente en el servidor' });
    }

    // Generar state para prevenir CSRF
    const state = crypto.randomBytes(16).toString('hex');
    
    // Guardar state en cookie firmada/httpOnly
    res.cookie('meta_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000 // 10 minutos
    });
    
    // Pasar tenantId para identificar de quién es el callback
    res.cookie('meta_oauth_tenant', req.usuario.tenantId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000 // 10 minutos
    });

    const scope = 'ads_management,business_management';
    const authUrl = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth`
        + `?client_id=${FB_APP_ID}`
        + `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}`
        + `&state=${state}`
        + `&scope=${scope}`;

    return res.redirect(authUrl);
});

// GET /api/meta/callback -> Retorno desde Facebook
router.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    const cookieState = req.cookies?.meta_oauth_state;
    const tenantId = req.cookies?.meta_oauth_tenant;
    
    const frontendRedirect = process.env.FRONTEND_URL || 'http://localhost:5173';

    // 1. Manejo de error de acceso denegado
    if (error) {
        return res.redirect(`${frontendRedirect}/settings?meta_error=${encodeURIComponent('Acceso denegado: ' + error_description)}`);
    }

    // 2. Validación de CSRF y sesión
    if (!state || state !== cookieState || !tenantId) {
        return res.redirect(`${frontendRedirect}/settings?meta_error=${encodeURIComponent('Error de validación de estado (CSRF) o sesión expirada')}`);
    }

    try {
        // 3. Intercambio de code por short-lived token
        const tokenUrl = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`
            + `?client_id=${FB_APP_ID}`
            + `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}`
            + `&client_secret=${FB_APP_SECRET}`
            + `&code=${code}`;
        
        const tokenData = await fetchMeta(tokenUrl);
        const shortLivedToken = tokenData.access_token;

        // 4. Intercambio por long-lived token (60 días)
        const exchangeUrl = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token`
            + `?grant_type=fb_exchange_token`
            + `&client_id=${FB_APP_ID}`
            + `&client_secret=${FB_APP_SECRET}`
            + `&fb_exchange_token=${shortLivedToken}`;
            
        const longLivedData = await fetchMeta(exchangeUrl);
        const longLivedToken = longLivedData.access_token;

        // 5. Cifrado del token
        const encryptedToken = EncryptionService.encrypt(longLivedToken);

        // 6. Guardar en base de datos
        // Como no le pegamos aún a /me/businesses simulamos el ID
        const businessIdSimulado = '10987654321'; 

        const [integracion, created] = await MetaIntegration.findOrCreate({
            where: { inquilino_id: tenantId },
            defaults: {
                access_token: encryptedToken,
                business_id: businessIdSimulado,
                estado: 'conectado'
            }
        });

        if (!created) {
            await integracion.update({
                access_token: encryptedToken,
                estado: 'conectado'
            });
        }

        // Limpiar cookies temporales
        res.clearCookie('meta_oauth_state');
        res.clearCookie('meta_oauth_tenant');

        return res.redirect(`${frontendRedirect}/settings?meta_success=true`);

    } catch (err) {
        console.error('Meta Callback Error:', err.message);
        return res.redirect(`${frontendRedirect}/settings?meta_error=${encodeURIComponent('Error al procesar el token de Meta')}`);
    }
});

// GET /api/meta/status
router.get('/status', verificarToken, async (req, res) => {
  try {
    const integracion = await MetaIntegration.findOne({
      where: { inquilino_id: req.usuario.tenantId }
    });
    
    if (!integracion || integracion.estado !== 'conectado') {
      return res.json({ status: 'desconectado' });
    }

    return res.json({ 
      status: 'conectado', 
      business_id: integracion.business_id
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

// GET /api/meta/data (Mocked para la UI actual)
router.get('/data', verificarToken, async (req, res) => {
  try {
    const integracion = await MetaIntegration.findOne({
      where: { inquilino_id: req.usuario.tenantId }
    });
    
    if (!integracion || integracion.estado !== 'conectado') {
      return res.status(400).json({ message: 'Meta no está conectado.' });
    }

    // Aquí normalmente se haría EncryptionService.decrypt(integracion.access_token)
    // y se llamaría a la Graph API. Enviamos mocks:
    const mockData = {
      business_id: integracion.business_id,
      campaigns: [
        {
          id: 'camp_001',
          name: 'Campaña Retargeting Activa',
          status: 'ACTIVE',
          insights: { presupuesto: '$1000.00', gasto: '$420.50', clicks: 8450, ctr: '3.5%', cpm: '$2.10', cpc: '$0.05' }
        }
      ]
    };

    return res.json(mockData);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error interno del servidor.' });
  }
});

module.exports = router;
