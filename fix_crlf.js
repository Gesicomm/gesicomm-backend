const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

const regex = /  }      profit,[\s\S]*?warnings: resultado\.warnings,[\s\S]*?    };\r?\n  }/;
code = code.replace(regex, "");
fs.writeFileSync('src/services/precioUsuario.service.js', code);
console.log('Fixed syntax error via regex');
