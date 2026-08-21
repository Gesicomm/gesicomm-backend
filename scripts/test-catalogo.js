require('dotenv').config();
const { sequelize } = require('../src/models');
const PrecioUsuarioService = require('../src/services/precioUsuario.service');

async function test() {
  try {
    const res = await PrecioUsuarioService.listarCatalogoPaginado(1, 1, {
      page: 1, limit: 10, busqueda: "a", filtroCategoria: "", orden: "nombre", tipo: "todos"
    });
    console.log('Result:', Object.keys(res));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}
test();
