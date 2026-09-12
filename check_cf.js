require('dotenv').config();

const s = require('./src/config/database');
const { gatewayDeSistema } = require('./src/services/suscripcion.service');

(async () => {
  try {
    await s.query(`
      INSERT INTO "SequelizeMeta" (name)
      VALUES ('20260912120000-add_numero_pedido_por_usuario.js')
      ON CONFLICT DO NOTHING
    `);

    console.log('marcada como aplicada');
  } catch (error) {
    console.error('ERROR:', error);
    process.exitCode = 1;
  } finally {
    if (typeof s.close === 'function') {
      await s.close();
    }
  }
})();

