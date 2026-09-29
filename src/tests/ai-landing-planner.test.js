jest.mock('../models', () => ({ Producto: {}, Tienda: {} }));
jest.mock('../services/landingSimple.service', () => ({}));
jest.mock('../services/landingCodigo.service', () => ({}));
jest.mock('../services/aiCodeValidator.service', () => ({}));
jest.mock('../services/bloquesVentaCanonicos', () => ({ aplicarBloquesCanonicos: codigo => codigo }));
jest.mock('../services/aiGenerationLog.service', () => ({}));

const AILandingService = require('../services/aiLanding.service');

describe('AILandingService.planLandingIA', () => {
  it('prioriza ficha_rubro sobre palabras ambiguas del nombre o la categoria', () => {
    const bazar = AILandingService.planLandingIA({
      prompt: 'Producto de cocina con usos visuales',
      productos: [{
        nombre: 'Cortador Multifuncion 12 en 1',
        categoria: 'Bazar y Cocina',
        ficha_rubro: 'bazar',
        ficha_datos: { usos: ['picar', 'rebanar'] },
      }],
    });

    const belleza = AILandingService.planLandingIA({
      prompt: 'Landing beauty para rutina facial',
      productos: [{
        nombre: 'Serum Facial Vitamina C Glow',
        categoria: 'Belleza',
        ficha_rubro: 'belleza',
        ficha_datos: { rutina: ['limpiar', 'aplicar'] },
      }],
    });

    expect(bazar.product_family).toBe('bazar_hogar');
    expect(bazar.sections.map(s => s.id)).toEqual(expect.arrayContaining(['use_cases', 'before_after_or_steps']));
    expect(bazar.sections.map(s => s.id)).not.toContain('features_specs');

    expect(belleza.product_family).toBe('belleza');
    expect(belleza.sections.map(s => s.id)).toEqual(expect.arrayContaining(['routine_steps', 'ingredients_or_materials']));
    expect(belleza.sections.map(s => s.id)).not.toContain('how_it_works');
  });
});
