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
    // keepAlive del socket TCP: con conexiones que ahora viven minutos (ver
    // `idle` abajo), es lo que hace que una conexión muerta —túnel caído,
    // corte de red— se detecte y se descarte en vez de quedar en el pool
    // esperando a fallar en la próxima consulta.
    dialectOptions: {
      keepAlive: true,
    },
    pool: {
      max: 20,
      // min > 0: deja conexiones vivas aunque no se use nada. Abrir una
      // conexión contra una base remota es caro (medido: 10 consultas en
      // paralelo tardan 1107 ms con el pool frío y 246 ms con el pool
      // caliente — casi un segundo es puro handshake).
      min: 2,
      acquire: 60000,
      // Era 10000: a los 10 segundos sin actividad se cerraban TODAS las
      // conexiones. El dashboard se lee más de 10 segundos, así que el
      // siguiente clic en un filtro pagaba la reconexión entera. Con 2
      // minutos, una sesión normal de trabajo mantiene el pool caliente y
      // las conexiones igual se liberan al rato de dejar de usarlas.
      idle: 120000,
      // Cada cuánto corre el evictor que cierra las que pasaron el `idle`.
      evict: 30000
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
