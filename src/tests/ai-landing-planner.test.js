jest.mock('../models', () => ({ Producto: {}, Tienda: {} }));
jest.mock('../services/landingSimple.service', () => ({}));
jest.mock('../services/landingCodigo.service', () => ({
  sanitizar: jest.fn(codigo => ({
    html: codigo.html || '',
    css: codigo.css || '',
    js: codigo.js || '',
    fonts: Array.isArray(codigo.fonts) ? codigo.fonts : [],
    design_context: codigo.design_context || {},
    advertencias: [],
  })),
}));
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

  it('distingue suplementos, bazar y electrodomesticos aunque no venga ficha_rubro', () => {
    const suplemento = AILandingService.planLandingIA({
      prompt: 'Venta directa',
      productos: [{ nombre: 'AdelFit Suplemento Natural', categoria: 'Salud y nutricion' }],
    });
    const bazar = AILandingService.planLandingIA({
      prompt: 'Producto util para la cocina',
      productos: [{ nombre: 'Cortador Multifuncion 12 en 1', categoria: 'Bazar y Cocina' }],
    });
    const electro = AILandingService.planLandingIA({
      prompt: 'Ficha premium',
      productos: [{ nombre: 'Freidora de aire 5L', categoria: 'Electrodomesticos' }],
    });

    expect(suplemento.product_family).toBe('suplementos');
    expect(suplemento.sections.map(s => s.id)).toEqual(expect.arrayContaining(['how_it_works', 'how_to_use']));

    expect(bazar.product_family).toBe('bazar_hogar');
    expect(bazar.sections.map(s => s.id)).toEqual(expect.arrayContaining(['use_cases', 'before_after_or_steps']));
    expect(bazar.sections.map(s => s.id)).not.toContain('features_specs');

    expect(electro.product_family).toBe('electrodomesticos');
    expect(electro.sections.map(s => s.id)).toEqual(expect.arrayContaining(['features_specs', 'comparison']));
  });

  it('declara que una plantilla del comerciante manda sobre el plan interno', () => {
    const plan = AILandingService.planLandingIA({
      prompt: 'Rellená este template HTML con mis productos y respetá la estructura tal cual.',
      productos: [
        { content_id: 'adelfit', nombre: 'AdelFit', precio: 169000 },
        { content_id: 'articumina', nombre: 'Articumina', precio: 160000 },
      ],
      comercio: { tipo_venta: 'catalogo' },
    });

    expect(plan.rules.join(' ')).toMatch(/plantilla|HTML|estructura/i);
    expect(plan.rules.join(' ')).toMatch(/respet/i);
    expect(plan.goal).toBe('presentar tienda/catalogo y llevar a fichas de producto');
  });
});

describe('AILandingService.promptConPlanLanding', () => {
  it('envia un contrato explicito para rellenar templates, no redisenarlos', () => {
    const plan = AILandingService.planLandingIA({
      prompt: 'Tengo este template de ecommerce, rellenalo con mis productos y mantené el layout.',
      productos: [
        { content_id: 'adelfit', nombre: 'AdelFit', precio: 169000 },
        { content_id: 'articumina', nombre: 'Articumina', precio: 160000 },
      ],
      comercio: { tipo_venta: 'catalogo' },
    });

    const promptFinal = AILandingService.promptConPlanLanding(
      'Tengo este template de ecommerce, rellenalo con mis productos y mantené el layout.',
      plan,
    );

    expect(promptFinal).toContain('CONTRATO_DE_GENERACION_GESICOMM');
    expect(promptFinal).toContain('rellená esa estructura con datos reales de Gesicomm');
    expect(promptFinal).toContain('data-gesicomm-lista');
    expect(promptFinal).toContain('no fuerces un producto principal');
    expect(promptFinal).toContain('referencia_estructural_detectada: si');
    expect(promptFinal).not.toContain('no conviertas esto en una plantilla rígida');
  });

  it('mantiene el contrato en el payload real que va al RAG', async () => {
    const fetchOriginal = AILandingService._fetchRAG;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      html: '<section data-gesicomm-lista="productos"><template><article><button data-gesicomm-ver></button></article></template></section>',
      css: ':root{--gc-primario:#123456}',
      js: '',
      fonts: [],
    });
    AILandingService._fetchRAG = fetchMock;

    try {
      await AILandingService.solicitarCodigoRAG({
        prompt: 'Usá esta plantilla de bazar y rellenala. Debe mostrar todos los productos.',
        tienda: { id: 10, nombre: 'SomMix', color_primario: '#126f73' },
        productos: [
          { content_id: 'adelfit', nombre: 'AdelFit', precio: 169000 },
          { content_id: 'articumina', nombre: 'Articumina', precio: 160000 },
        ],
        comercio: { tipo_venta: 'catalogo' },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, payload] = fetchMock.mock.calls[0];
      expect(payload.prompt).toContain('CONTRATO_DE_GENERACION_GESICOMM');
      expect(payload.prompt).toContain('rellená esa estructura');
      expect(payload.context.products).toHaveLength(2);
      expect(payload.context.commerce.landing_plan.goal).toBe('presentar tienda/catalogo y llevar a fichas de producto');
    } finally {
      AILandingService._fetchRAG = fetchOriginal;
    }
  });

  it('compacta prompts largos sin perder el contrato de plantilla', () => {
    const promptLargo = [
      'Rellená este template de ecommerce y respetá cada sección tal cual.',
      'Estructura obligatoria: hero, catálogo, beneficios, comparación, preguntas frecuentes y CTA final.',
      'Estilo visual oscuro con acento teal, tarjetas compactas y fotos completas.',
      'Detalle extra '.repeat(1500),
    ].join('\n');
    const plan = AILandingService.planLandingIA({
      prompt: promptLargo,
      productos: [
        { content_id: 'adelfit', nombre: 'AdelFit', precio: 169000 },
        { content_id: 'articumina', nombre: 'Articumina', precio: 160000 },
      ],
      comercio: { tipo_venta: 'catalogo' },
    });

    const promptFinal = AILandingService.promptConPlanLanding(promptLargo, plan);

    expect(promptFinal.length).toBeLessThanOrEqual(11800);
    expect(promptFinal).toContain('CONTRATO_DE_GENERACION_GESICOMM');
    expect(promptFinal).toContain('referencia_estructural_detectada: si');
    expect(promptFinal).toMatch(/PROMPT_DEL_COMERCIANTE_COMPACTADO|Rellená este template/);
  });
});

