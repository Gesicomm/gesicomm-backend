const { sequelize } = require('./src/models');

async function migrate() {
  try {
    await sequelize.query(`
      DO $$
      BEGIN
        -- Crear el tipo ENUM si no existe
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_productos_estado_venta') THEN
          CREATE TYPE enum_productos_estado_venta AS ENUM ('en_venta', 'fuera_de_stock', 'no_disponible');
        END IF;

        -- Agregar la columna si no existe
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'productos' AND column_name = 'estado_venta'
        ) THEN
          ALTER TABLE productos
            ADD COLUMN estado_venta enum_productos_estado_venta NOT NULL DEFAULT 'en_venta';
        END IF;
      END
      $$;
    `);
    console.log('✅ Migración estado_venta completada.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  }
}

migrate();
