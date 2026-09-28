/**
 * Contrato cerrado de primitives Gesicomm (services/aiCodeValidator.service.js).
 *
 * El modelo escribe HTML libre, pero los puntos donde ese HTML toca lógica
 * del sistema son un DSL chico y cerrado: listas permitidas, acciones
 * permitidas, content_id permitidos, campos condicionales permitidos. Todo
 * lo que no resuelve contra el contexto que recibió la IA tiene que salir
 * como error para que el repair lo corrija — si pasa, la landing se publica
 * con una sección que va a estar vacía para siempre y nadie se entera.
 *
 * Test puro: no toca la base ni el RAG.
 */

const AICodeValidator = require('../services/aiCodeValidator.service');

const CONTENT_IDS = ['adelfit', 'air-fryer-winningstar', 'combo-12'];
const CATEGORIAS = ['Freidoras de Aire', 'Cápsulas'];

const validar = (html, opciones = {}) => AICodeValidator.validar(html, {
  contentIdsPermitidos: CONTENT_IDS,
  categoriasReales: CATEGORIAS,
  ...opciones,
});

describe('identidad de los items (content_id)', () => {
  it('acepta un content_id del contexto', () => {
    const { errores } = validar('<button data-gesicomm-comprar="adelfit">Comprar</button>');
    expect(errores).toHaveLength(0);
  });

  it('acepta "principal" y el atributo sin valor (el item de la tarjeta/ficha)', () => {
    const { errores } = validar('<button data-gesicomm-comprar="principal"></button><button data-gesicomm-comprar></button>');
    expect(errores).toHaveLength(0);
  });

  it('rechaza un content_id inventado', () => {
    const { errores } = validar('<button data-gesicomm-comprar="air-fryer-2600">Comprar</button>');
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('air-fryer-2600');
  });

  // El bug que motivó todo esto: catalogoParaRAG mandaba `id: "producto_310"`
  // y el contrato decía "usá su id", pero buscar() en el runtime no resuelve
  // ese formato. El botón quedaba muerto sin ningún error.
  it('rechaza el identificador interno "producto_310"', () => {
    const { errores } = validar('<button data-gesicomm-comprar="producto_310">Comprar</button>');
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('producto_310');
  });

  it('le dice al repair cuáles son los válidos', () => {
    const { errores } = validar('<a data-gesicomm-ver="inventado"></a>');
    expect(errores[0]).toContain('adelfit');
    expect(errores[0]).toContain('combo-12');
  });

  it('cubre ver, agregar e item, no solo comprar', () => {
    const html = '<a data-gesicomm-ver="x1"></a><button data-gesicomm-agregar="x2"></button>'
      + '<section data-gesicomm-item="x3"></section>';
    expect(validar(html).errores).toHaveLength(3);
  });

  it('no valida identidad si no sabemos qué items tiene la landing', () => {
    const { errores } = AICodeValidator.validar('<button data-gesicomm-comprar="lo-que-sea"></button>', {});
    expect(errores).toHaveLength(0);
  });
});

describe('listas', () => {
  it('acepta las listas reales', () => {
    const { errores } = validar('<div data-gesicomm-lista="recomendados"><template><p></p></template></div>');
    expect(errores).toHaveLength(0);
  });

  // El runtime devuelve [] a propósito: el upsell es una etapa del checkout.
  // Se corta en la generación, no en el runtime — las landings viejas que ya
  // la tienen guardada la siguen ignorando en silencio.
  it('rechaza ofertas_upsell y explica por qué', () => {
    const { errores } = validar('<div data-gesicomm-lista="ofertas_upsell"><template><p></p></template></div>');
    expect(errores).toHaveLength(1);
    expect(errores[0]).toMatch(/checkout/i);
  });

  it('rechaza una lista inventada', () => {
    const { errores } = validar('<div data-gesicomm-lista="testimonios"></div>');
    expect(errores).toHaveLength(1);
  });
});

describe('campos condicionales y de tienda', () => {
  it('acepta campos reales del producto', () => {
    const { errores } = validar('<div data-gesicomm-si="beneficios"></div><div data-gesicomm-sin="stock"></div>');
    expect(errores).toHaveLength(0);
  });

  it('rechaza un campo de producto inventado', () => {
    const { errores } = validar('<div data-gesicomm-si="garantiaInventada"></div>');
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('garantiaInventada');
  });

  it('acepta datos reales de la tienda y rechaza los inventados', () => {
    expect(validar('<span data-gesicomm-tienda="whatsapp"></span>').errores).toHaveLength(0);
    expect(validar('<span data-gesicomm-tienda="cuit"></span>').errores).toHaveLength(1);
  });
});

describe('categorías', () => {
  it('acepta la categoría real y rechaza una aproximada', () => {
    const ok = '<div data-gesicomm-lista="productos" data-gesicomm-categoria="Freidoras de Aire">'
      + '<template><article><button data-gesicomm-comprar></button></article></template></div>';
    const mal = ok.replace('Freidoras de Aire', 'Freidoras');
    expect(validar(ok).errores).toHaveLength(0);
    expect(validar(mal).errores).toHaveLength(1);
  });
});

describe('secciones vacías (calidad)', () => {
  const CSS_OK = '@media (max-width:640px){a{color:red}}@media (max-width:1024px){a{color:blue}}h1{font-size:clamp(2rem,5vw,4rem)}';

  it('no observa nada cuando la sección entera es la lista', () => {
    const html = '<section data-gesicomm-lista="recomendados"><h2>Te puede interesar</h2>'
      + '<div data-gesicomm-lista="recomendados"><template><article></article></template></div></section>';
    expect(AICodeValidator.validarCalidad({ html, css: CSS_OK })).toHaveLength(0);
  });

  it('marca un placeholder vacío, que en la página publicada es un rectángulo de color', () => {
    const html = '<div class="hero-image-placeholder"></div>';
    const motivos = AICodeValidator.validarCalidad({ html, css: CSS_OK });
    expect(motivos).toHaveLength(1);
    expect(motivos[0]).toContain('placeholder');
  });
});
