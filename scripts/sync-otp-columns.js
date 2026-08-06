require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const sequelize = require('../src/config/database');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('Conexión OK');

    // Agregar columnas de OTP si no existen
    await sequelize.query(`
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS email_verificado BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS codigo_verificacion VARCHAR(6),
        ADD COLUMN IF NOT EXISTS codigo_verificacion_expira TIMESTAMPTZ;
    `);
    console.log('Columnas OTP creadas (o ya existían)');

    // Marcar todos los usuarios existentes como verificados para no bloquear cuentas previas
    const [, meta] = await sequelize.query(
      'UPDATE usuarios SET email_verificado = true WHERE email_verificado = false'
    );
    console.log('Usuarios existentes parcheados con email_verificado = true. Rows afectadas:', meta?.rowCount ?? '?');

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
