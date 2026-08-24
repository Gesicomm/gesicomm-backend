/** Solo lectura: inspecciona el estado actual de los productos WINNINGSTAR. */
require('dotenv').config();
const { sequelize, Producto, Proveedor } = require('../src/models');

(async () => {
  const proveedor = await Proveedor.findOne({ where: { nombre: 'WINNINGSTAR' } });
  console.log('Proveedor WINNINGSTAR:', proveedor ? `id=${proveedor.id} usuario_id=${proveedor.usuario_id}` : 'NO EXISTE');

  const productos = await Producto.findAll({
    where: { inquilino_id: 2 },
    attributes: ['id', 'sku', 'nombre', 'proveedor_id', 'propuesta_valor', 'sobre_este_producto'],
    order: [['id', 'ASC']],
    limit: 400,
  });
  const winningstar = productos.filter(p => /WS-|WINNINGSTAR/i.test(p.sku || '') || /WINNINGSTAR/i.test(p.nombre || ''));
  console.log('Total productos inquilino=2:', productos.length);
  console.log('Productos que matchean WINNINGSTAR:', winningstar.length);
  console.log('\nMuestra (primeros 8):');
  winningstar.slice(0, 8).forEach(p => {
    console.log(`  id=${p.id} sku=${p.sku} proveedor_id=${p.proveedor_id} nombre="${p.nombre}"`);
    console.log(`    propuesta_valor=${p.propuesta_valor ? '(tiene, ' + p.propuesta_valor.length + ' chars)' : 'null'}`);
    console.log(`    sobre_este_producto=${p.sobre_este_producto ? '(tiene, ' + p.sobre_este_producto.length + ' chars)' : 'null'}`);
  });

  const sinProveedor = winningstar.filter(p => !p.proveedor_id);
  console.log(`\nWINNINGSTAR sin proveedor_id asignado: ${sinProveedor.length} / ${winningstar.length}`);

  await sequelize.close();
})();
