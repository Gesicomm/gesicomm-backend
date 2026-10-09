const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { verificarToken } = require('../middleware/autenticacion');
const { MetaIntegration } = require('../models');
const { auditoria } = require('../utils/logger');
const EncryptionService = require('../utils/EncryptionService');
const solicitudEliminacionController = require('../controllers/solicitudEliminacion.controller');

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

// Solo rutas internas del frontend. El destino final se arma como
// FRONTEND_URL + redirect_to, así que algo como "@otro-sitio.com" terminaba en
// https://gesicomm.com@otro-sitio.com: un open redirect.
const rutaInternaSegura = (ruta) => (
    typeof ruta === 'string' && /^\/(?![/\\])[^@\s]*$/.test(ruta) ? ruta : '/settings'
);

// Revoca la autorización de la app en Meta (DELETE /me/permissions).
//
// Revocar invalida TODOS los tokens de ese usuario de Meta para la app, no
// solo el de esta fila: si otra conexión (de otra tienda o de otro usuario de
// Gesicom) usa el mismo Business Manager, se deja la autorización viva y solo
// se borra el token local. El BM es un aproximado del usuario de Meta hasta
// que exista meta_integrations.meta_user_id. Nunca hace fallar la
// desconexión: si el token ya venció o Meta no responde, el borrado local
// sigue igual.
const revocarEnMeta = async (integracion) => {
    if (!integracion.access_token) return;
    try {
        const accessToken = EncryptionService.decrypt(integracion.access_token);

        if (integracion.business_id) {
            const otrasConexiones = await MetaIntegration.count({
                where: { business_id: integracion.business_id, estado: 'conectado', id: { [Op.ne]: integracion.id } }
            });
            if (otrasConexiones > 0) return;
        }

        const res = await fetch(
            `https://graph.facebook.com/${FB_API_VERSION}/me/permissions?access_token=${accessToken}`,
            { method: 'DELETE' }
        );
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        auditoria('META_PERMISOS_REVOCADOS', { integracionId: integracion.id });
    } catch (err) {
        console.warn(`No se pudo revocar en Meta la integración ${integracion.id}:`, err.message);
    }
};

