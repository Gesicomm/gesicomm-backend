const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

// 1. Add filtroProveedor to destructuring
code = code.replace(
  /page = 1, limit = 10, busqueda = '', filtroCategoria = '', orden = 'nombre', tipo = 'todos'/,
  "page = 1, limit = 10, busqueda = '', filtroCategoria = '', filtroProveedor = '', orden = 'nombre', tipo = 'todos'"
);

// 2. Add provider filter logic
const providerFilterCode = `
    let provFilter = '';
    if (filtroProveedor) {
      const { Proveedor } = require('../models');
      const prov = await Proveedor.findOne({ where: { nombre: filtroProveedor, inquilino_id } });
      if (prov) {
        replacements.proveedor_id = prov.id;
        provFilter = 'AND p.proveedor_id = :proveedor_id';
      } else {
        return { items: [], total: 0, page: 1, totalPages: 0, categorias: [], proveedores: [] };
      }
    }
`;
code = code.replace(
  /let searchFilter = '';/,
  providerFilterCode + "\n    let searchFilter = '';"
);

// 3. Add provFilter to sql queries
code = code.replace(
  /(\$\{catFilter\}\s*\n\s*)(\$\{searchFilter\.replace)/,
  "$1      ${provFilter}\n      $2"
);
code = code.replace(
  /(\$\{catFilter\}\s*\n\s*)(\$\{searchFilter\}(?!.replace))/,
  "$1      ${provFilter}\n      $2"
);

// 4. Require Proveedor
code = code.replace(
  /const \{ Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca \} = require\('\.\.\/models'\);/g,
  "const { Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca, Proveedor } = require('../models');"
);

// 5. Update the Promise.all to fetch unique providers
const fetchProvidersCode = `
      sequelize.query(\`
        SELECT DISTINCT pr.nombre 
        FROM proveedores pr 
        INNER JOIN productos p ON p.proveedor_id = pr.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY pr.nombre ASC
      \`, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData.map(c => c.nombre);
    const proveedoresUnicos = proveedoresUnicasData.map(p => p.nombre);
`;

code = code.replace(
  /\} \), type: sequelize\.QueryTypes\.SELECT \}\)\s*\]\);\s*const categoriasUnicas = categoriasUnicasData\.map\(c => c\.nombre\);/,
  "} ), type: sequelize.QueryTypes.SELECT })," + fetchProvidersCode.replace(/\]\);\n/, '')
);

code = code.replace(/const \[productos, combos, precios, categoriasUnicasData\] = await Promise\.all\(\[/,
  "const [productos, combos, precios, categoriasUnicasData, proveedoresUnicasData] = await Promise.all([");

// 6. Add Proveedor to the include arrays
code = code.replace(
  /\{ model: Marca, attributes: \['id', 'nombre'\] \},/g,
  "{ model: Marca, attributes: ['id', 'nombre'] },\n          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },"
);

// 7. Update return of listarCatalogoPaginado
code = code.replace(
  /categorias: categoriasUnicas\s*\}\;/,
  "categorias: categoriasUnicas,\n      proveedores: proveedoresUnicos\n    };"
);

// 8. Update map function to set proveedor
code = code.replace(
  /marca: p\.Marca\?\.nombre \|\| null,/g,
  "marca: p.Marca?.nombre || null,\n        proveedor: p.proveedor?.nombre || null,"
);
code = code.replace(
  /marca: padre\?\.Marca\?\.nombre \|\| null,/g,
  "marca: padre?.Marca?.nombre || null,\n        proveedor: padre?.proveedor?.nombre || null,"
);

fs.writeFileSync('src/services/precioUsuario.service.js', code);
console.log('Patched precioUsuario.service.js successfully.');
