const fs = require('fs');
let code = fs.readFileSync('src/services/landing.service.js', 'utf8');

const replacement = `
        if (propias.length > 0) {
          seccionesProducto = propias.map(s => this.seccionDto(s));
        }
        relacionados = relacionadosDto;
        
        // Inyectar el precio ancla y etiqueta de la landing actual a los productos relacionados
        if (relacionados && relacionados.items && landing.items) {
          relacionados.items = relacionados.items.map(relItem => {
            const lItem = landing.items.find(i => i.content_id === relItem.slug || (i.referencia_id === relItem.id && i.tipo === 'producto'));
            if (lItem) {
              return {
                ...relItem,
                precio_ancla: lItem.precio_ancla || relItem.precio_tachado || null,
                etiqueta: lItem.etiqueta || null
              };
            }
            return relItem;
          });
        }
      }
    }

    return {
`;
code = code.replace(/        if \(propias\.length > 0\) \{\n          seccionesProducto = propias\.map\(s => this\.seccionDto\(s\)\);\n        \}\n        relacionados = relacionadosDto;\n      \}\n    \}\n\n    return \{/, replacement);
fs.writeFileSync('src/services/landing.service.js', code);
