'use strict';

/**
 * Rutas internas de infraestructura. Montadas en: /interno
 *
 * No las llama ningún navegador: las llama Caddy desde la misma máquina,
 * contra 127.0.0.1:3000, sin pasar por Nginx. Nginx tampoco las expone
 * (su `location /` manda todo lo que no reconoce al frontend), así que
 * quedan fuera de internet aunque no lleven autenticación.
 */

const express = require('express');
const router = express.Router();

const TiendaService = require('../services/tienda.service');
const BuilderDomainService = require('../services/builderDomain.service');

/**
 * El endpoint `ask` del on-demand TLS de Caddy.
 *
 * Caddy lo consulta EN MITAD del handshake TLS, antes de pedirle el
 * certificado a Let's Encrypt: si contesta 2xx emite, con cualquier otra
 * cosa corta. Es lo único que impide que alguien apunte un dominio
 * cualquiera a nuestra IP y nos haga emitir certificados a su nombre —
 * apuntar el DNS acá no alcanza, el dominio tiene que estar cargado y
 * verificado en Gesicomm.
 *
 * Se consultan los dos registros de dominios que existen: el de las
 * tiendas (Tienda.dominio_propio) y el del Page Builder (builder_domains).
 *
 * Tiene que ser rápido: mientras responde, hay un visitante con la
 * conexión abierta esperando.
 */
router.get('/certificado-permitido', async (req, res) => {
  const dominio = req.query.domain;

  try {
    const permitido = await TiendaService.dominioHabilitadoParaCertificado(dominio)
      || await BuilderDomainService.hostnameHabilitadoParaCertificado(dominio);

    if (!permitido) {
      console.warn(`[caddy-ask] rechazado: ${dominio}`);
      return res.status(404).send('no');
    }
    return res.status(200).send('ok');
  } catch (err) {
    // Ante un error nuestro se rechaza: es preferible que el visitante vea
    // un error de TLS y reintente a que emitamos certificados sin control.
    console.error(`[caddy-ask] error con ${dominio}:`, err.message);
    return res.status(500).send('error');
  }
});

module.exports = router;
