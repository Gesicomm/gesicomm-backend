/** Solo lectura: confirma si la columna precio_dolar existe en productos. No escribe nada. */
require('dotenv').config();
const sequelize = require('../src/config/database');

(async () => {
  const info = await sequelize.getQueryInterface().describeTable('productos');
  console.log('precio_dolar existe:', !!info.precio_dolar);
  await sequelize.close();
})();
