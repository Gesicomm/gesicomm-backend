const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

const regex = /    };\r?\n  }\r?\n}\r?\n\r?\nmodule\.exports = PrecioUsuarioService;[\s\S]*$/;
code = code.replace(regex, "    };\n  }\n}\n\nmodule.exports = PrecioUsuarioService;\n");
fs.writeFileSync('src/services/precioUsuario.service.js', code);
console.log('Cleaned up end of file');
