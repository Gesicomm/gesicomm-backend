const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

const startIdx = code.indexOf('static async listarCatalogoPaginado(');
const endIdx = code.indexOf('static async guardarPrecioProducto(');
const oldFunc = code.substring(startIdx, endIdx);

let newFunc = oldFunc.replace(
  /page = 1, limit = 10, busqueda = '', filtroCategoria = '', orden = 'nombre', tipo = 'todos'/,
  "page = 1, limit = 10, busqueda = '', filtroCategoria = '', filtroProveedor = '', orden = 'nombre', tipo = 'todos'"
);

const provFilterStr = `
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

newFunc = newFunc.replace(
  /let searchFilter = '';/,
  provFilterStr + "\n    let searchFilter = '';"
);

newFunc = newFunc.replace(/\$\{catFilter\}\s*\n\s*\$\{searchFilter\.replace/g, "${catFilter}\n      ${provFilter}\n      ${searchFilter.replace");
newFunc = newFunc.replace(/\$\{catFilter\}\s*\n\s*\$\{searchFilter\}(?!\.replace)/g, "${catFilter}\n      ${provFilter}\n      ${searchFilter}");

newFunc = newFunc.replace(
  /const \{ Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca \} = require\('\.\.\/models'\);/,
  "const { Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca, Proveedor } = require('../models');"
);

newFunc = newFunc.replace(/const \[productos, combos, precios, categoriasUnicasData\] = await Promise\.all\(\[/,
  "const [productos, combos, precios, categoriasUnicasData, proveedoresUnicasData] = await Promise.all([");

const fetchProvidersCode = `} ), type: sequelize.QueryTypes.SELECT }),
      sequelize.query(\`
        SELECT DISTINCT pr.nombre 
        FROM proveedores pr 
        INNER JOIN productos p ON p.proveedor_id = pr.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY pr.nombre ASC
      \`, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData.map(c => c.nombre);
    const proveedoresUnicos = proveedoresUnicasData.map(p => p.nombre);`;

newFunc = newFunc.replace(
  /\} \), type: sequelize\.QueryTypes\.SELECT \}\)\s*\]\);\s*const categoriasUnicas = categoriasUnicasData\.map\(c => c\.nombre\);/,
  fetchProvidersCode
);

newFunc = newFunc.replace(
  /\{ model: Marca, attributes: \['id', 'nombre'\] \},/g,
  "{ model: Marca, attributes: ['id', 'nombre'] },\n          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },"
);

newFunc = newFunc.replace(
  /categorias: categoriasUnicas\s*\};/,
  "categorias: categoriasUnicas,\n      proveedores: proveedoresUnicos\n    };"
);

newFunc = newFunc.replace(
  /marca: p\.Marca\?\.nombre \|\| null,/g,
  "marca: p.Marca?.nombre || null,\n        proveedor: p.proveedor?.nombre || null,"
);
newFunc = newFunc.replace(
  /marca: padre\?\.Marca\?\.nombre \|\| null,/g,
  "marca: padre?.Marca?.nombre || null,\n        proveedor: padre?.proveedor?.nombre || null,"
);

code = code.replace(oldFunc, newFunc);
fs.writeFileSync('src/services/precioUsuario.service.js', code);
console.log('patched successfully');
