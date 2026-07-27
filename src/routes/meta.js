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

// Helper para llamadas a la Graph API de Meta
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

    const state = crypto.randomBytes(16).toString('hex');

    res.cookie('meta_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000
    });

    res.cookie('meta_oauth_tenant', req.usuario.tenantId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000
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

    const frontendRedirect = process.env.FRONTEND_URL;

    // 1. Manejo de error de acceso denegado por parte del usuario
    if (error) {
        return res.redirect(`${frontendRedirect}/settings?meta_error=${encodeURIComponent('Acceso denegado: ' + error_description)}`);
    }

    // 2. Validación CSRF y sesión
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

        // 5. Obtener el Business ID real desde la Graph API
        const meUrl = `https://graph.facebook.com/${FB_API_VERSION}/me/businesses`
            + `?access_token=${longLivedToken}`
            + `&fields=id,name`;

        const businessData = await fetchMeta(meUrl);

        if (!businessData.data || businessData.data.length === 0) {
            return res.redirect(`${frontendRedirect}/settings?meta_error=${encodeURIComponent('No se encontró ningún Business Manager asociado a esta cuenta de Facebook.')}`);
        }

        // Tomamos el primer Business Manager de la cuenta
        const business = businessData.data[0];

        // 6. Cifrado del token
        const encryptedToken = EncryptionService.encrypt(longLivedToken);

        // 7. Guardar en base de datos con el Business ID real
        const [integracion, created] = await MetaIntegration.findOrCreate({
            where: { inquilino_id: tenantId },
            defaults: {
                access_token: encryptedToken,
                business_id: business.id,
                business_name: business.name,
                estado: 'conectado'
            }
        });

        if (!created) {
            await integracion.update({
                access_token: encryptedToken,
                business_id: business.id,
                business_name: business.name,
                estado: 'conectado'
            });
        }

        res.clearCookie('meta_oauth_state');
        res.clearCookie('meta_oauth_tenant');

        auditoria('META_CONECTADO', { tenantId, businessId: business.id });

        return res.redirect(`${frontendRedirect}/settings?meta_success=true`);

    } catch (err) {
        console.error('Meta Callback Error:', err.message);
        return res.redirect(`${frontendRedirect}/settings?meta_error=${encodeURIComponent('Error al procesar el token de Meta: ' + err.message)}`);
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
            business_id: integracion.business_id,
            business_name: integracion.business_name
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// GET /api/meta/data -> Datos reales desde la Graph API
router.get('/data', verificarToken, async (req, res) => {
    try {
        const integracion = await MetaIntegration.findOne({
            where: { inquilino_id: req.usuario.tenantId }
        });

        if (!integracion || integracion.estado !== 'conectado') {
            return res.status(400).json({ message: 'Meta no está conectado.' });
        }

        // Descifrar el token real
        const accessToken = EncryptionService.decrypt(integracion.access_token);

        // Obtener campañas reales del Ad Account asociado al Business Manager
        const adsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${integracion.business_id}/owned_ad_accounts`
            + `?access_token=${accessToken}`
            + `&fields=id,name,account_status,amount_spent,balance,currency`;

        const adsData = await fetchMeta(adsUrl);

        // Por cada Ad Account, obtener sus campañas activas con métricas
        const adAccounts = adsData.data || [];
        const campaignsResult = [];

        for (const account of adAccounts) {
            const campsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${account.id}/campaigns`
                + `?access_token=${accessToken}`
                + `&fields=id,name,status,insights{spend,clicks,ctr,cpm,cpc,impressions}`
                + `&effective_status=["ACTIVE","PAUSED"]`
                + `&limit=10`;

            const campsData = await fetchMeta(campsUrl);

            if (campsData.data) {
                for (const camp of campsData.data) {
                    const insight = camp.insights?.data?.[0] || {};
                    campaignsResult.push({
                        id: camp.id,
                        name: camp.name,
                        status: camp.status,
                        ad_account: account.name,
                        insights: {
                            gasto: insight.spend ? `$${parseFloat(insight.spend).toFixed(2)}` : '$0.00',
                            clicks: insight.clicks || 0,
                            impresiones: insight.impressions || 0,
                            ctr: insight.ctr ? `${parseFloat(insight.ctr).toFixed(2)}%` : '0%',
                            cpm: insight.cpm ? `$${parseFloat(insight.cpm).toFixed(2)}` : '$0.00',
                            cpc: insight.cpc ? `$${parseFloat(insight.cpc).toFixed(2)}` : '$0.00',
                        }
                    });
                }
            }
        }

        return res.json({
            business_id: integracion.business_id,
            business_name: integracion.business_name,
            ad_accounts: adAccounts.length,
            campaigns: campaignsResult
        });

    } catch (err) {
        console.error('Meta /data Error:', err.message);
        return res.status(500).json({ message: 'Error al obtener datos de Meta: ' + err.message });
    }
});

// POST /api/meta/disconnect -> Desconectar Meta
router.post('/disconnect', verificarToken, async (req, res) => {
    try {
        const integracion = await MetaIntegration.findOne({
            where: { inquilino_id: req.usuario.tenantId }
        });

        if (!integracion) {
            return res.status(404).json({ message: 'No hay integración de Meta para este tenant.' });
        }

        await integracion.update({
            access_token: null,
            business_id: null,
            business_name: null,
            estado: 'desconectado'
        });

        auditoria('META_DESCONECTADO', { tenantId: req.usuario.tenantId });

        return res.json({ message: 'Meta desconectado correctamente.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

module.exports = router;
