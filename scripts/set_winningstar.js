require('dotenv').config();
const { Usuario, Proveedor, Producto, sequelize } = require('./src/models');

async function setWinningStar() {
  try {
    await sequelize.authenticate();
    
    // Find first active user (usually the owner/admin)
    const admin = await Usuario.findOne({ order: [['id', 'ASC']] });
    if (!admin) {
      console.log('No users found.');
      return;
    }

    // Find or create 'WINNINGSTAR' provider
    const [proveedor, created] = await Proveedor.findOrCreate({
      where: { nombre: 'WINNINGSTAR' },
      defaults: {
        usuario_id: admin.id,
        nombre: 'WINNINGSTAR',
        activo: true
      }
    });

    console.log(`Proveedor WINNINGSTAR (ID: ${proveedor.id}) ${created ? 'creado' : 'encontrado'}.`);

    // Update all products where proveedor_id is null
    const [affectedRows] = await Producto.update(
      { proveedor_id: proveedor.id },
      { where: { proveedor_id: null } }
    );

    console.log(`Se actualizaron ${affectedRows} productos a WINNINGSTAR.`);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

setWinningStar();
