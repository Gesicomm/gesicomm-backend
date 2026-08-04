const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'production' ? false : console.log,
    pool: {
      max: 20,
      min: 0,
      acquire: 60000,
      idle: 10000
    }
  }
);

// Comprobar la conexión
async function probarConexion() {
  try {
    await sequelize.authenticate();
    console.log('Conexión a la base de datos establecida correctamente con Sequelize.');
  } catch (error) {
    console.error('No se pudo conectar a la base de datos:', error);
  }
}

if (process.env.NODE_ENV !== 'test') {
  probarConexion();
}

module.exports = sequelize;
