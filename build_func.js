const fs = require('fs');

let func = fs.readFileSync('current_func.txt', 'utf8');

func = func.replace(
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

func = func.replace(
  /let searchFilter = '';/,
  provFilterStr + "\n    let searchFilter = '';"
);

func = func.replace(/\$\{catFilter\}\n\s*\$\{searchFilter\.replace/g, "${catFilter}\n      ${provFilter}\n      ${searchFilter.replace");
func = func.replace(/\$\{catFilter\}\n\s*\$\{searchFilter\}/g, "${catFilter}\n      ${provFilter}\n      ${searchFilter}");

func = func.replace(
  /const \{ Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca \} = require\('\.\.\/models'\);/,
  "const { Producto, ProductoCombo, ProductoComboItem, ProductoImagen, PrecioUsuario, Marca, Proveedor } = require('../models');"
);

func = func.replace(/const \[productos, combos, precios, categoriasUnicasData\] = await Promise\.all\(\[/,
  "const [productos, combos, precios, categoriasUnicasData, proveedoresUnicasData] = await Promise.all([");

func = func.replace(
  /\} \), type: sequelize\.QueryTypes\.SELECT \}\)\n\s*\]\);\n\n\s*const categoriasUnicas = categoriasUnicasData\.map\(c => c\.nombre\);/,
  `} ), type: sequelize.QueryTypes.SELECT }),
      sequelize.query(\`
        SELECT DISTINCT pr.nombre 
        FROM proveedores pr 
        INNER JOIN productos p ON p.proveedor_id = pr.id 
        WHERE p.inquilino_id = :inquilino_id AND p.activo = true AND p.estado_venta = 'en_venta'
        ORDER BY pr.nombre ASC
      \`, { replacements: { inquilino_id }, type: sequelize.QueryTypes.SELECT })
    ]);

    const categoriasUnicas = categoriasUnicasData.map(c => c.nombre);
    const proveedoresUnicos = proveedoresUnicasData.map(p => p.nombre);`
);

func = func.replace(
  /\{ model: Marca, attributes: \['id', 'nombre'\] \},/g,
  "{ model: Marca, attributes: ['id', 'nombre'] },\n          { model: Proveedor, as: 'proveedor', attributes: ['id', 'nombre'] },"
);

func = func.replace(
  /categorias: categoriasUnicas\n\s*\};/,
  "categorias: categoriasUnicas,\n      proveedores: proveedoresUnicos\n    };"
);

func = func.replace(
  /marca: p\.Marca\?\.nombre \|\| null,/g,
  "marca: p.Marca?.nombre || null,\n        proveedor: p.proveedor?.nombre || null,"
);
func = func.replace(
  /marca: padre\?\.Marca\?\.nombre \|\| null,/g,
  "marca: padre?.Marca?.nombre || null,\n        proveedor: padre?.proveedor?.nombre || null,"
);

fs.writeFileSync('new_func.txt', func);
