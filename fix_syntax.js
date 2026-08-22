const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

const badCode = `  }      profit,
      margin,
      estado: this.anotarEstado(margin, minimumMarginDecimal),
      comparison: resultado.comparison,
      sensitivity,
      warnings: resultado.warnings,
    };
  }`;

code = code.replace(badCode, `  }`);
fs.writeFileSync('src/services/precioUsuario.service.js', code);
console.log('Fixed syntax error');
