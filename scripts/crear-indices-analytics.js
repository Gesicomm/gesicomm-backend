const sequelize = require('../src/config/database');

async function up() {
  try {
    await sequelize.authenticate();
    console.log('Conectado a la base de datos.');

    console.log('Creando índice en envios (usuario_id, fecha)...');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_envios_analytics_fecha ON envios(usuario_id, fecha);');

    console.log('Creando índice en envios (usuario_id, "dispatchedAt")...');
    await sequelize.query('CREATE INDEX IF NOT EXISTS "idx_envios_analytics_dispatchedAt" ON envios(usuario_id, "dispatchedAt");');

    console.log('Creando índice en landing_eventos (landing_id, created_at)...');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_landing_evento_analytics_fecha ON landing_eventos(landing_id, created_at);');

    console.log('¡Índices creados con éxito!');
  } catch (error) {
    console.error('Error creando índices:', error);
  } finally {
    await sequelize.close();
  }
}

up();
