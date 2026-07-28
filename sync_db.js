require('dotenv').config({ path: __dirname + '/.env' });
const { sequelize } = require('./src/models');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Autenticado a la base de datos.');
    
    await sequelize.query('DROP TABLE IF EXISTS precios_mayoristas CASCADE;');
    console.log('Tabla precios_mayoristas eliminada.');
    
    await sequelize.sync({ alter: true });
    console.log('Base de datos sincronizada con ProductoCombo.');
    
    process.exit(0);
  } catch(e) {
    console.error('Error al sincronizar:', e);
    process.exit(1);
  }
})();
