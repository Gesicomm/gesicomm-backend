'use strict';

const { Op } = require('sequelize');
const { PaymentLogo, PaymentLogoVisibility } = require('../models');

const CATALOGO_LOGOS_PAGO = [
  { clave: 'deposito_bancario', grupo: 'bancario', nombre: 'Deposito bancario', logo_url: '/payment-logos/deposito-bancario.webp', orden: 10 },
  { clave: 'transferencia_bancaria', grupo: 'bancario', nombre: 'Transferencia bancaria', logo_url: '/payment-logos/transferencia-bancaria.webp', orden: 20 },
  { clave: 'visa', grupo: 'tarjetas', nombre: 'Visa', logo_url: '/payment-logos/visa.webp', orden: 100 },
  { clave: 'mastercard', grupo: 'tarjetas', nombre: 'Mastercard', logo_url: '/payment-logos/mastercard.webp', orden: 110 },
  { clave: 'american_express', grupo: 'tarjetas', nombre: 'American Express', logo_url: '/payment-logos/american-express.webp', orden: 120 },
  { clave: 'diners_club', grupo: 'tarjetas', nombre: 'Diners Club', logo_url: '/payment-logos/diners-club.webp', orden: 130 },
  { clave: 'bancard', grupo: 'tarjetas', nombre: 'Bancard', logo_url: '/payment-logos/bancard.webp', orden: 140 },
  { clave: 'credicheck', grupo: 'bocas', nombre: 'Credicheck', logo_url: '/payment-logos/credicheck.webp', orden: 200 },
  { clave: 'cabal', grupo: 'tarjetas', nombre: 'Cabal', logo_url: '/payment-logos/cabal.webp', orden: 210 },
  { clave: 'panal', grupo: 'bocas', nombre: 'Panal', logo_url: '/payment-logos/panal.webp', orden: 220 },
  { clave: 'discover', grupo: 'tarjetas', nombre: 'Discover', logo_url: '/payment-logos/discover.webp', orden: 230 },
  { clave: 'jcb', grupo: 'tarjetas', nombre: 'JCB', logo_url: '/payment-logos/jcb.webp', orden: 240 },
];

function dtoLogo(logo) {
  return {
    clave: logo.clave,
    grupo: logo.grupo,
    nombre: logo.nombre,
    logo_url: logo.logo_url,
    imagen: logo.logo_url,
    orden: logo.orden,
  };
}

class PaymentLogoService {
  static catalogoFallback() {
    return CATALOGO_LOGOS_PAGO.map(dtoLogo);
  }

  static async resolverParaLanding(landing, tienda) {
    let logos = [];
    try {
      logos = await PaymentLogo.findAll({
        order: [['orden', 'ASC'], ['id', 'ASC']],
      });
    } catch (error) {
      // Si la migracion aun no corrio en un entorno local, la landing sigue
      // funcionando con el catalogo base y sin base64 hardcodeado en el HTML.
      return this.catalogoFallback();
    }

    if (!logos.length) return this.catalogoFallback();

    const logoIds = logos.map(l => l.id);
    const whereScopes = [{ usuario_id: tienda.usuario_id }, { tienda_id: tienda.id }];
    if (landing?.id) whereScopes.push({ landing_id: landing.id });
    let overrides = [];
    try {
      overrides = await PaymentLogoVisibility.findAll({
        where: {
          payment_logo_id: { [Op.in]: logoIds },
          [Op.or]: whereScopes,
        },
      });
    } catch (error) {
      return logos.filter(logo => logo.activo !== false).map(dtoLogo);
    }

    const estado = new Map(logos.map(logo => [logo.id, logo.activo !== false]));
    const aplicar = (scope) => {
      overrides
        .filter(v => scope(v))
        .forEach(v => estado.set(v.payment_logo_id, v.activo !== false));
    };
    aplicar(v => v.usuario_id && Number(v.usuario_id) === Number(tienda.usuario_id) && !v.tienda_id && !v.landing_id);
    aplicar(v => v.tienda_id && Number(v.tienda_id) === Number(tienda.id) && !v.landing_id);
    aplicar(v => v.landing_id && Number(v.landing_id) === Number(landing.id));

    return logos.filter(logo => estado.get(logo.id)).map(dtoLogo);
  }

  static async guardarVisibilidadLanding(landing, tienda, paymentLogos) {
    if (!landing?.id || !tienda?.id || !Array.isArray(paymentLogos)) return;
    try {
      const logos = await PaymentLogo.findAll();
      if (!logos.length) return;
      const activos = new Set(paymentLogos
        .filter(logo => logo && logo.activo !== false)
        .map(logo => String(logo.clave || '').trim())
        .filter(Boolean));

      await PaymentLogoVisibility.destroy({ where: { landing_id: landing.id } });
      await PaymentLogoVisibility.bulkCreate(logos.map(logo => ({
        payment_logo_id: logo.id,
        landing_id: landing.id,
        activo: activos.has(logo.clave),
      })));
    } catch (error) {
      // La seleccion ya queda guardada en Landing.content. En entornos donde
      // la migracion todavia no corrio no bloqueamos el guardado del editor.
    }
  }
}

PaymentLogoService.CATALOGO_LOGOS_PAGO = CATALOGO_LOGOS_PAGO;

module.exports = PaymentLogoService;
