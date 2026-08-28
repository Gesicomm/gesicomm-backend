'use strict';

const TiendaPagina = require('../models/TiendaPagina');
const Funnel = require('../models/Funnel');

/**
 * Factory para crear páginas asegurando invariantes por tipo.
 */
class PaginaFactory {
  static async crearInicio(datos) {
    return TiendaPagina.create({
      ...datos,
      tipo_pagina: 'inicio',
      es_home: true
    });
  }

  static async crearCatalogo(datos) {
    return TiendaPagina.create({
      ...datos,
      tipo_pagina: 'catalogo',
      es_home: false
    });
  }

  static async crearContacto(datos) {
    return TiendaPagina.create({
      ...datos,
      tipo_pagina: 'contacto',
      es_home: false
    });
  }

  static async crearFunnel(datos) {
    if (!datos.producto_id) {
      throw new Error('Un funnel requiere un producto_id.');
    }
    return Funnel.create({
      ...datos,
      tipo_pagina: 'funnel',
      es_home: false
    });
  }
}

module.exports = PaginaFactory;
