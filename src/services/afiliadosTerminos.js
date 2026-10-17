const fs = require('fs');
const path = require('path');

module.exports = {
  version: '1.0',
  fecha: '2026-10-14',
  texto: fs.readFileSync(path.join(__dirname, '../data/afiliados-terminos-v1.md'), 'utf8'),
};