// GET /api/meta/connect -> Inicia el flujo OAuth
// Query param opcional: ?mode=add_store para agregar una nueva tienda sin reemplazar la actual
// Query param opcional: ?redirect_to= para indicar a dónde redirigir al finalizar
router.get('/connect', verificarToken, (req, res) => {
    if (!FB_APP_ID || !FB_REDIRECT_URI) {
        return res.status(500).json({ message: 'Configuración de Meta ausente en el servidor' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const mode = req.query.mode || 'connect'; // 'connect' | 'add_store'
    const redirectTo = rutaInternaSegura(req.query.redirect_to);

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

    res.cookie('meta_oauth_user', req.usuario.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000
    });

    res.cookie('meta_oauth_mode', mode, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000
    });

    res.cookie('meta_oauth_redirect', redirectTo, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000
    });

    // Permisos mínimos: Gesicom solo LEE (nunca crea ni edita anuncios), así
    // que ads_management no corresponde. business_management hace falta para
    // /me/businesses y /{bm}/owned_ad_accounts, que arman el selector de BM.
    // Si se agrega un permiso, actualizar antes la Política de Privacidad (§4.1)
    // y Seguridad (§4.1), que los enumeran.
    const scope = 'ads_read,business_management';
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
    const userId = req.cookies?.meta_oauth_user;
    const mode = req.cookies?.meta_oauth_mode || 'connect';
    const redirectPath = rutaInternaSegura(req.cookies?.meta_oauth_redirect);

    const frontendRedirect = process.env.FRONTEND_URL;

    // 1. Manejo de error de acceso denegado por parte del usuario
    if (error) {
        res.clearCookie('meta_oauth_state');
        res.clearCookie('meta_oauth_tenant');
        res.clearCookie('meta_oauth_user');
        res.clearCookie('meta_oauth_mode');
        res.clearCookie('meta_oauth_redirect');
        return res.redirect(`${frontendRedirect}${redirectPath}?meta_error=${encodeURIComponent('Acceso denegado: ' + error_description)}`);
    }

    // 2. Validación CSRF y sesión
    if (!state || state !== cookieState || !tenantId || !userId) {
        res.clearCookie('meta_oauth_state');
        res.clearCookie('meta_oauth_tenant');
        res.clearCookie('meta_oauth_user');
        res.clearCookie('meta_oauth_mode');
        res.clearCookie('meta_oauth_redirect');
        return res.redirect(`${frontendRedirect}${redirectPath}?meta_error=${encodeURIComponent('Error de validación de estado (CSRF) o sesión expirada')}`);
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
            res.clearCookie('meta_oauth_state');
            res.clearCookie('meta_oauth_tenant');
            res.clearCookie('meta_oauth_user');
            res.clearCookie('meta_oauth_mode');
            res.clearCookie('meta_oauth_redirect');
            return res.redirect(`${frontendRedirect}${redirectPath}?meta_error=${encodeURIComponent('No se encontró ningún Business Manager asociado a esta cuenta de Facebook.')}`);
        }

        const business = businessData.data[0];
        const encryptedToken = EncryptionService.encrypt(longLivedToken);

        // 6. Guardar según el modo
        if (mode === 'add_store') {
            // Verificar que este BM no esté ya conectado para este tenant
            const existing = await MetaIntegration.findOne({
                where: { inquilino_id: tenantId, usuario_id: userId, business_id: business.id }
            });
            if (existing) {
                res.clearCookie('meta_oauth_state');
                res.clearCookie('meta_oauth_tenant');
                res.clearCookie('meta_oauth_user');
                res.clearCookie('meta_oauth_mode');
                res.clearCookie('meta_oauth_redirect');
                return res.redirect(`${frontendRedirect}${redirectPath}?meta_error=${encodeURIComponent('Esta tienda ya está conectada.')}`);
            }
            // Crear nuevo registro (sin reemplazar los existentes)
            await MetaIntegration.create({
                inquilino_id: tenantId,
                usuario_id: userId,
                nombre: business.name,
                access_token: encryptedToken,
                business_id: business.id,
                business_name: business.name,
                estado: 'conectado'
            });
        } else {
            // Modo original: upsert del primer registro del tenant
            const [integracion, created] = await MetaIntegration.findOrCreate({
                where: { inquilino_id: tenantId, usuario_id: userId, business_id: business.id },
                defaults: {
                    nombre: business.name,
                    access_token: encryptedToken,
                    business_name: business.name,
                    estado: 'conectado'
                }
            });
            if (!created) {
                await integracion.update({
                    nombre: business.name,
                    access_token: encryptedToken,
                    business_name: business.name,
                    estado: 'conectado'
                });
            }
        }

        res.clearCookie('meta_oauth_state');
        res.clearCookie('meta_oauth_tenant');
        res.clearCookie('meta_oauth_user');
        res.clearCookie('meta_oauth_mode');
        res.clearCookie('meta_oauth_redirect');

        auditoria('META_CONECTADO', { tenantId, businessId: business.id, mode });

        return res.redirect(`${frontendRedirect}${redirectPath}?meta_success=true`);

    } catch (err) {
        res.clearCookie('meta_oauth_state');
        res.clearCookie('meta_oauth_tenant');
        res.clearCookie('meta_oauth_user');
        res.clearCookie('meta_oauth_mode');
        res.clearCookie('meta_oauth_redirect');
        console.error('Meta Callback Error:', err.message);
        return res.redirect(`${frontendRedirect}${redirectPath}?meta_error=${encodeURIComponent('Error al procesar el token de Meta: ' + err.message)}`);
    }
});