describe('AILandingService bases de codigo para IA', () => {
  it('normaliza la base de inicio y ficha que manda el wizard', () => {
    const bases = AILandingService.basesCodigoDesdePayload({
      codigo: { html: '<main class="base"></main>', css: '.base{}', js: '' },
      vistas: { producto: { html: '<section class="pdp"></section>', css: '.pdp{}', js: '' } },
    });

    expect(bases.inicio.html).toContain('base');
    expect(bases.producto.html).toContain('pdp');
  });

  it('arma una instruccion explicita para optimizar sin redisenar el template base', () => {
    const instruccion = AILandingService.instruccionEdicionDeTemplate('Agregá mejor copy comercial.', 'inicio');

    expect(instruccion).toContain('MODO_OPTIMIZACION_DE_TEMPLATE_BASE');
    expect(instruccion).toContain('fuente de verdad visual');
    expect(instruccion).toContain('No lo reemplaces por una landing nueva');
    expect(instruccion).toContain('Agregá mejor copy comercial.');
  });
});

describe('AILandingService._codigoConMetadata', () => {
  it('conserva metadata de familia y template devuelta por el RAG', () => {
    const codigo = AILandingService._codigoConMetadata({
      ok: true,
      html: '<section></section>',
      css: '',
      js: '',
      product_family: 'suplementos',
      reference_template: 'suplementos',
      reference_template_chars: 21086,
      system_prompt_chars: 56080,
    });

    expect(codigo._productFamily).toBe('suplementos');
    expect(codigo._referenceTemplate).toBe('suplementos');
    expect(codigo._referenceTemplateChars).toBe(21086);
    expect(codigo._systemPromptChars).toBe(56080);
  });
});

describe('AILandingService.asegurarDemoDataVisual', () => {
  it('agrega demo_data.urgencia cuando el HTML usa countdown', () => {
    const codigo = AILandingService.asegurarDemoDataVisual({
      html: '<section data-gesicomm-countdown></section>',
      css: '',
      js: '',
      demo_data: null,
    });

    expect(codigo.demo_data.urgencia).toEqual({ activo: true, preset: '48h' });
  });

  it('respeta presets validos existentes', () => {
    const codigo = AILandingService.asegurarDemoDataVisual({
      html: '<section data-gesicomm-countdown></section>',
      css: '',
      js: '',
      demo_data: { urgencia: { activo: true, preset: '24h' } },
    });

    expect(codigo.demo_data.urgencia).toEqual({ activo: true, preset: '24h' });
  });

  it('agrega demo_data.prueba_social cuando el HTML usa estadisticas', () => {
    const codigo = AILandingService.asegurarDemoDataVisual({
      html: '<section data-gesicomm-lista="estadisticas"><template><b data-gesicomm-bind="valor"></b></template></section>',
      css: '',
      js: '',
      demo_data: null,
    });

    expect(codigo.demo_data.prueba_social.activo).toBe(true);
    expect(codigo.demo_data.prueba_social.items.length).toBeGreaterThanOrEqual(2);
  });
});
