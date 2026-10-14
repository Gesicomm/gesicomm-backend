'use strict';

const compression = require('compression');

// JSON y HTML públicos también se sirven en dominios propios sin CDN.
// Mantiene Cache-Control/ETag y negocia gzip/Brotli con el navegador; el proxy
// puede transmitir la respuesta comprimida aunque solo comprima HTML.
module.exports = compression({ threshold: 1024, level: 6 });
