const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const sequelize = require('../src/config/database');
const { Producto, Proveedor } = require('../src/models');
const { Op } = require('sequelize');

async function up() {
  try {
    // Buscar o crear proveedor WINNINGSTAR (usuario 1 u otro, vamos a buscar globalmente o crear para todos)
    // Usualmente se hace por inquilino_id, pero Proveedor tiene usuario_id
    // Asumiremos usuario_id = 1 para un setup de tenant unico, o lo buscaremos
    
    let proveedor = await Proveedor.findOne({
      where: { nombre: { [Op.iLike]: 'WINNINGSTAR' } }
    });
    
    if (!proveedor) {
      // Tomamos un usuario admin o 1
      proveedor = await Proveedor.create({
        nombre: 'WINNINGSTAR',
        usuario_id: 1, // Por defecto al ID 1
        precio_dolar: null
      });
      console.log('Proveedor WINNINGSTAR creado con ID:', proveedor.id);
    } else {
      console.log('Proveedor WINNINGSTAR ya existía con ID:', proveedor.id);
    }

    // Actualizar todos los productos para que tengan este proveedor
    const [updatedCount] = await Producto.update(
      { proveedor_id: proveedor.id },
      { where: { proveedor_id: null } }
    );
    
    console.log(`Se actualizaron ${updatedCount} productos con el proveedor WINNINGSTAR.`);
    
  } catch (error) {
    console.error('Error al asignar el proveedor:', error);
  } finally {
    process.exit(0);
  }
}

up();
