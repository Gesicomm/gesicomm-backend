const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

const oldStr = `      sequelize.query(\`
        SELECT DISTINCT c.nombre 
        FROM categorias c 
        INNER JOIN productos p ON p.categoria_id = c.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY c.nombre ASC
      \`, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData.map(c => c.nombre);`;

const newStr = `      sequelize.query(\`
        SELECT DISTINCT c.nombre 
        FROM categorias c 
        INNER JOIN productos p ON p.categoria_id = c.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY c.nombre ASC
      \`, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(\`
        SELECT DISTINCT pr.nombre 
        FROM proveedores pr 
        INNER JOIN productos p ON p.proveedor_id = pr.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY pr.nombre ASC
      \`, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData.map(c => c.nombre);
    const proveedoresUnicos = proveedoresUnicasData ? proveedoresUnicasData.map(p => p.nombre) : [];`;

code = code.replace(oldStr, newStr);
fs.writeFileSync('src/services/precioUsuario.service.js', code);
