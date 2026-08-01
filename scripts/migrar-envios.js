const { sequelize } = require('../src/models');

async function migrarEnvios() {
  const queries = [
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "fecha" VARCHAR(20)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "hora" VARCHAR(20)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "confirmador" VARCHAR(100)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "nombre_cliente" VARCHAR(100)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "apellido_cliente" VARCHAR(100)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "telefono" VARCHAR(50)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "departamento" VARCHAR(100)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "ciudad" VARCHAR(100)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "direccion" VARCHAR(255)',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "referencia" TEXT',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "link_maps" TEXT',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "costo_envio" INTEGER DEFAULT 0',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "metodo_pago" VARCHAR(50) DEFAULT \'Efectivo\'',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "observaciones" TEXT',
    'ALTER TABLE "envios" ADD COLUMN IF NOT EXISTS "fecha_rendicion" DATE',
  ];

  for (const q of queries) {
    await sequelize.query(q);
  }
}

module.exports = { migrarEnvios };