// GET /api/meta/status -> Compatibilidad hacia atrás (usa la primera tienda activa)
router.get('/status', verificarToken, async (req, res) => {
    try {
        const integracion = await MetaIntegration.findOne({
            where: { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' },
            order: [['createdAt', 'ASC']]
        });

        if (!integracion) {
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

// GET /api/meta/stores -> Lista todas las tiendas conectadas del tenant
router.get('/stores', verificarToken, async (req, res) => {
    try {
        const tiendas = await MetaIntegration.findAll({
            where: { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id },
            attributes: ['id', 'nombre', 'business_id', 'business_name', 'estado', 'createdAt'],
            order: [['createdAt', 'ASC']]
        });
        return res.json({ tiendas });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// DELETE /api/meta/stores/:id -> Elimina una tienda específica
router.delete('/stores/:id', verificarToken, async (req, res) => {
    try {
        const integracion = await MetaIntegration.findOne({
            where: { id: req.params.id, inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id }
        });
        if (!integracion) {
            return res.status(404).json({ message: 'Tienda no encontrada.' });
        }
        await revocarEnMeta(integracion);
        await integracion.destroy();
        auditoria('META_DESCONECTADO', { tenantId: req.usuario.tenantId, integracionId: integracion.id });
        return res.json({ message: 'Tienda desconectada correctamente.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
});

// POST /api/meta/filters -> Retorna los selects disponibles (Business y Ad Accounts)
router.post('/filters', verificarToken, async (req, res) => {
    try {
        const { store_id } = req.body;

        // Buscar la tienda específica o la primera activa del tenant
        const whereClause = store_id
            ? { id: store_id, inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' }
            : { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' };

        const integracion = await MetaIntegration.findOne({
            where: whereClause,
            order: [['createdAt', 'ASC']]
        });

        if (!integracion) {
            return res.status(400).json({ message: 'Meta no está conectado.' });
        }

        const accessToken = EncryptionService.decrypt(integracion.access_token);

        // Portafolios (Business Managers)
        const bmUrl = `https://graph.facebook.com/${FB_API_VERSION}/me/businesses?access_token=${accessToken}&fields=id,name`;
        const bmData = await fetchMeta(bmUrl);

        const businesses = bmData.data || [];

        // Por cada BM, obtener SOLO las cuentas que le pertenecen (owned)
        // Esto excluye cuentas compartidas en Read-Only y cuentas personales
        const adAccounts = [];
        for (const bm of businesses) {
            try {
                const ownedUrl = `https://graph.facebook.com/${FB_API_VERSION}/${bm.id}/owned_ad_accounts?access_token=${accessToken}&fields=id,name,account_status,currency&limit=50`;
                const ownedData = await fetchMeta(ownedUrl);
                if (ownedData.data) {
                    ownedData.data.forEach(ad => {
                        ad.business = { id: bm.id, name: bm.name };
                        adAccounts.push(ad);
                    });
                }
            } catch (err) {
                console.log(`No se pudieron leer owned_ad_accounts para BM ${bm.id}:`, err.message);
            }
        }

        return res.json({
            businesses: businesses,
            ad_accounts: adAccounts,
        });
    } catch (err) {
        console.error('Meta /filters Error:', err.message);
        return res.status(500).json({ message: 'Error al cargar filtros de Meta: ' + err.message });
    }
});

// POST /api/meta/campaign-list -> Retorna solo ID y Nombre de campañas para el select
router.post('/campaign-list', verificarToken, async (req, res) => {
    try {
        const { ad_account_id, store_id } = req.body;
        if (!ad_account_id) return res.json({ campaigns: [] });

        const whereClause = store_id
            ? { id: store_id, inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' }
            : { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' };

        const integracion = await MetaIntegration.findOne({
            where: whereClause,
            order: [['createdAt', 'ASC']]
        });
        if (!integracion) {
            return res.status(400).json({ message: 'Meta no está conectado.' });
        }

        const accessToken = EncryptionService.decrypt(integracion.access_token);
        
        // Obtenemos todas las campañas (sin insights para que sea súper rápido)
        const campsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${ad_account_id}/campaigns`
            + `?access_token=${accessToken}`
            + `&fields=id,name`
            + `&effective_status=["ACTIVE","PAUSED","ARCHIVED"]`
            + `&limit=500`; // Limitamos a un buen número para llenar el dropdown
            
        const campsData = await fetchMeta(campsUrl);

        return res.json({
            campaigns: campsData.data || []
        });

    } catch (err) {
        console.error('Meta /campaign-list Error:', err.message);
        return res.status(500).json({ message: 'Error al cargar lista de campañas: ' + err.message });
    }
});

// POST /api/meta/campaigns -> Tabla Escalafy (Alta densidad, Paginado 10, POST)
router.post('/campaigns', verificarToken, async (req, res) => {
    try {
        const { ad_account_id, date_start, date_end, cursor, status, campaign_id, store_id } = req.body;

        const whereClause = store_id
            ? { id: store_id, inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' }
            : { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' };

        const integracion = await MetaIntegration.findOne({
            where: whereClause,
            order: [['createdAt', 'ASC']]
        });

        if (!integracion) {
            return res.status(400).json({ message: 'Meta no está conectado.' });
        }

        const accessToken = EncryptionService.decrypt(integracion.access_token);
        
        let targetAdAccount = ad_account_id;
        
        if (!targetAdAccount) {
            // Si no envió ad_account_id, tomamos la primera disponible
            const adsUrl = `https://graph.facebook.com/${FB_API_VERSION}/me/adaccounts?access_token=${accessToken}&fields=id`;
            const adsData = await fetchMeta(adsUrl);
            if (!adsData.data || adsData.data.length === 0) {
                return res.json({ campaigns: [], paging: null });
            }
            targetAdAccount = adsData.data[0].id;
        }

        let timeRangeParams = '';
        if (date_start && date_end) {
            timeRangeParams = `&time_range={"since":"${date_start}","until":"${date_end}"}`;
        } else {
            timeRangeParams = `&date_preset=maximum`;
        }

        const afterParam = cursor ? `&after=${cursor}` : '';
        const limitParam = `&limit=10`;

        let effectiveStatusParam = `&effective_status=["ACTIVE","PAUSED","ARCHIVED"]`;
        if (status && status !== 'ALL') {
            effectiveStatusParam = `&effective_status=["${status}"]`;
        }

        let filteringParam = '';
        if (campaign_id && campaign_id !== 'ALL') {
            filteringParam = `&filtering=[{"field":"campaign.id","operator":"EQUAL","value":"${campaign_id}"}]`;
        }

        // Traemos objective y métricas detalladas para diferenciar WhatsApp vs Web, más la fecha start_time
        const fields = 'id,name,status,start_time,objective,daily_budget,lifetime_budget,' + 
                       'insights{spend,actions,action_values,cost_per_action_type,purchase_roas,outbound_clicks}';

        const campsUrl = `https://graph.facebook.com/${FB_API_VERSION}/${targetAdAccount}/campaigns`
            + `?access_token=${accessToken}`
            + `&fields=${fields}`
            + effectiveStatusParam
            + timeRangeParams
            + limitParam
            + afterParam
            + filteringParam;

        // Consultar la moneda de la cuenta para saber si el presupuesto viene multiplicado por 100 (USD) o no (PYG)
        const accUrl = `https://graph.facebook.com/${FB_API_VERSION}/${targetAdAccount}?access_token=${accessToken}&fields=currency`;
        const accData = await fetchMeta(accUrl);
        const currency = accData.currency || 'USD';
        // Monedas que Facebook NO multiplica por 100 en la API (sin centavos)
        const zeroDecimalCurrencies = ['PYG', 'CLP', 'COP', 'JPY', 'KRW', 'VND', 'IDR'];
        const divisor = zeroDecimalCurrencies.includes(currency) ? 1 : 100;

        const campsData = await fetchMeta(campsUrl);
        const campaignsResult = [];

        if (campsData.data) {
            for (const camp of campsData.data) {
                const insight = camp.insights?.data?.[0] || {};
                const actions = insight.actions || [];
                const actionValues = insight.action_values || [];
                const costPerAction = insight.cost_per_action_type || [];
                
                // Helper functions
                const getVal = (arr, actionType) => arr.find(a => a.action_type === actionType)?.value || 0;
                
                // Base
                const spend = parseFloat(insight.spend || 0);
                const budget = camp.daily_budget ? parseFloat(camp.daily_budget)/divisor : (camp.lifetime_budget ? parseFloat(camp.lifetime_budget)/divisor : 0);
                
                // Web
                const purchases = parseFloat(getVal(actions, 'purchase') || getVal(actions, 'offsite_conversion.fb_pixel_purchase'));
                const costPerPurchase = parseFloat(getVal(costPerAction, 'purchase') || getVal(costPerAction, 'offsite_conversion.fb_pixel_purchase'));
                const purchaseVal = parseFloat(getVal(actionValues, 'purchase') || getVal(actionValues, 'offsite_conversion.fb_pixel_purchase'));
                const roas = insight.purchase_roas?.[0]?.value ? parseFloat(insight.purchase_roas[0].value) : (spend > 0 && purchaseVal > 0 ? purchaseVal/spend : 0);
                const outboundClicks = parseFloat(getVal(actions, 'outbound_clicks') || getVal(actions, 'link_click'));
                const conversionRate = outboundClicks > 0 ? (purchases / outboundClicks) * 100 : 0;

                // WhatsApp
                const conversations = parseFloat(getVal(actions, 'onsite_conversion.messaging_conversation_started_7d') || getVal(actions, 'onsite_conversion.messaging_first_reply'));
                const costPerConversation = conversations > 0 ? spend / conversations : 0;
                const closeRate = conversations > 0 ? (purchases / conversations) * 100 : 0;

                // Determinar tipo principal (Si el objetivo es MESSAGES o OUTCOME_ENGAGEMENT, priorizar ws)
                const isWhatsapp = ['MESSAGES', 'OUTCOME_ENGAGEMENT'].includes(camp.objective);

                campaignsResult.push({
                    id: camp.id,
                    name: camp.name,
                    status: camp.status,
                    start_time: camp.start_time,
                    objective: camp.objective,
                    type: isWhatsapp ? 'whatsapp' : 'web',
                    metrics: {
                        presupuesto: budget,
                        importe_gastado: spend,
                        compras: purchases,
                        costo_por_compra: costPerPurchase,
                        roas: roas,
                        valor_conversion: purchaseVal,
                        // Web específicas
                        porcentaje_conversion: conversionRate,
                        // WS específicas
                        conversaciones: conversations,
                        costo_por_conversacion: costPerConversation,
                        porcentaje_cierre: closeRate,
                    }
                });
            }
        }

        return res.json({
            campaigns: campaignsResult,
            paging: campsData.paging || null
        });

    } catch (err) {
        console.error('Meta /campaigns Error:', err.message);
        return res.status(500).json({ message: 'Error al obtener campañas de Meta: ' + err.message });
    }
});

// POST /api/meta/disconnect -> Desconectar Meta
router.post('/disconnect', verificarToken, async (req, res) => {
    try {
        const integracion = await MetaIntegration.findOne({
            where: { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id }
        });

        if (!integracion) {
            return res.status(404).json({ message: 'No hay integración de Meta para este tenant.' });
        }

        await revocarEnMeta(integracion);
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

// POST /api/meta/data-deletion-callback -> Data Deletion Callback de Meta.
//
// Esta es la URL que se carga en el App Dashboard, en Facebook Login >
// Configuración > "Data Deletion Request URL". Meta la invoca cuando alguien
// quita la app desde su configuración de Facebook o Instagram.
//
// Va SIN verificarToken a propósito: quien llama es Meta, no un usuario con
// sesión. La autenticación real es el HMAC-SHA256 del signed_request contra
// el App Secret, que valida el service antes de tocar la base.
//
// A diferencia del resto de este archivo, la lógica vive en el controller y
// el service (solicitudEliminacion.*) — el patrón por capas del repo — y acá
// queda solo el montaje de la ruta.
router.post('/data-deletion-callback', solicitudEliminacionController.metaCallback);

module.exports = router;
