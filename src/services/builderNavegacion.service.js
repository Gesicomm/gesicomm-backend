'use strict';

/**
 * Navegación entre páginas de un funnel, sin hardcodear ids en el HTML.
 *
 * EL PROBLEMA: el código del usuario corre dentro de un iframe sandbox
 * con `connect-src 'none'` y con fetch/XHR bloqueados, así que la única
 * forma de pasar de una página a otra es un <a href> común. Pero el
 * usuario no puede escribir la URL a mano: cambia si se renombra el
 * slug, si se reordena el funnel o si se le asigna un hostname propio.
 *
 * LA SOLUCIÓN: tokens que el servidor reemplaza AL RENDERIZAR.
 *
 *   <a href="{{siguiente}}">Comprar ahora</a>
 *
 * | token                 | a dónde lleva                          |
 * |-----------------------|----------------------------------------|
 * | {{siguiente}}         | el paso siguiente del funnel           |
 * | {{anterior}}          | el paso anterior                       |
 * | {{inicio}} {{funnel}} | la página de entrada del funnel        |
 * | {{pagina:slug}}       | ese paso concreto                      |
 * | {{cta}}               | lo que tenga la página en destino_cta  |
 *
 * DOS REGLAS QUE IMPORTAN:
 *
 * 1. La sustitución ocurre al RENDERIZAR, no al guardar. Así el mismo
 *    código guardado sirve para el preview y para el público, y renombrar
 *    un slug no obliga a reescribir las páginas que lo enlazan.
 *
 * 2. Un token que no resuelve se reemplaza por "#" y devuelve una
 *    advertencia. NUNCA queda un "{{...}}" crudo en el HTML público:
 *    quedaría a la vista del visitante.
 *
 * Todo token resuelve a una ruta RELATIVA del propio sitio, o a "#". La
 * única forma de enlazar afuera es un <a href="https://..."> normal, que
 * no pasa por acá.
 */

const TOKEN_RE = /\{\{\s*([a-z_]+)(?:\s*:\s*([^}\s]+))?\s*\}\}/gi;

// Tipos de NavigationTarget que todavía no resuelven. Están declarados
// desde el día 1 (ver builderPage.service.js) para que el día que exista
// el checkout se toque un solo `case` y no el renderer entero.
const SIN_IMPLEMENTAR = {
  checkout: 'El destino "checkout" todavía no está disponible.',
  upsell: 'El destino "upsell" todavía no está disponible.',
  // Una página del builder no pertenece a ninguna tienda, así que no hay
  // forma de saber de qué catálogo sacar el producto. Cuando se pueda
  // asociar una página a una tienda, se resuelve acá.
  gesicomm_product: 'Para enlazar a un producto hace falta asociar la página a una tienda.',
};

class BuilderNavegacionService {

  /**
   * Base de la que cuelgan los pasos del funnel.
   *
   *   por hostname   creatina.gesicomm.com/oferta   → base ''
   *   por path       /f/creatina/oferta             → base '/f/creatina'
   *
   * @param {{funnel: object|null, porHostname: boolean}} contexto
   */
  static base(contexto) {
    if (!contexto.funnel) return '';
    return contexto.porHostname ? '' : `/f/${contexto.funnel.slug}`;
  }

  static urlDePaso(slug, contexto) {
    return `${this.base(contexto)}/${slug}`;
  }

  /**
   * Resuelve un NavigationTarget a una URL.
   *
   * @param {{tipo: string}} target
   * @param {{funnel, pagina, paginas, porHostname}} contexto
   *   `paginas` son los pasos PUBLICADOS, en orden.
   * @returns {{url: string, advertencia?: string}}
   */
  static resolver(target, contexto) {
    if (!target || !target.tipo) {
      return { url: '#', advertencia: 'Destino vacío.' };
    }

    if (SIN_IMPLEMENTAR[target.tipo]) {
      return { url: '#', advertencia: SIN_IMPLEMENTAR[target.tipo] };
    }

    switch (target.tipo) {
      case 'external_url':
        return { url: String(target.url || '#') };

      case 'funnel_step': {
        if (!contexto.funnel) {
          return { url: '#', advertencia: 'Esta página no es parte de un funnel: no hay paso siguiente ni anterior.' };
        }
        const paginas = contexto.paginas || [];
        const i = paginas.findIndex(p => p.slug === contexto.pagina?.slug);

        if (target.paso === 'entry') {
          return paginas.length
            ? { url: this.base(contexto) || '/' }
            : { url: '#', advertencia: 'El funnel no tiene páginas publicadas.' };
        }
        if (target.paso === 'next') {
          const sig = i >= 0 ? paginas[i + 1] : null;
          return sig
            ? { url: this.urlDePaso(sig.slug, contexto) }
            : { url: '#', advertencia: 'Esta es la última página publicada del funnel: {{siguiente}} no lleva a ningún lado.' };
        }
        const ant = i > 0 ? paginas[i - 1] : null;
        return ant
          ? { url: this.urlDePaso(ant.slug, contexto) }
          : { url: '#', advertencia: 'Esta es la primera página del funnel: {{anterior}} no lleva a ningún lado.' };
      }

      case 'builder_page': {
        const destino = (contexto.paginas || []).find(p => p.slug === target.pagina_slug);
        return destino
          ? { url: this.urlDePaso(destino.slug, contexto) }
          : { url: '#', advertencia: `No hay ninguna página publicada con el slug "${target.pagina_slug}" en este funnel.` };
      }

      default:
        return { url: '#', advertencia: `Tipo de destino desconocido: "${target.tipo}".` };
    }
  }

  /** Traduce un token del HTML al NavigationTarget que le corresponde. */
  static targetDeToken(nombre, argumento, contexto) {
    switch (nombre.toLowerCase()) {
      case 'siguiente': return { tipo: 'funnel_step', paso: 'next' };
      case 'anterior': return { tipo: 'funnel_step', paso: 'prev' };
      case 'inicio':
      case 'funnel': return { tipo: 'funnel_step', paso: 'entry' };
      case 'pagina': return { tipo: 'builder_page', pagina_slug: argumento };
      case 'producto': return { tipo: 'gesicomm_product', producto_slug: argumento };
      case 'checkout': return { tipo: 'checkout', producto_slug: argumento };
      case 'cta': return contexto.destino_cta || null;
      default: return null;
    }
  }

  /**
   * Reemplaza todos los tokens del HTML.
   *
   * @returns {{html: string, advertencias: string[]}}
   */
  static resolverTokens(html, contexto) {
    const advertencias = new Set();

    const salida = String(html || '').replace(TOKEN_RE, (crudo, nombre, argumento) => {
      const target = this.targetDeToken(nombre, argumento, contexto);

      if (!target) {
        advertencias.add(
          nombre.toLowerCase() === 'cta'
            ? 'Usaste {{cta}} pero la página no tiene un destino de CTA configurado.'
            : `Token desconocido: ${crudo}`,
        );
        return '#';
      }

      const { url, advertencia } = this.resolver(target, contexto);
      if (advertencia) advertencias.add(advertencia);
      return url;
    });

    return { html: salida, advertencias: [...advertencias] };
  }

  /** ¿Hay algún token en este HTML? Evita recorrerlo si no hace falta. */
  static tieneTokens(html) {
    TOKEN_RE.lastIndex = 0;
    return TOKEN_RE.test(String(html || ''));
  }
}

module.exports = BuilderNavegacionService;
module.exports.TOKEN_RE = TOKEN_RE;
