const fs = require('fs');
let code = fs.readFileSync('src/services/precioUsuario.service.js', 'utf8');

const badCode = `    let provFilter = '';
    if (filtroProveedor) {
      const { Proveedor } = require('../models');
      const prov = await Proveedor.findOne({ where: { nombre: filtroProveedor, inquilino_id } });
      if (prov) {
        replacements.proveedor_id = prov.id;
        provFilter = 'AND p.proveedor_id = :proveedor_id';
      } else {
        return { items: [], total: 0, page: 1, totalPages: 0, categorias: [], proveedores: [] };
      }
    }`;

const goodCode = `    let provFilter = '';
    if (filtroProveedor) {
      replacements.filtroProveedor = filtroProveedor;
      provFilter = 'AND p.proveedor_id IN (SELECT id FROM proveedores WHERE nombre = :filtroProveedor)';
    }`;

if (code.includes(badCode)) {
  code = code.replace(badCode, goodCode);
  fs.writeFileSync('src/services/precioUsuario.service.js', code);
  console.log('Fixed query filter');
} else {
  console.log('Bad code not found');
}
